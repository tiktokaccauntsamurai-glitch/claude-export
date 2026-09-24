// Phase 8: everything here is shaped like the REAL responses seen in the diagnostics report of the user's account.
import test from 'node:test';
import assert from 'node:assert';
import { listUserArtifacts, countUserArtifacts, exportUserArtifacts } from '../src/core/user-artifacts.js';
import { exportMemoryAndSkills } from '../src/core/memory-skills.js';
import { exportProjects } from '../src/core/projects.js';
import { fixExt } from '../src/core/filenames.js';
import { EP } from '../src/core/endpoints.js';

const chat = (uuid, name, artifacts) => ({
  uuid, name, created_at: '2026-09-10T10:00:00Z', current_leaf_message_uuid: 'm2',
  chat_messages: [
    { uuid: 'm1', parent_message_uuid: null, sender: 'human', content: [{ type: 'text', text: 'go' }] },
    { uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', content: artifacts.map(a => ({
      type: 'tool_use', name: 'artifacts', input: { command: 'create', id: a.id, type: 'text/markdown', title: a.title, content: a.content, language: null, version_uuid: 'v' } })) },
  ],
});
const item = (n, chatId, ident, extra = {}) => ({
  uuid: 'ua' + n, artifact_identifier: ident, artifact_type: 'text/markdown', title: 'Title ' + n, code_language: null,
  created_at: '2026-09-10T10:00:00.000000+00:00', updated_at: '2026-09-11T10:00:00.000000+00:00',
  chat_conversation_uuid: chatId, chat_conversation_name: 'Chat ' + chatId, visibility: 'private', ...extra,
});

test('endpoints: confirmed shapes are wired', () => {
  assert.equal(EP.userArtifacts('o', { limit: 50, offset: 100 }),
    '/organizations/o/user_artifacts?include_latest_published_artifact_uuid=true&limit=50&offset=100');
  assert.equal(EP.userArtifactsCount('o'), '/organizations/o/user_artifacts/count');
  assert.equal(EP.skills('o'), '/organizations/o/skills/list-skills');
  assert.equal(EP.memory('o'), '/organizations/o/memory');
  assert.equal(EP.projectFiles('o', 'p'), '/organizations/o/projects/p/files');
});

test('listUserArtifacts paginates by offset until a short page', async () => {
  const mk = (a, b) => Array.from({ length: b - a }, (_, i) => ({ uuid: 'u' + (a + i) }));
  const calls = [];
  const api = async (_, { path }) => { calls.push(path); return { artifacts: /offset=0$/.test(path) ? mk(0, 50) : mk(50, 63), next_cursor: null }; };
  assert.equal((await listUserArtifacts(api, 'o')).length, 63);
  assert.equal(calls.length, 2);
  // API ignoring offset must not loop forever
  const same = async () => ({ artifacts: mk(0, 50) });
  assert.equal((await listUserArtifacts(same, 'o')).length, 50);
});

test('countUserArtifacts: {count,is_capped} or null on failure', async () => {
  assert.deepEqual(await countUserArtifacts(async () => ({ count: 13, is_capped: false }), 'o'), { count: 13, is_capped: false });
  assert.equal(await countUserArtifacts(async () => { throw new Error('HTTP 500'); }, 'o'), null);
});

test('exportUserArtifacts: joins the page list with artifacts inside source chats', async () => {
  const chats = {
    c1: chat('c1', 'Alpha', [{ id: 'id-1', title: 'Doc One', content: '# one' }, { id: 'id-2', title: 'Doc Two', content: '# two' }]),
    c2: chat('c2', 'Beta', [{ id: 'id-3', title: 'Doc Three', content: '# three' }]),
  };
  const fetched = [];
  const api = async (_, { path }) => {
    const id = /chat_conversations\/([^?]+)/.exec(path)[1];
    fetched.push(id);
    if (!chats[id]) throw new Error('HTTP 404');
    return chats[id];
  };
  const artifacts = [item(1, 'c1', 'id-1'), item(2, 'c1', 'id-2'), item(3, 'c2', 'id-3'), item(4, 'c2', 'gone'), item(5, null, 'x'), item(6, 'c404', 'y')];
  const res = await exportUserArtifacts({ artifacts, org: 'o', api, delay: 0, opts: {} });
  const paths = res.files.map(f => f.path);
  assert.deepEqual(fetched.sort(), ['c1', 'c2', 'c404']); // one fetch per chat, not per artifact
  assert.ok(paths.includes('user-artifacts/2026-09-10 Alpha/Doc One.md'));
  assert.ok(paths.includes('user-artifacts/2026-09-10 Alpha/Doc Two.md'));
  assert.ok(paths.includes('user-artifacts/2026-09-10 Beta/Doc Three.md'));
  assert.ok(paths.includes('user-artifacts/index.md') && paths.includes('errors.log'));
  assert.deepEqual([res.stats.artifacts, res.stats.chats, res.stats.missing], [3, 2, 1]);
  assert.equal(res.errors.length, 3); // not found in chat, no source chat, chat 404
  assert.equal(res.files.find(f => f.path.endsWith('Doc One.md')).data, '# one');
  const index = res.files.find(f => f.path === 'user-artifacts/index.md').data;
  assert.match(index, /\| 2026-09-11 \| Title 1 \| text\/markdown \| private \| Alpha \|/);
});

test('exportUserArtifacts: allVersions writes versions/ for edited artifacts', async () => {
  const c = chat('c1', 'Alpha', [{ id: 'a', title: 'T', content: 'v1' }]);
  c.chat_messages[1].content.push({ type: 'tool_use', name: 'artifacts', input: { command: 'rewrite', id: 'a', content: 'v2' } });
  const res = await exportUserArtifacts({ artifacts: [item(1, 'c1', 'a')], org: 'o', api: async () => c, delay: 0, opts: { allVersions: true } });
  const paths = res.files.map(f => f.path);
  assert.ok(paths.includes('user-artifacts/2026-09-10 Alpha/versions/T.v1.md') && paths.includes('user-artifacts/2026-09-10 Alpha/versions/T.v2.md'));
  assert.equal(res.files.find(f => f.path === 'user-artifacts/2026-09-10 Alpha/T.md').data, 'v2');
});

// ---- skills + memory, shapes from the real report
const skillsResp = { skills: [
  { id: 'docx', name: 'docx', description: 'Word docs | tables\nmultiline', creator_type: 'anthropic', source: 'anthropic-example', enabled: true, updated_at: '2026-01-01T00:00:00Z' },
  { id: 'abc', name: 'my: skill?', description: 'mine', creator_type: 'user', source: 'custom', enabled: false },
  { id: 'abc2', name: 'my: skill?', description: 'dup name', creator_type: 'user', source: 'custom', enabled: false },
] };

test('memory & skills: skills list, empty memory gives a note, raw json kept', async () => {
  const api = async (_, { path }) => {
    if (path.endsWith('/skills/list-skills')) return skillsResp;
    if (path.endsWith('/memory')) return { memory: '', controls: null, updated_at: null, project_import: null, project_memory_mode: null };
    if (path.endsWith('/memory/settings')) return { memory_mode: 'melange', enabled_melange: true };
    throw new Error('unexpected ' + path);
  };
  const res = await exportMemoryAndSkills({ org: 'o', api });
  const paths = res.files.map(f => f.path);
  assert.ok(paths.includes('skills/docx/DESCRIPTION.md') && paths.includes('skills/my_ skill_/DESCRIPTION.md') && paths.includes('skills/my_ skill_-2/DESCRIPTION.md'));
  assert.ok(paths.includes('skills/skills.json') && paths.includes('skills/index.md'));
  assert.equal(res.stats.skills, 3);
  assert.ok(!paths.includes('memory/claude-ai-memory.md'));
  assert.ok(paths.includes('memory/memory-raw.json'));
  assert.deepEqual(res.notes, [{ key: 'note_memory_empty', params: { mode: 'melange' } }]);
  const index = res.files.find(f => f.path === 'skills/index.md').data;
  assert.match(index, /Word docs \\\| tables multiline/); // pipes escaped, newlines flattened
  assert.match(res.files.find(f => f.path === 'skills/docx/DESCRIPTION.md').data, /^---\nname: "docx"\nsource: "anthropic-example"[\s\S]*enabled: true/);
  assert.equal(res.errors.length, 0);
});

test('memory & skills: non-empty memory is exported as markdown; failures are collected, options respected', async () => {
  const api = async (_, { path }) => {
    if (path.endsWith('/memory')) return { memory: 'I like tea.' };
    if (path.endsWith('/memory/settings')) throw new Error('HTTP 500');
    throw new Error('should not be called: ' + path);
  };
  const res = await exportMemoryAndSkills({ org: 'o', api, opts: { skills: false, memory: true } });
  assert.equal(res.files.find(f => f.path === 'memory/claude-ai-memory.md').data, 'I like tea.');
  assert.equal(res.stats.memoryChars, 11);
  assert.equal(res.notes.length, 0);
  assert.equal(res.errors.length, 1);
  const none = await exportMemoryAndSkills({ org: 'o', api: async () => { throw new Error('nope'); }, opts: { skills: true, memory: false } });
  assert.equal(none.errors.length, 1);
});

// ---- project binary files (real shape from /projects/{id}/files)
test('projects: binary files downloaded with real content type extension, failures reported', async () => {
  const api = async (op, args) => {
    if (op === 'blob') {
      if (args.url.includes('broken')) throw new Error('HTTP 500');
      return args.url.includes('img') ? { type: 'image/webp', data: new ArrayBuffer(3) } : { type: 'application/pdf', data: new ArrayBuffer(5) };
    }
    const p = args.path;
    if (p.endsWith('/files')) return [
      { file_kind: 'document', file_name: 'paper.pdf', document_asset: { url: '/api/o/files/1/document_pdf' }, thumbnail_asset: { url: '/api/o/files/1/thumb' } },
      { file_kind: 'image', file_name: 'photo.png', preview_asset: { url: '/api/o/files/2/img' }, document_asset: null },
      { file_kind: 'document', file_name: 'broken.pdf', document_asset: { url: '/api/o/files/3/broken' } },
      { file_kind: 'document', file_name: 'nourl.pdf', document_asset: null, preview_asset: null },
    ];
    if (p.endsWith('/docs')) return [];
    return { uuid: 'p1' };
  };
  const res = await exportProjects({ projects: [{ uuid: 'p1', name: 'P' }], org: 'o', api, delay: 0 });
  const paths = res.files.map(f => f.path);
  assert.ok(paths.includes('projects/P/files/paper.pdf'));
  assert.ok(paths.includes('projects/P/files/photo.webp')); // .png name, webp bytes -> fixed extension
  assert.equal(res.stats.files, 2);
  assert.equal(res.errors.length, 2);
  const off = await exportProjects({ projects: [{ uuid: 'p1', name: 'P' }], org: 'o', api, delay: 0, withFiles: false });
  assert.ok(!off.files.some(f => f.path.includes('/files/')));
});

test('fixExt', () => {
  assert.equal(fixExt('a.png', 'image/webp'), 'a.webp');
  assert.equal(fixExt('a.PNG', 'image/png'), 'a.PNG');
  assert.equal(fixExt('a.jpeg', 'image/jpeg'), 'a.jpeg');
  assert.equal(fixExt('a', 'image/png'), 'a.png');
  assert.equal(fixExt('report', 'application/pdf'), 'report.pdf');
  assert.equal(fixExt('report.txt', 'application/pdf'), 'report.txt');
  assert.equal(fixExt('x.bin', 'application/octet-stream'), 'x.bin');
  assert.equal(fixExt('x.zip', ''), 'x.zip');
});

test('skills index table: header and rows have the same number of columns', async () => {
  const api = async (_, { path }) => (path.endsWith('/list-skills') ? skillsResp : { memory: '' });
  const res = await exportMemoryAndSkills({ org: 'o', api, opts: { skills: true, memory: false } });
  const lines = res.files.find(f => f.path === 'skills/index.md').data.split('\n').filter(l => l.startsWith('|'));
  const cols = l => l.split('\\|').join('').split('|').length; // escaped pipes are not column separators
  assert.ok(lines.length >= 4);
  for (const l of lines) assert.equal(cols(l), cols(lines[0]), l);
});
