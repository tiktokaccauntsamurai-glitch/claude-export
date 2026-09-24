import { api } from '../src/io/bridge.js';
import { EP } from '../src/core/endpoints.js';
import { runExport } from '../src/core/export-run.js';
import { mdToPdfDoc, pdfBlob } from '../src/core/render-pdf.js';
import { ensurePdf } from '../src/io/libs.js';
import { saveFiles, stamp } from '../src/io/save.js';
import { initLang, getLang, t, applyI18n } from '../src/i18n.js';
import { chatIdFromUrl } from '../src/core/urls.js';

const $ = id => document.getElementById(id);
const PERM = { origins: ['https://claude.ai/*'] };
const DEFAULTS = { md: true, pdf: false, artifacts: true, inlineArtifacts: true, thinking: false, tools: false, frontmatter: true, pack: 'zip', folder: 'ClaudeExport' };

let org = null;
let recent = [];
let current = null; // {uuid, name}
let busy = false;
const selected = new Set();

const setStatus = s => { $('status').textContent = s; };
const show = (id, on) => { $(id).hidden = !on; };

// ---------- options ----------
async function loadOpts() {
  const { opts } = await browser.storage.local.get('opts');
  const o = { ...DEFAULTS, ...opts };
  $('oMd').checked = o.md; $('oPdf').checked = o.pdf; $('oArtifacts').checked = o.artifacts;
  return o;
}
async function readOpts() {
  const { opts } = await browser.storage.local.get('opts');
  const o = { ...DEFAULTS, ...opts, md: $('oMd').checked, pdf: $('oPdf').checked, artifacts: $('oArtifacts').checked };
  await browser.storage.local.set({ opts: o });
  return o;
}

// ---------- recent list (cached first, then live refresh) ----------
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
}
function updateSelBtn() {
  $('expSel').textContent = t('pu_export_selected', { n: selected.size });
  $('expSel').disabled = busy || selected.size === 0;
}
function renderRecent() {
  const ul = $('recent');
  ul.textContent = '';
  if (!recent.length) {
    const li = document.createElement('li');
    li.textContent = t('pu_no_chats');
    ul.append(li);
  }
  for (const c of recent) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(c.uuid);
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = c.name || t('untitled');
    title.title = c.name || '';
    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = fmtDate(c.updated_at);
    const toggle = () => { cb.checked ? selected.add(c.uuid) : selected.delete(c.uuid); updateSelBtn(); };
    cb.onchange = toggle;
    li.onclick = (e) => { if (e.target !== cb) { cb.checked = !cb.checked; toggle(); } };
    li.append(cb, title, d);
    ul.append(li);
  }
  updateSelBtn();
}

async function loadRecent() {
  if (busy) return;
  try {
    org ??= await api('orgId');
    const page = await api('get', { path: EP.conversations(org, { limit: 30, offset: 0 }) });
    const items = Array.isArray(page) ? page : (page.data || page.conversations || []);
    recent = items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 5)
      .map(c => ({ uuid: c.uuid, name: c.name, updated_at: c.updated_at }));
    browser.storage.local.set({ recentCache: recent });
    renderRecent();
  } catch (e) {
    setStatus(t('error', { msg: e.message }));
  }
}

// ---------- export ----------
async function doExport(list) {
  if (busy || !list.length) return;
  const opts = await readOpts();
  if (!opts.md && !opts.pdf) { setStatus(t('choose_format')); return; }
  busy = true;
  for (const id of ['expCur', 'expSel', 'refresh']) $(id).disabled = true;
  setStatus(t('pu_exporting'));
  try {
    org ??= await api('orgId');
    if (opts.pdf) await ensurePdf();
    const res = await runExport({
      convs: list, org, opts: { ...opts, noIndex: true }, api, delay: 0,
      makePdf: async (md, title) => pdfBlob(mdToPdfDoc(md, title)),
      onProgress: p => setStatus(`${t('pu_exporting')}\n${p.done}/${p.total}`),
    });
    const path = await saveFiles(res.files, { pack: 'files', folder: opts.folder, stamp: stamp(), flat: true });
    setStatus(t('pu_done', { n: list.length - res.errors.length, path }) +
      (res.errors.length ? '\n' + t('errors_head') + '\n' + res.errors.join('\n') : ''));
  } catch (e) {
    console.error(e);
    setStatus(t('error', { msg: e.message }));
  } finally {
    busy = false;
    $('expCur').disabled = false;
    $('refresh').disabled = false;
    updateSelBtn();
  }
}

$('expCur').onclick = () => doExport([current]);
$('expSel').onclick = () => doExport(recent.filter(c => selected.has(c.uuid)));
$('refresh').onclick = loadRecent;
$('full').onclick = () => { browser.tabs.create({ url: browser.runtime.getURL('export/export.html') }); window.close(); };
$('gear').onclick = $('full').onclick;
$('openClaude').onclick = () => { browser.tabs.create({ url: 'https://claude.ai/' }); window.close(); };
$('grantBtn').onclick = () => browser.permissions.request(PERM).then(ok => ok && location.reload());
for (const id of ['oMd', 'oPdf', 'oArtifacts']) $(id).onchange = () => readOpts();

// ---------- init ----------
async function init() {
  await initLang();
  applyI18n();
  updateSelBtn();
  if (!(await browser.permissions.contains(PERM))) { show('noaccess', true); return; }
  const claudeTabs = await browser.tabs.query({ url: 'https://claude.ai/*' });
  if (!claudeTabs.length) { show('noclaude', true); return; }
  await loadOpts();
  show('content', true);

  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  const chatId = chatIdFromUrl(active?.url);
  if (chatId) {
    current = { uuid: chatId, name: (active.title || '').replace(/\s*[-–|]\s*Claude\s*$/i, '') };
    $('curTitle').textContent = current.name || chatId;
    show('curBox', true);
  }

  const { recentCache } = await browser.storage.local.get('recentCache');
  if (Array.isArray(recentCache)) { recent = recentCache; renderRecent(); }
  await loadRecent();
  setInterval(loadRecent, 20000); // live refresh while the popup is open
}
init();
