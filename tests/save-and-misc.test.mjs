import test from 'node:test';
import assert from 'node:assert';

const downloads = [];
let failNext = false;
globalThis.browser = {
  downloads: {
    onChanged: { addListener() {} },
    download: async (o) => { if (failNext) { failNext = false; throw new Error('denied'); } downloads.push(o); return downloads.length; },
  },
};
const { saveFiles } = await import('../src/io/save.js');
const { chatIdFromUrl } = await import('../src/core/urls.js');
const { applyFilter } = await import('../src/core/filters.js');
const { safeName, uniqueName, uniqueFile } = await import('../src/core/filenames.js');
const { runExport } = await import('../src/core/export-run.js');

const UUID = '3f2a1b4c-1111-4222-8333-444455556666';

// popup "export this chat" relies on this
test('chatIdFromUrl: chat pages only', () => {
  assert.equal(chatIdFromUrl(`https://claude.ai/chat/${UUID}`), UUID);
  assert.equal(chatIdFromUrl(`https://claude.ai/chat/${UUID}?x=1#y`), UUID);
  assert.equal(chatIdFromUrl(`https://claude.ai/chat/${UUID}/`), UUID);
  assert.equal(chatIdFromUrl('https://claude.ai/new'), null);
  assert.equal(chatIdFromUrl('https://claude.ai/recents'), null);
  assert.equal(chatIdFromUrl(`https://evil.com/chat/${UUID}`), null);
  assert.equal(chatIdFromUrl(undefined), null);
});

test('saveFiles flat: paths under folder, Windows-illegal chars sanitized, uniquify', async () => {
  downloads.length = 0;
  const p = await saveFiles([{ path: 'chats/what?.md', data: 'x' }, { path: 'artifacts/a b/c.py', data: 'y' }],
    { pack: 'files', folder: 'ClaudeExport', stamp: 'S', flat: true });
  assert.equal(p, 'ClaudeExport/');
  assert.deepEqual(downloads.map(d => d.filename), ['ClaudeExport/chats/what_.md', 'ClaudeExport/artifacts/a b/c.py']);
  assert.ok(downloads.every(d => d.conflictAction === 'uniquify' && d.saveAs === false));
});

test('saveFiles non-flat uses a stamp subfolder; download errors propagate', async () => {
  downloads.length = 0;
  await saveFiles([{ path: 'index.md', data: 'x' }], { pack: 'files', folder: 'F', stamp: '2026-09-24_1830' });
  assert.equal(downloads[0].filename, 'F/2026-09-24_1830/index.md');
  failNext = true;
  await assert.rejects(saveFiles([{ path: 'a.md', data: 'x' }], { pack: 'files', folder: 'F', stamp: 'S' }), /denied/);
});

// Bug: my first period-filter test used UTC timestamps; the filter works in LOCAL time (what the user picks).
test('filter period: boundaries are local-time inclusive', () => {
  const at = (y, m, d, h, mi, s) => new Date(y, m, d, h, mi, s).toISOString();
  const cs = [
    { uuid: 'before', updated_at: at(2025, 11, 31, 23, 59, 59) },
    { uuid: 'first', updated_at: at(2026, 0, 1, 0, 0, 0) },
    { uuid: 'last', updated_at: at(2026, 0, 31, 23, 59, 59) },
    { uuid: 'after', updated_at: at(2026, 1, 1, 0, 0, 0) },
  ];
  assert.deepEqual(applyFilter(cs, { mode: 'period', from: '2026-01-01', to: '2026-01-31' }).map(c => c.uuid), ['first', 'last']);
  assert.deepEqual(applyFilter(cs, { mode: 'period', from: '2026-01-31' }).map(c => c.uuid), ['last', 'after']);
  assert.equal(applyFilter(cs, { mode: 'period' }).length, 4);
});

test('filter: created_at field, project, selected intersect query', () => {
  const cs = [{ uuid: 'a', name: 'Alpha', project_uuid: 'p', created_at: '2026-03-01T12:00:00' }, { uuid: 'b', name: 'Beta', created_at: '2026-03-01T12:00:00' }];
  assert.deepEqual(applyFilter(cs, { mode: 'period', from: '2026-03-01', to: '2026-03-01', dateField: 'created_at' }).length, 2);
  assert.deepEqual(applyFilter(cs, { projectId: 'p' }).map(c => c.uuid), ['a']);
  assert.deepEqual(applyFilter(cs, { mode: 'selected', selected: new Set(['a']), query: 'beta' }), []);
});

// Bug: chat title ending with "?" gave file "…chat_" -- keep sanitising behaviour pinned.
test('safeName: Windows rules', () => {
  assert.equal(safeName('Test: chat?'), 'Test_ chat_');
  assert.equal(safeName('name. '), 'name');
  assert.equal(safeName('   '), 'untitled');
  assert.equal(safeName(''), 'untitled');
  assert.equal(safeName(null), 'untitled');
  assert.equal(safeName('nul'), '_nul');
  assert.equal(safeName('COM1.txt'), '_COM1.txt');
  assert.equal(safeName('a'.repeat(300), 50).length, 50);
  assert.equal(safeName('Привет мир 😀'), 'Привет мир 😀');
  assert.equal(safeName('a\u0000b\tc'), 'a_b_c');
});

test('uniqueName / uniqueFile are case-insensitive and keep extensions', () => {
  const used = new Set();
  assert.equal(uniqueFile(used, 'Pic.png'), 'Pic.png');
  assert.equal(uniqueFile(used, 'pic.PNG'), 'pic-2.PNG');
  assert.equal(uniqueFile(used, 'noext'), 'noext');
  assert.equal(uniqueFile(used, 'noext'), 'noext-2');
  assert.equal(uniqueName(new Set(['x']), 'x'), 'x-2');
});

const conv = {
  uuid: 'u1', name: 'Chat', created_at: '2026-09-20T10:00:00Z', current_leaf_message_uuid: 'm2',
  chat_messages: [
    { uuid: 'm1', parent_message_uuid: null, sender: 'human', content: [{ type: 'text', text: 'hi' }] },
    { uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', content: [
      { type: 'tool_use', name: 'artifacts', input: { command: 'create', id: 'a', type: 'application/vnd.ant.code', language: 'python', title: 'T', content: 'print(1)' } }] },
  ],
};

// popup quick export must not write index.md; without separate artifact files they must be inlined, not lost.
test('runExport: noIndex, and artifacts are inlined when not exported as files', async () => {
  const api = async () => conv;
  const res = await runExport({ convs: [{ uuid: 'u1', name: 'Chat' }], org: 'o', api, delay: 0,
    opts: { md: true, artifacts: false, inlineArtifacts: false, frontmatter: false, noIndex: true } });
  assert.deepEqual(res.files.map(f => f.path), ['chats/2026-09-20 Chat.md']);
  assert.match(res.files[0].data, /print\(1\)/);
});

test('runExport: artifacts as files link relatively and can skip inline copy', async () => {
  const api = async () => conv;
  const res = await runExport({ convs: [{ uuid: 'u1', name: 'Chat' }], org: 'o', api, delay: 0,
    opts: { md: true, artifacts: true, inlineArtifacts: false, frontmatter: false } });
  const md = res.files.find(f => f.path.endsWith('.md') && f.path.startsWith('chats/')).data;
  assert.match(md, /`\.\.\/artifacts\/2026-09-20 Chat\/T\.py`/);
  assert.doesNotMatch(md, /print\(1\)/);
  assert.ok(res.files.some(f => f.path === 'artifacts/2026-09-20 Chat/T.py' && f.data === 'print(1)'));
});

test('runExport: cancelled run reports aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  const res = await runExport({ convs: [{ uuid: 'u1', name: 'C' }], org: 'o', api: async () => conv, signal: ac.signal, delay: 0, opts: { md: true } });
  assert.equal(res.aborted, true);
});
