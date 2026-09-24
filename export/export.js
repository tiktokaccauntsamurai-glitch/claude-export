import { api } from '../src/io/bridge.js';
import { listAllConversations } from '../src/core/conversations.js';
import { applyFilter } from '../src/core/filters.js';
import { runExport } from '../src/core/export-run.js';
import { runArtifactsExport } from '../src/core/export-artifacts.js';
import { listProjects, exportProjects } from '../src/core/projects.js';
import { listUserArtifacts, countUserArtifacts, exportUserArtifacts } from '../src/core/user-artifacts.js';
import { exportMemoryAndSkills } from '../src/core/memory-skills.js';
import { classify, fromFileList, shortDir } from '../src/core/local-scan.js';
import { readSessionMeta } from '../src/core/cc-sessions.js';
import { readOfficial } from '../src/core/official.js';
import { runLocalExport, scanFiles, officialProjectFiles } from '../src/core/export-local.js';
import { ensureZip } from '../src/io/libs.js';
import { mdToPdfDoc, pdfBlob } from '../src/core/render-pdf.js';
import { ensurePdf } from '../src/io/libs.js';
import { saveFiles, stamp } from '../src/io/save.js';
import { saveBlob } from '../src/io/download.js';
import { runDiagnostics } from '../src/core/diagnostics.js';
import { initLang, setLang, getLang, t, applyI18n } from '../src/i18n.js';

const PERM = { origins: ['https://claude.ai/*'] };
const $ = id => document.getElementById(id);

let org = null;
let convs = []; // rows shown in the table: chatConvs, or localConvs on the local tab
let chatConvs = [];
let localConvs = [];
let loaded = false; // chat list loaded
let localLoaded = false;
let localScan = null; // classified .claude folder
let officialData = null; // parsed official export
let projects = [];
let projLoaded = false;
let tab = 'chats'; // chats | artifacts | projects | account | local
let galleryCounted = false;
let selected = new Set();
const selChat = selected;
const selLocal = new Set();
const isLoaded = () => (tab === 'local' ? localLoaded : loaded);
const projSelected = new Set();
let abort = null;

const getOrg = async () => (org ??= await api('orgId'));

// ---------- init / language ----------
async function init() {
  await initLang();
  $('lang').value = getLang();
  applyI18n();
  if (!(await browser.permissions.contains(PERM))) $('grant').hidden = false;
  const { opts } = await browser.storage.local.get('opts');
  if (opts) applyOpts(opts);
  updateModeUi();
  updateVisibility();
}
$('lang').onchange = async () => {
  await setLang($('lang').value);
  applyI18n();
  if (loaded) { renderTable(); $('status').textContent = t('total_n', { n: convs.length }); }
  if (projLoaded) $('projStatus').textContent = t('projects_total', { n: projects.length });
  updateVisibility();
};
$('grantBtn').onclick = () => browser.permissions.request(PERM).then(ok => ok && location.reload());

// ---------- tabs ----------
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  tab = b.dataset.tab;
  convs = tab === 'local' ? localConvs : chatConvs;
  selected = tab === 'local' ? selLocal : selChat;
  if (isLoaded() && (tab === 'chats' || tab === 'artifacts' || tab === 'local')) { buildProjectSelect(); renderTable(); }
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  $('out').textContent = '';
  updateVisibility();
});
function updateVisibility() {
  const isList = tab === 'chats' || tab === 'artifacts' || tab === 'local';
  $('loadRow').hidden = !(tab === 'chats' || tab === 'artifacts');
  $('main').hidden = !(isList && isLoaded());
  $('chatOpts').hidden = !((tab === 'chats' && loaded) || tab === 'local');
  $('artOpts').hidden = !(tab === 'artifacts' && loaded);
  $('galleryBox').hidden = tab !== 'artifacts';
  $('projSec').hidden = tab !== 'projects';
  $('accSec').hidden = tab !== 'account';
  $('localSec').hidden = tab !== 'local';
  $('actions').hidden = !(tab !== 'chats' || loaded);
  $('exportBtn').hidden = tab === 'artifacts' && !loaded;
  $('exportBtn').textContent = t({ chats: 'export_btn', artifacts: 'export_artifacts_btn', projects: 'export_projects_btn', account: 'export_account_btn', local: 'export_local_btn' }[tab]);
  if (tab === 'artifacts' && !galleryCounted) refreshGalleryCount();
  updateCount();
}

async function refreshGalleryCount() {
  galleryCounted = true;
  try {
    await getOrg();
    const c = await countUserArtifacts(api, org);
    $('galleryStatus').textContent = c ? t('gallery_count', { n: c.count + (c.is_capped ? '+' : '') }) : '';
  } catch { galleryCounted = false; }
}

// ---------- options persistence ----------
const OPT_IDS = {
  md: 'oMd', pdf: 'oPdf', artifacts: 'oArtifacts', inlineArtifacts: 'oInline', thinking: 'oThinking', tools: 'oTools',
  frontmatter: 'oFront', askWhere: 'oAsk', allVersions: 'oAllVersions', binaries: 'oBinaries',
  lcMemory: 'oLcMemory', lcSkills: 'oLcSkills', lcMd: 'oLcMd', lcProj: 'oLcProj',
  skills: 'oSkills', memory: 'oMemory', projFiles: 'oProjFiles',
};
function readOpts() {
  const o = {};
  for (const [k, id] of Object.entries(OPT_IDS)) o[k] = $(id).checked;
  o.pack = document.querySelector('input[name=pack]:checked').value;
  o.folder = $('folder').value.trim() || 'ClaudeExport';
  return o;
}
function applyOpts(o) {
  for (const [k, id] of Object.entries(OPT_IDS)) if (k in o) $(id).checked = o[k];
  const pack = [...document.querySelectorAll('input[name=pack]')].find(r => r.value === o.pack);
  if (pack) pack.checked = true;
  if (o.folder) $('folder').value = o.folder;
}
const persistIds = Object.values(OPT_IDS).map(id => '#' + id).join(',') + ',input[name=pack],#folder';
document.querySelectorAll(persistIds).forEach(el => el.addEventListener('change', async () => {
  const { opts } = await browser.storage.local.get('opts');
  browser.storage.local.set({ opts: { ...opts, ...readOpts() } });
}));

// ---------- chat list ----------
$('loadBtn').onclick = async () => {
  $('status').textContent = t('loading');
  try {
    await getOrg();
    chatConvs = await listAllConversations(api, org, n => { $('status').textContent = t('loaded_n', { n }); });
    convs = chatConvs;
    convs.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    loaded = true;
    $('status').textContent = t('total_n', { n: convs.length });
    buildProjectSelect();
    renderTable();
    updateVisibility();
  } catch (e) {
    $('status').textContent = t('error', { msg: e.message });
  }
};

const projName = c => c.project?.name || '';
function buildProjectSelect() {
  const sel = $('project');
  sel.length = 1;
  const seen = new Map();
  for (const c of convs) if (c.project_uuid && !seen.has(c.project_uuid)) seen.set(c.project_uuid, projName(c) || c.project_uuid.slice(0, 8));
  for (const [id, name] of seen) sel.add(new Option(name, id));
}

function currentFilter() {
  return {
    mode: document.querySelector('input[name=mode]:checked').value,
    from: $('from').value, to: $('to').value, dateField: $('dateField').value,
    selected, query: $('query').value.trim(), projectId: $('project').value,
  };
}

const d10 = s => (s || '').slice(0, 10);
function renderTable() {
  const tb = $('tbl').tBodies[0];
  tb.textContent = '';
  const frag = document.createDocumentFragment();
  for (const c of convs) {
    const tr = document.createElement('tr');
    tr.dataset.id = c.uuid;
    const td0 = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(c.uuid);
    cb.onchange = () => { cb.checked ? selected.add(c.uuid) : selected.delete(c.uuid); updateCount(); };
    td0.append(cb);
    tr.append(td0);
    for (const [txt, cls] of [[c.name || t('untitled'), 'title'], [projName(c)], [d10(c.created_at)], [d10(c.updated_at)], [c.model || '']]) {
      const td = document.createElement('td');
      td.textContent = txt;
      if (cls) td.className = cls;
      tr.append(td);
    }
    frag.append(tr);
  }
  tb.append(frag);
  refreshVisibility();
}

// the table shows chats matching search/project (and period when in period mode)
function visibleList() {
  const f = currentFilter();
  return applyFilter(convs, { ...f, mode: f.mode === 'period' ? 'period' : 'all' });
}
function refreshVisibility() {
  const vis = new Set(visibleList().map(c => c.uuid));
  for (const tr of $('tbl').tBodies[0].rows) tr.classList.toggle('hidden', !vis.has(tr.dataset.id));
  updateCount();
}
function updateCount() {
  let n;
  if (tab === 'projects') {
    n = projSelected.size;
    $('projCount').textContent = t('proj_selected', { n });
  } else if (tab === 'account') {
    n = ($('oSkills').checked ? 1 : 0) + ($('oMemory').checked ? 1 : 0);
  } else if (tab === 'local') {
    n = (localLoaded ? applyFilter(convs, currentFilter()).length : 0) + extraFiles().length;
    $('count').textContent = t('to_export', { n });
  } else {
    n = loaded ? applyFilter(convs, currentFilter()).length : 0;
    $('count').textContent = t('to_export', { n });
  }
  $('exportBtn').disabled = n === 0 || !!abort;
}
function updateModeUi() {
  $('periodRow').hidden = document.querySelector('input[name=mode]:checked').value !== 'period';
}
function syncChecks() {
  for (const tr of $('tbl').tBodies[0].rows) tr.cells[0].firstChild.checked = selected.has(tr.dataset.id);
}
document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = () => { updateModeUi(); refreshVisibility(); });
['from', 'to', 'dateField', 'project'].forEach(id => $(id).onchange = refreshVisibility);
$('query').oninput = refreshVisibility;
$('selVisible').onclick = () => { visibleList().forEach(c => selected.add(c.uuid)); syncChecks(); updateCount(); };
$('selNone').onclick = () => { selected.clear(); syncChecks(); updateCount(); };

// ---------- projects list ----------
$('loadProjBtn').onclick = async () => {
  $('projStatus').textContent = t('loading');
  try {
    await getOrg();
    projects = await listProjects(api, org);
    projLoaded = true;
    projects.forEach(p => projSelected.add(p.uuid));
    $('projStatus').textContent = projects.length ? t('projects_total', { n: projects.length }) : t('proj_none');
    $('projTools').hidden = !projects.length;
    renderProjects();
  } catch (e) {
    $('projStatus').textContent = t('error', { msg: e.message });
  }
};
function renderProjects() {
  const ul = $('projList');
  ul.textContent = '';
  for (const p of projects) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = projSelected.has(p.uuid);
    cb.onchange = () => { cb.checked ? projSelected.add(p.uuid) : projSelected.delete(p.uuid); updateCount(); };
    label.append(cb, ' ' + p.name);
    li.append(label);
    ul.append(li);
  }
  updateCount();
}
$('projAll').onclick = () => { projects.forEach(p => projSelected.add(p.uuid)); renderProjects(); };
$('projNone').onclick = () => { projSelected.clear(); renderProjects(); };

// ---------- export ----------
async function runJob(total, job) {
  abort = new AbortController();
  $('exportBtn').disabled = true;
  $('galleryBtn').disabled = true;
  $('cancelBtn').hidden = false;
  $('prog').hidden = false;
  $('prog').max = total;
  $('prog').value = 0;
  $('out').textContent = '';
  const onProgress = p => {
    $('prog').value = p.done;
    $('progText').textContent = p.errors
      ? t('progress_err', { done: p.done, total: p.total, e: p.errors }) : t('progress', { done: p.done, total: p.total });
  };
  try {
    await job(abort.signal, onProgress);
  } catch (e) {
    console.error(e);
    $('out').textContent = t('error', { msg: e.message });
  } finally {
    abort = null;
    $('cancelBtn').hidden = true;
    $('prog').hidden = true;
    $('galleryBtn').disabled = false;
    updateCount();
  }
}

// saves res.files and prints the summary produced by msg(path)
async function saveAndReport(res, opts, msg) {
  if (res.aborted) { $('out').textContent = t('cancelled'); return; }
  $('progText').textContent = t('packing_zip');
  const path = await saveFiles(res.files, { pack: opts.pack, folder: opts.folder, askWhere: opts.askWhere, stamp: stamp() },
    pc => { $('progText').textContent = t('zip_pct', { p: pc.toFixed(0) }); });
  $('out').textContent = msg(path) +
    (res.notes?.length ? '\n\n' + t('notes_head') + '\n' + res.notes.map(n => t(n.key, n.params)).join('\n') : '') + (res.errors.length ? '\n\n' + t('errors_head') + '\n' + res.errors.join('\n') : '');
}

async function exportChats() {
  const opts = readOpts();
  if (!opts.md && !opts.pdf) { $('out').textContent = t('choose_format'); return; }
  const list = applyFilter(convs, currentFilter());
  await runJob(list.length, async (signal, onProgress) => {
    if (opts.pdf) await ensurePdf();
    const res = await runExport({
      convs: list, org, opts, api, signal, onProgress,
      makePdf: async (md, title) => pdfBlob(mdToPdfDoc(md, title)),
    });
    await saveAndReport(res, opts, path => t(opts.pack === 'zip' ? 'done_zip' : 'done_files',
      { c: list.length - res.errors.length, f: res.files.length, e: res.errors.length, path }));
  });
}

async function exportArtifacts() {
  const opts = readOpts();
  const list = applyFilter(convs, currentFilter());
  await runJob(list.length, async (signal, onProgress) => {
    const res = await runArtifactsExport({ convs: list, org, opts, api, signal, onProgress });
    if (!res.aborted && !res.stats.artifacts && !res.stats.attachments) {
      $('out').textContent = t('no_artifacts') + (res.errors.length ? '\n\n' + t('errors_head') + '\n' + res.errors.join('\n') : '');
      return;
    }
    await saveAndReport(res, opts, path => t('done_art',
      { c: res.stats.chats, a: res.stats.artifacts, b: res.stats.attachments, e: res.errors.length, path }));
  });
}

async function exportProjectsUi() {
  const opts = readOpts();
  const list = projects.filter(p => projSelected.has(p.uuid));
  await runJob(list.length, async (signal, onProgress) => {
    const res = await exportProjects({ projects: list, org, api, signal, onProgress, withFiles: opts.projFiles });
    await saveAndReport(res, opts, path => t('done_proj',
      { p: res.stats.projects, k: res.stats.knowledge, f: res.stats.files, e: res.errors.length, path }));
  });
}

// ---------- diagnostics ----------
let lastReport = null;
let recTimer = null;

async function runDiag(recLog) {
  $('diagRun').disabled = true;
  $('diagOut').textContent = '';
  try {
    const report = await runDiagnostics({
      api, recLog, version: browser.runtime.getManifest().version,
      onStep: step => { $('diagStatus').textContent = t('diag_running', { step }); },
    });
    lastReport = report;
    const { folder } = readOpts();
    const path = `${folder}/diagnostics-${stamp()}.json`;
    await saveBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), path);
    $('diagStatus').textContent = t('diag_saved', { path });
    $('diagOut').textContent = report.summary;
    $('diagCopy').hidden = false;
  } catch (e) {
    console.error(e);
    $('diagStatus').textContent = t('error', { msg: e.message });
  } finally {
    $('diagRun').disabled = false;
  }
}
$('diagRun').onclick = () => runDiag(null);
$('diagCopy').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2));
  $('diagStatus').textContent = t('diag_copied');
};
$('diagRecStart').onclick = async () => {
  await browser.storage.local.set({ recording: true, recLog: {} });
  $('diagRecStart').hidden = true;
  $('diagRecStop').hidden = false;
  recTimer = setInterval(async () => {
    const { recLog } = await browser.storage.local.get('recLog');
    $('diagStatus').textContent = t('diag_recording', { n: Object.keys(recLog || {}).length });
  }, 1000);
};
$('diagRecStop').onclick = async () => {
  clearInterval(recTimer);
  await browser.storage.local.set({ recording: false });
  $('diagRecStop').hidden = true;
  $('diagRecStart').hidden = false;
  const { recLog } = await browser.storage.local.get('recLog');
  await runDiag(recLog || {});
  await browser.storage.local.set({ recLog: {} });
};

async function exportGallery() {
  const opts = readOpts();
  await runJob(1, async (signal, onProgress) => {
    await getOrg();
    $('progText').textContent = t('loading');
    const artifacts = await listUserArtifacts(api, org);
    $('prog').max = Math.max(1, new Set(artifacts.map(a => a.chat_conversation_uuid)).size);
    const res = await exportUserArtifacts({ artifacts, org, opts, api, signal, onProgress });
    if (!res.aborted && !res.stats.artifacts) {
      $('out').textContent = t('no_artifacts') + (res.errors.length ? '\n\n' + t('errors_head') + '\n' + res.errors.join('\n') : '');
      return;
    }
    await saveAndReport(res, opts, path => t('done_gallery',
      { a: res.stats.artifacts, c: res.stats.chats, m: res.stats.missing, e: res.errors.length, path }));
  });
}

async function exportAccount() {
  const opts = readOpts();
  await runJob(1, async () => {
    await getOrg();
    const res = await exportMemoryAndSkills({ org, api, opts: { skills: opts.skills, memory: opts.memory } });
    await saveAndReport(res, opts, path => t('done_account', { s: res.stats.skills, m: res.stats.memoryChars, e: res.errors.length, path }));
  });
}

// ---------- local: .claude folder + official export ----------
function extraFiles() {
  const o = { memory: $('oLcMemory').checked, skills: $('oLcSkills').checked, md: $('oLcMd').checked };
  const files = localScan ? scanFiles(localScan, o) : [];
  if ($('oLcProj').checked && officialData?.projects) files.push(...officialProjectFiles(officialData.projects));
  if ($('oLcProj').checked && officialData?.memories) files.push({ path: 'official-export/' + officialData.memories.name, data: officialData.memories.text });
  return files;
}

function setLocalRows(kind, rows) {
  localConvs = [...localConvs.filter(r => r.kind !== kind), ...rows];
  localConvs.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  localLoaded = localConvs.length > 0;
  if (tab === 'local') { convs = localConvs; buildProjectSelect(); renderTable(); }
  updateVisibility();
}

$('ccPick').onchange = async () => {
  const entries = fromFileList($('ccPick').files);
  localScan = classify(entries);
  const s = localScan;
  const other = s.claudeMd.length + s.agents.length + s.commands.length + s.rules.length;
  if (!s.sessions.length && !s.memory.length && !s.skills.length && !other) {
    $('ccInfo').textContent = t('cc_none');
    localScan = null;
    setLocalRows('cc', []);
    return;
  }
  const rows = [];
  for (const [i, e] of s.sessions.entries()) {
    $('ccInfo').textContent = t('cc_reading', { n: `${i + 1}/${s.sessions.length}` });
    try {
      const meta = await readSessionMeta(e.ref, e.dir, shortDir(e.dir));
      if (meta) rows.push(meta);
    } catch (err) { console.warn('session skipped', e.p, err); }
  }
  $('ccInfo').textContent = t('cc_info', { s: rows.length, m: s.memory.length, k: s.skills.length, a: other });
  setLocalRows('cc', rows);
};

$('offPick').onchange = async () => {
  const file = $('offPick').files[0];
  if (!file) return;
  $('offInfo').textContent = t('loading');
  try {
    let entries;
    if (/\.zip$/i.test(file.name)) {
      await ensureZip();
      const zip = await new globalThis.JSZip().loadAsync(file);
      entries = Object.values(zip.files).filter(f => !f.dir).map(f => ({ name: f.name, text: () => f.async('string') }));
    } else {
      entries = [{ name: file.name, text: () => file.text() }];
    }
    officialData = await readOfficial(entries);
    const p = Array.isArray(officialData.projects) ? officialData.projects.length : 0;
    $('offInfo').textContent = officialData.conversations.length || p
      ? t('off_info', { c: officialData.conversations.length, p }) : t('off_none');
    setLocalRows('official', officialData.conversations);
  } catch (e) {
    $('offInfo').textContent = t('error', { msg: e.message });
  }
};
['oLcMemory', 'oLcSkills', 'oLcMd', 'oLcProj'].forEach(id => $(id).addEventListener('change', updateCount));

async function exportLocal() {
  const opts = readOpts();
  const items = localLoaded ? applyFilter(convs, currentFilter()) : [];
  const extra = extraFiles();
  if (items.length && !opts.md && !opts.pdf) { $('out').textContent = t('choose_format'); return; }
  await runJob(Math.max(1, items.length), async (signal, onProgress) => {
    if (opts.pdf && items.length) await ensurePdf();
    const res = items.length
      ? await runLocalExport({ items, opts, signal, onProgress, makePdf: async (md, title) => pdfBlob(mdToPdfDoc(md, title)) })
      : { files: [], errors: [], aborted: false, stats: { chats: 0 } };
    res.files.push(...extra);
    await saveAndReport(res, opts, path => t('done_local', { c: res.stats.chats, f: res.files.length, e: res.errors.length, path }));
  });
}

$('galleryBtn').onclick = exportGallery;
['oSkills', 'oMemory'].forEach(id => $(id).addEventListener('change', updateCount));
$('exportBtn').onclick = () => ({ chats: exportChats, artifacts: exportArtifacts, projects: exportProjectsUi, account: exportAccount, local: exportLocal }[tab])();
$('cancelBtn').onclick = () => abort?.abort();

init();
