// UI tests of the toolbar popup: real popup.js + popup.html in jsdom.
import test from 'node:test';
import assert from 'node:assert';
import { loadPage, waitFor, sleep } from './harness.mjs';
import { makeBackend } from './fixtures.mjs';

const UUID = '3f2a1b4c-1111-4222-8333-444455556666';
const chatTab = { id: 7, url: `https://claude.ai/chat/${UUID}`, title: 'Middle - Claude', active: true };
const homeTab = { id: 7, url: 'https://claude.ai/recents', title: 'Claude', active: true };

async function boot(o = {}) {
  const fx = makeBackend();
  fx.details[UUID] = { ...fx.details['c-mid'], uuid: UUID, name: 'Middle' };
  if (o.slow) { const g = fx.get; fx.get = async (p) => { await sleep(o.slow); return g(p); }; }
  const p = await loadPage({ page: 'popup', fx, tabs: o.tabs || [homeTab], permission: o.permission, storage: o.storage });
  p.fx = fx;
  await waitFor(() => p.text('expSel') !== '', { what: 'popup init' });
  return p;
}
const items = (p) => [...p.$('recent').children].map(li => li.querySelector('.t')?.textContent);
const status = async (p, re) => waitFor(() => re.test(p.text('status')), { timeout: 10000, what: `status ${re}` });

test('recent chats: 3 newest first, selection count, export selected -> flat files, no index', async () => {
  const p = await boot();
  await waitFor(() => items(p).length === 3);
  assert.deepEqual(items(p), ['Новый чат', 'Middle: artifacts?', 'Old chat']);
  assert.equal(p.$('curBox').hidden, true); // not on a chat page
  assert.equal(p.$('expSel').disabled, true);
  assert.equal(p.text('expSel'), 'Export selected (0)');
  p.$('recent').children[0].click(); // clicking the row toggles the checkbox
  p.$('recent').children[1].querySelector('input').click();
  assert.equal(p.text('expSel'), 'Export selected (2)');
  assert.equal(p.$('expSel').disabled, false);
  await p.click('expSel');
  await status(p, /^Saved 2 chat\(s\) to Downloads\/ClaudeExport\//);
  const files = p.log.downloads.map(d => d.filename).sort();
  assert.deepEqual(files, [
    'ClaudeExport/artifacts/2026-05-10 Middle_ artifacts_/Design Doc.md',
    'ClaudeExport/artifacts/2026-09-20 Новый чат/report.py',
    'ClaudeExport/chats/2026-05-10 Middle_ artifacts_.md',
    'ClaudeExport/chats/2026-09-20 Новый чат.md',
  ]);
  assert.ok(!files.some(f => f.endsWith('index.md')));
  assert.equal(p.$('expSel').disabled, false);
  assert.deepEqual(p.errors, []);
  p.close();
});

test('on a chat page: current chat box with cleaned title; export this chat', async () => {
  const p = await boot({ tabs: [chatTab] });
  assert.equal(p.$('curBox').hidden, false);
  assert.equal(p.text('curTitle'), 'Middle');
  p.check('oArtifacts', false);
  await p.click('expCur');
  await status(p, /^Saved 1 chat\(s\)/);
  assert.deepEqual(p.log.downloads.map(d => d.filename), ['ClaudeExport/chats/2026-05-10 Middle.md']);
  const md = await p.log.blobs.get(p.log.downloads[0].url).text();
  assert.match(md, /# v2/); // artifacts inlined when artifact files are off
  assert.ok(p.log.calls.some(([op, path]) => op === 'get' && path.includes(`/chat_conversations/${UUID}`)));
  p.close();
});

test('PDF checkbox is remembered and produces a .pdf', async () => {
  const p = await boot({ tabs: [chatTab] });
  p.check('oMd', false); p.check('oPdf', true);
  await waitFor(() => p.store.opts?.pdf === true && p.store.opts?.md === false);
  await p.click('expCur');
  await status(p, /^Saved 1 chat/);
  assert.ok(p.log.downloads.some(d => d.filename.endsWith('.pdf')));
  assert.ok(!p.log.downloads.some(d => d.filename.endsWith('.md') && d.filename.includes('/chats/')));
  p.close();
});

test('no format chosen -> message, nothing downloaded', async () => {
  const p = await boot({ tabs: [chatTab] });
  p.check('oMd', false); p.check('oPdf', false);
  await p.click('expCur');
  await status(p, /^Choose a format/);
  assert.equal(p.log.downloads.length, 0);
  p.close();
});

test('shows cached recent chats immediately, then refreshes from the server', async () => {
  const p = await boot({ slow: 400, storage: { recentCache: [{ uuid: 'cached', name: 'From cache', updated_at: '2026-01-01T00:00:00Z' }] } });
  assert.deepEqual(items(p), ['From cache']);
  await waitFor(() => items(p).length === 3, { what: 'live refresh' });
  assert.equal(items(p)[0], 'Новый чат');
  assert.equal(p.store.recentCache.length, 3);
  p.close();
});

test('refresh button reloads the list', async () => {
  const p = await boot();
  await waitFor(() => items(p).length === 3);
  const before = p.log.calls.filter(([op]) => op === 'get').length;
  await p.click('refresh');
  await waitFor(() => p.log.calls.filter(([op]) => op === 'get').length > before);
  p.close();
});

test('failed export chat: message contains the error, buttons come back', async () => {
  const p = await boot({ tabs: [chatTab] });
  p.fx.details[UUID] = undefined; // 404
  await p.click('expCur');
  await status(p, /Saved 0 chat\(s\)|Error/);
  assert.match(p.text('status'), /HTTP 404/);
  assert.equal(p.$('expCur').disabled, false);
  p.close();
});

test('without host permission: grant screen only', async () => {
  const p = await loadPage({ page: 'popup', fx: makeBackend(), permission: false });
  await waitFor(() => !p.$('noaccess').hidden);
  assert.equal(p.$('content').hidden, true);
  assert.equal(p.text('grantBtn'), 'Allow access to claude.ai');
  p.close();
});

test('no claude.ai tab open: offers to open it', async () => {
  const p = await loadPage({ page: 'popup', fx: makeBackend(), tabs: [{ id: 1, url: 'https://example.com/', title: 'x', active: true }] });
  await waitFor(() => !p.$('noclaude').hidden);
  assert.equal(p.$('content').hidden, true);
  await p.click('openClaude');
  assert.deepEqual(p.log.created, [{ url: 'https://claude.ai/' }]);
  p.close();
});

test('full export and the gear open the full page', async () => {
  const p = await boot();
  await p.click('full');
  await p.click('gear');
  assert.deepEqual(p.log.created.map(c => c.url), ['moz-extension://x/export/export.html', 'moz-extension://x/export/export.html']);
  p.close();
});

test('Russian popup', async () => {
  const p = await boot({ storage: { lang: 'ru' }, tabs: [chatTab] });
  assert.equal(p.text('expCur'), 'Экспортировать этот чат');
  assert.equal(p.text('expSel'), 'Экспортировать выбранные (0)');
  assert.equal(p.text('full'), 'Полный экспорт');
  await p.click('expCur');
  await status(p, /^Сохранено чатов: 1/);
  p.close();
});
