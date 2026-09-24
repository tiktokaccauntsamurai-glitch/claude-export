// End-to-end UI tests of the full export page: real export.js + real HTML in jsdom, fake claude.ai backend.
import test from 'node:test';
import assert from 'node:assert';
import { loadPage, waitFor, getJSZip } from './harness.mjs';
import { makeBackend } from './fixtures.mjs';

async function boot(o = {}) {
  const fx = makeBackend(o.backend);
  const p = await loadPage({ page: 'export', fx, ...o });
  await waitFor(() => p.text('exportBtn') !== '', { what: 'page init' });
  p.fx = fx;
  return p;
}
const loadChats = async (p) => {
  await p.click('loadBtn');
  await waitFor(() => p.$('tbl').tBodies[0].rows.length === 3, { what: 'chat rows' });
};
const rowsVisible = (p) => [...p.$('tbl').tBodies[0].rows].filter(r => !r.classList.contains('hidden')).map(r => r.dataset.id);
const finish = async (p) => { await waitFor(() => /Done|Готово|Error|Ошибка|Cancelled|Отменено|No artifacts|не найдено/.test(p.text('out')), { timeout: 15000, what: 'export result' }); return p.text('out'); };
const names = (zip) => Object.keys(zip.files).filter(n => !zip.files[n].dir);

test('boots in English, no JS errors, language switch persists', async () => {
  const p = await boot();
  assert.equal(p.text('exportBtn'), 'Export');
  assert.equal(p.$('grant').hidden, true);
  assert.equal(p.$('lang').value, 'en');
  assert.equal(p.$('tabs').children.length, 5);
  p.setValue('lang', 'ru');
  await waitFor(() => p.w.document.querySelector('#tabs button').textContent === 'Чаты');
  assert.equal(p.store.lang, 'ru');
  assert.equal(p.text('exportBtn'), 'Экспортировать');
  assert.deepEqual(p.errors, []);
  p.close();
});

test('starts in Russian when saved, and shows the grant button without host permission', async () => {
  const p = await boot({ permission: false, storage: { lang: 'ru' } });
  assert.equal(p.$('grant').hidden, false);
  assert.equal(p.w.document.querySelector('#tabs button').textContent, 'Чаты');
  p.close();
});

test('load list, filters: search, project, period (local dates), selected', async () => {
  const p = await boot();
  await loadChats(p);
  assert.equal(p.text('status'), 'Total chats: 3');
  assert.equal(p.text('count'), 'To export: 3');
  assert.deepEqual(rowsVisible(p), ['c-new', 'c-mid', 'c-old']); // newest first
  p.setValue('query', 'новый', 'input');
  assert.deepEqual(rowsVisible(p), ['c-new']);
  assert.equal(p.text('count'), 'To export: 1');
  p.setValue('query', '', 'input');
  p.setValue('project', 'p1');
  assert.deepEqual(rowsVisible(p), ['c-mid']);
  p.setValue('project', '');
  // period
  p.w.document.querySelector('input[name=mode][value=period]').click();
  assert.equal(p.$('periodRow').hidden, false);
  p.setValue('from', '2026-05-01');
  p.setValue('to', '2026-05-31');
  assert.equal(p.text('count'), 'To export: 1');
  assert.deepEqual(rowsVisible(p), ['c-mid']);
  p.setValue('dateField', 'created_at');
  assert.equal(p.text('count'), 'To export: 1');
  // selected
  p.w.document.querySelector('input[name=mode][value=selected]').click();
  assert.equal(p.text('count'), 'To export: 0');
  assert.equal(p.$('exportBtn').disabled, true);
  p.$('tbl').tBodies[0].rows[0].cells[0].firstChild.click();
  assert.equal(p.text('count'), 'To export: 1');
  await p.click('selVisible');
  assert.equal(p.text('count'), 'To export: 3');
  await p.click('selNone');
  assert.equal(p.text('count'), 'To export: 0');
  assert.deepEqual(p.errors, []);
  p.close();
});

test('export chats: ZIP with markdown, artifacts as files, index; folder option; saveAs', async () => {
  const p = await boot();
  await loadChats(p);
  p.setValue('folder', 'MyExport');
  p.check('oAsk', true);
  await p.click('exportBtn');
  const out = await finish(p);
  assert.match(out, /Done: chats 3, files \d+, errors 0\.\nFile: Downloads\/MyExport\/claude-export-\d{4}-\d{2}-\d{2}_\d{4}\.zip/);
  assert.equal(p.log.downloads.length, 1);
  assert.match(p.log.downloads[0].filename, /^MyExport\/claude-export-.*\.zip$/);
  assert.equal(p.log.downloads[0].saveAs, true);
  const zip = await p.readZip();
  const n = names(zip);
  assert.ok(n.includes('index.md'));
  assert.ok(n.includes('chats/2026-05-10 Middle_ artifacts_.md'), n.join('\n'));
  assert.ok(n.includes('artifacts/2026-05-10 Middle_ artifacts_/Design Doc.md'));
  assert.ok(n.includes('artifacts/2026-09-20 Новый чат/report.py'));
  const md = await zip.file('chats/2026-05-10 Middle_ artifacts_.md').async('string');
  assert.match(md, /^---\ntitle: "Middle: artifacts\?"/);
  assert.match(md, /# Human — 2026-09-20 10:00/);
  assert.match(md, /make a doc/);
  assert.match(md, /`\.\.\/artifacts\/2026-05-10 Middle_ artifacts_\/Design Doc\.md` \(v2\)/);
  assert.doesNotMatch(md, /thought|web_search/); // thinking and tools are off by default
  assert.equal(await zip.file('artifacts/2026-05-10 Middle_ artifacts_/Design Doc.md').async('string'), '# v2');
  assert.deepEqual(p.errors, []);
  p.close();
});

test('export with thinking/tools/inline options on, separate files mode', async () => {
  const p = await boot();
  await loadChats(p);
  p.check('oThinking', true); p.check('oTools', true); p.check('oArtifacts', false); p.check('oFront', false);
  p.w.document.querySelector('input[name=pack][value=files]').click();
  p.w.document.querySelector('input[name=mode][value=selected]').click();
  p.$('tbl').tBodies[0].rows[1].cells[0].firstChild.click(); // c-mid
  await p.click('exportBtn');
  const out = await finish(p);
  assert.match(out, /Done: chats 1, files 2, errors 0\.\nFolder: Downloads\/ClaudeExport\//);
  await waitFor(() => p.log.downloads.length === 2);
  const md = p.log.downloads.find(d => d.filename.endsWith('.md'));
  assert.match(md.filename, /^ClaudeExport\/\d{4}-\d{2}-\d{2}_\d{4}\/chats\/2026-05-10 Middle_ artifacts_\.md$/);
  const text = await p.log.blobs.get(md.url).text();
  assert.match(text, /\*\*Thinking\*\*/);
  assert.match(text, /\[tool\] web_search: q/);
  assert.match(text, /# v2/); // inlined because artifact files are off
  assert.doesNotMatch(text, /^---\n/);
  assert.ok(p.log.downloads.some(d => d.filename.endsWith('index.md')));
  p.close();
});

test('PDF option produces .pdf files next to markdown', async () => {
  const p = await boot();
  await loadChats(p);
  p.check('oPdf', true);
  await p.click('exportBtn');
  await finish(p);
  const zip = await p.readZip();
  assert.equal(names(zip).filter(n => n.endsWith('.pdf')).length, 3);
  assert.match(await zip.file(names(zip).find(n => n.endsWith('.pdf'))).async('string'), /^%PDF/);
  p.close();
});

test('must choose a format; nothing is downloaded', async () => {
  const p = await boot();
  await loadChats(p);
  p.check('oMd', false); p.check('oPdf', false);
  await p.click('exportBtn');
  assert.equal(p.text('out'), 'Choose a format: Markdown and/or PDF.');
  assert.equal(p.log.downloads.length, 0);
  p.close();
});

test('one failing chat does not stop the export: errors.log and message', async () => {
  const p = await boot({ backend: { failChats: ['c-mid'] } });
  await loadChats(p);
  await p.click('exportBtn');
  const out = await finish(p);
  assert.match(out, /chats 2, files \d+, errors 1/);
  assert.match(out, /Errors:\n.*c-mid.*HTTP 500/);
  const zip = await p.readZip();
  assert.ok(names(zip).includes('errors.log'));
  assert.match(await zip.file('errors.log').async('string'), /c-mid/);
  p.close();
});

test('cancel stops the export and saves nothing', async () => {
  const p = await boot();
  await loadChats(p);
  await p.click('exportBtn');
  await waitFor(() => !p.$('cancelBtn').hidden);
  await p.click('cancelBtn');
  const out = await finish(p);
  assert.equal(out, 'Cancelled, nothing saved.');
  assert.equal(p.log.downloads.length, 0);
  assert.equal(p.$('exportBtn').disabled, false);
  p.close();
});

test('artifacts tab: only artifacts, versions, attachments; index; nothing when none', async () => {
  const p = await boot();
  await loadChats(p);
  await p.tab('artifacts');
  assert.equal(p.$('artOpts').hidden, false);
  assert.equal(p.$('chatOpts').hidden, true);
  assert.equal(p.text('exportBtn'), 'Export artifacts');
  p.check('oAllVersions', true); p.check('oBinaries', true);
  await p.click('exportBtn');
  const out = await finish(p);
  assert.match(out, /Done: chats 2, artifacts 2, attached files 1, errors 0/);
  const n = names(await p.readZip());
  assert.ok(n.includes('artifacts/2026-05-10 Middle_ artifacts_/Design Doc.md'));
  assert.ok(n.includes('artifacts/2026-05-10 Middle_ artifacts_/versions/Design Doc.v1.md'));
  assert.ok(n.includes('artifacts/2026-05-10 Middle_ artifacts_/versions/Design Doc.v2.md'));
  assert.ok(n.includes('attachments/2026-05-10 Middle_ artifacts_/pic.webp')); // png name, webp bytes
  assert.ok(n.includes('artifacts/index.md'));
  assert.ok(!n.some(x => x.startsWith('chats/')));
  // only the chat without artifacts selected -> friendly message, no download
  p.log.downloads.length = 0;
  p.w.document.querySelector('input[name=mode][value=selected]').click();
  p.$('tbl').tBodies[0].rows[2].cells[0].firstChild.click(); // c-old
  await p.click('exportBtn');
  await waitFor(() => p.text('out').startsWith('No artifacts'));
  assert.equal(p.log.downloads.length, 0);
  p.close();
});

test('Artifacts page block: count shown, export goes to user-artifacts/', async () => {
  const p = await boot();
  await p.tab('artifacts');
  await waitFor(() => p.text('galleryStatus') === 'Artifacts on the page: 1', { what: 'gallery count' });
  assert.equal(p.$('exportBtn').hidden, true); // chat export needs the list first
  await p.click('galleryBtn');
  const out = await finish(p);
  assert.match(out, /Done: artifacts 1 from 1 chats, not found 0, errors 0/);
  const zip = await p.readZip();
  assert.ok(names(zip).includes('user-artifacts/2026-05-10 Middle_ artifacts_/Design Doc.md'));
  assert.ok(names(zip).includes('user-artifacts/index.md'));
  p.close();
});

test('Artifacts page block: artifact missing in its chat is reported', async () => {
  const p = await boot({ backend: { userArtifacts: [{ uuid: 'u', artifact_identifier: 'nope', title: 'Ghost', chat_conversation_uuid: 'c-mid', chat_conversation_name: 'Middle' }] } });
  await p.tab('artifacts');
  await p.click('galleryBtn');
  await waitFor(() => p.text('out').startsWith('No artifacts found'));
  assert.match(p.text('out'), /Ghost.*not found in the chat/);
  p.close();
});

test('projects tab: list, select, export instructions + knowledge + files', async () => {
  const p = await boot();
  await p.tab('projects');
  assert.equal(p.$('projSec').hidden, false);
  await p.click('loadProjBtn');
  await waitFor(() => p.$('projList').children.length === 2);
  assert.equal(p.text('projStatus'), 'Projects: 2');
  assert.equal(p.text('projCount'), 'Selected projects: 2');
  p.$('projList').children[1].querySelector('input').click(); // deselect Proj Two
  assert.equal(p.text('projCount'), 'Selected projects: 1');
  await p.click('exportBtn');
  const out = await finish(p);
  assert.match(out, /projects 1, knowledge files 1, project files 1, errors 0/);
  const n = names(await p.readZip());
  assert.ok(n.includes('projects/Proj One/INSTRUCTIONS.md'));
  assert.ok(n.includes('projects/Proj One/knowledge/notes.md'));
  assert.ok(n.includes('projects/Proj One/files/paper.pdf'));
  assert.ok(!n.some(x => x.includes('Proj Two')));
  p.close();
});

test('projects tab: project files can be switched off', async () => {
  const p = await boot();
  await p.tab('projects');
  await p.click('loadProjBtn');
  await waitFor(() => p.$('projList').children.length === 2);
  p.check('oProjFiles', false);
  await p.click('exportBtn');
  await finish(p);
  assert.ok(!names(await p.readZip()).some(x => x.includes('/files/')));
  p.close();
});

test('memory & skills tab', async () => {
  const p = await boot();
  await p.tab('account');
  assert.equal(p.$('accSec').hidden, false);
  assert.equal(p.$('exportBtn').disabled, false);
  await p.click('exportBtn');
  const out = await finish(p);
  assert.match(out, /skills 1, memory characters 10, errors 0/);
  const n = names(await p.readZip());
  assert.ok(n.includes('skills/index.md') && n.includes('skills/docx/DESCRIPTION.md') && n.includes('memory/claude-ai-memory.md'));
  p.check('oSkills', false); p.check('oMemory', false);
  assert.equal(p.$('exportBtn').disabled, true);
  p.close();
});

test('tabs show and hide the right sections', async () => {
  const p = await boot();
  const state = () => ['loadRow', 'main', 'chatOpts', 'artOpts', 'galleryBox', 'projSec', 'accSec', 'localSec', 'actions'].filter(id => !p.$(id).hidden);
  assert.deepEqual(state(), ['loadRow']);
  await loadChats(p);
  assert.deepEqual(state(), ['loadRow', 'main', 'chatOpts', 'actions']);
  await p.tab('artifacts');
  assert.deepEqual(state(), ['loadRow', 'main', 'artOpts', 'galleryBox', 'actions']);
  await p.tab('projects');
  assert.deepEqual(state(), ['projSec', 'actions']);
  await p.tab('account');
  assert.deepEqual(state(), ['accSec', 'actions']);
  await p.tab('local');
  assert.deepEqual(state(), ['chatOpts', 'localSec', 'actions']);
  await p.tab('chats');
  assert.deepEqual(state(), ['loadRow', 'main', 'chatOpts', 'actions']);
  assert.deepEqual(p.errors, []);
  p.close();
});

test('options are remembered between sessions', async () => {
  const p = await boot();
  p.check('oPdf', true);
  p.setValue('folder', 'Custom');
  await waitFor(() => p.store.opts?.pdf === true && p.store.opts?.folder === 'Custom');
  const p2 = await boot({ storage: { opts: p.store.opts } });
  assert.equal(p2.$('oPdf').checked, true);
  assert.equal(p2.$('folder').value, 'Custom');
  p.close(); p2.close();
});

test('diagnostics: runs, saves a JSON report, shows a summary; recording toggles', async () => {
  const p = await boot();
  await p.click('diagRun');
  await waitFor(() => p.text('diagStatus').startsWith('Report saved'), { timeout: 20000, what: 'diagnostics' });
  assert.match(p.text('diagOut'), /\[OK \] org/);
  assert.match(p.text('diagOut'), /conversations\.scan scanned=3, parsed ok\/failed=3\/0/);
  const d = p.log.downloads.find(x => /diagnostics-.*\.json$/.test(x.filename));
  const report = JSON.parse(await p.log.blobs.get(d.url).text());
  assert.ok(report.steps.every(s => s.ok), JSON.stringify(report.steps.filter(s => !s.ok)));
  assert.doesNotMatch(JSON.stringify(report), /hello old|make a doc|привет|KNOWLEDGE/); // structure only
  assert.equal(p.$('diagCopy').hidden, false);
  await p.click('diagRecStart');
  await waitFor(() => p.store.recording === true);
  assert.equal(p.$('diagRecStop').hidden, false);
  assert.equal(p.$('diagRecStart').hidden, true);
  await p.click('diagRecStop');
  await waitFor(() => p.store.recording === false);
  p.close();
});

test('API failure on list load shows an error, page stays usable', async () => {
  const fx = makeBackend();
  const orig = fx.get;
  fx.get = (path) => (/chat_conversations\?/.test(path) ? new Error('HTTP 403 (disable VPN)') : orig(path));
  const p = await loadPage({ page: 'export', fx });
  await waitFor(() => p.text('exportBtn') !== '');
  await p.click('loadBtn');
  await waitFor(() => p.text('status').startsWith('Error'));
  assert.match(p.text('status'), /HTTP 403/);
  assert.equal(p.$('main').hidden, true);
  p.close();
});

test('zip is a real, readable archive with every file non-empty', async () => {
  const p = await boot();
  await loadChats(p);
  await p.click('exportBtn');
  await finish(p);
  const zip = await p.readZip();
  for (const n of names(zip)) assert.ok((await zip.file(n).async('string')).length > 0, `${n} is empty`);
  assert.ok(getJSZip());
  p.close();
});
