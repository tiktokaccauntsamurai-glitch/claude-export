import test from 'node:test';
import assert from 'node:assert';
import { runArtifactsExport } from '../src/core/export-artifacts.js';
import { listProjects, exportProjects } from '../src/core/projects.js';
import { normalizeConversation } from '../src/core/normalize.js';

const conv = {
  uuid: 'u1', name: 'Chat A', created_at: '2026-09-20T10:00:00Z', current_leaf_message_uuid: 'm2',
  chat_messages: [
    { uuid: 'm1', parent_message_uuid: null, sender: 'human', content: [{ type: 'text', text: 'hi' }],
      files: [{ file_name: 'pic.png', file_kind: 'image', preview_url: '/api/x/preview' }, { file_name: 'pic.png', file_kind: 'image', preview_url: '/api/y/preview' }, { file_name: 'bad.pdf', document_asset: { url: '/bad' } }] },
    { uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', content: [
      { type: 'tool_use', name: 'artifacts', input: { command: 'create', id: 'a', type: 'text/html', title: 'Page', content: '<p>1</p>' } },
      { type: 'tool_use', name: 'artifacts', input: { command: 'update', id: 'a', old_str: '1', new_str: '2' } },
      { type: 'tool_use', name: 'artifacts', input: { command: 'rewrite', id: 'a', content: '<p>3</p>' } },
      { type: 'tool_use', name: 'create_file', input: { path: '/mnt/out/report.md', file_text: '# r' } }] },
  ],
};

test('collector keeps version history', () => {
  const n = normalizeConversation(conv);
  const a = n.artifacts.find(x => x.id === 'a');
  assert.deepEqual(a.history, ['<p>1</p>', '<p>2</p>', '<p>3</p>']);
  assert.equal(a.content, '<p>3</p>');
  assert.equal(n.files.length, 3);
});

const apiConv = async (op, args) => {
  if (op === 'blob') {
    if (args.url === '/bad') throw new Error('HTTP 404');
    return { type: 'image/png', data: new Uint8Array([1, 2, 3]).buffer };
  }
  return conv;
};

test('artifacts export: finals, versions, binaries, index, errors', async () => {
  const res = await runArtifactsExport({
    convs: [{ uuid: 'u1', name: 'Chat A' }], org: 'o', api: apiConv, delay: 0,
    opts: { allVersions: true, binaries: true },
  });
  const paths = res.files.map(f => f.path);
  const base = '2026-09-20 Chat A';
  assert.ok(paths.includes(`artifacts/${base}/Page.html`));
  assert.ok(paths.includes(`artifacts/${base}/report.md`));
  assert.ok(paths.includes(`artifacts/${base}/versions/Page.v1.html`));
  assert.ok(paths.includes(`artifacts/${base}/versions/Page.v3.html`));
  assert.ok(paths.includes(`attachments/${base}/pic.png`));
  assert.ok(paths.includes(`attachments/${base}/pic-2.png`));
  assert.ok(paths.includes('artifacts/index.md'));
  assert.equal(res.stats.artifacts, 2);
  assert.equal(res.stats.attachments, 2);
  assert.equal(res.errors.length, 1);
  assert.ok(res.files.find(f => f.path === `artifacts/${base}/Page.html`).data === '<p>3</p>');
});

test('artifacts export: no versions / no binaries by default', async () => {
  const res = await runArtifactsExport({ convs: [{ uuid: 'u1', name: 'Chat A' }], org: 'o', api: apiConv, delay: 0, opts: {} });
  assert.ok(!res.files.some(f => f.path.includes('versions/') || f.path.startsWith('attachments/')));
});

test('projects: list tolerant, export instructions + knowledge + raw json', async () => {
  const api = async (_, { path }) => {
    if (path.endsWith('/projects')) return { data: [{ uuid: 'p1', name: 'Proj: X' }, { id: 'p2', name: 'Empty' }] };
    if (path.endsWith('/projects/p1')) return { uuid: 'p1', prompt_template: 'Be brief', description: 'D' };
    if (path.endsWith('/projects/p1/docs')) return [{ file_name: 'a.md', content: 'AAA' }, { file_name: 'a.md', content: 'BBB' }, { file_name: 'nocontent.pdf' }];
    if (path.endsWith('/projects/p2')) return { uuid: 'p2' };
    if (path.endsWith('/projects/p2/docs')) throw new Error('HTTP 404');
    if (path.endsWith('/files')) return [];
    throw new Error('unexpected ' + path);
  };
  const list = await listProjects(api, 'o');
  assert.deepEqual(list.map(p => p.uuid), ['p1', 'p2']);
  const res = await exportProjects({ projects: list, org: 'o', api, delay: 0 });
  const paths = res.files.map(f => f.path);
  assert.ok(paths.includes('projects/Proj_ X/INSTRUCTIONS.md'));
  assert.ok(paths.includes('projects/Proj_ X/DESCRIPTION.md'));
  assert.ok(paths.includes('projects/Proj_ X/knowledge/a.md'));
  assert.ok(paths.includes('projects/Proj_ X/knowledge/a-2.md'));
  assert.ok(paths.includes('projects/Proj_ X/_project.json'));
  assert.ok(paths.includes('projects/Empty/_project.json'));
  assert.equal(res.stats.knowledge, 2);
  assert.equal(res.errors.length, 2); // no-content doc + p2 docs 404
  assert.ok(paths.includes('errors.log'));
});

// Real-account shapes (from diagnostics): many tool names, thinking + tool_result blocks, image files with preview_url only.
test('normalize copes with real tool zoo: only artifact-like tools become artifacts', async () => {
  const { normalizeConversation } = await import('../src/core/normalize.js');
  const { renderMarkdown } = await import('../src/core/render-md.js');
  const c = {
    uuid: 'u', name: 'Real', created_at: '2026-09-01T00:00:00Z', current_leaf_message_uuid: 'm2',
    chat_messages: [
      { uuid: 'm1', parent_message_uuid: null, sender: 'human', text: '', content: [{ type: 'text', text: 'go' }], attachments: [], files: [{ file_name: 'i.png', file_kind: 'image', preview_url: '/api/o/files/f/preview' }], sync_sources: [], truncated: false },
      { uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', text: '', content: [
        { type: 'thinking', thinking: 'hmm', summaries: [] },
        ...['web_fetch', 'view', 'present_files', 'conversation_search', 'recent_chats', 'memory_read', 'web_search', 'message_compose_v1',
          'launch_extended_search_task', 'bash_tool', 'visualize:read_me', 'ask_user_input_v0'].flatMap(name => [
          { type: 'tool_use', name, input: { query: 'q', path: '/x' } }, { type: 'tool_result', name, content: [{ type: 'text', text: 'r' }] }]),
        { type: 'tool_use', name: 'create_file', input: { path: '/mnt/user-data/outputs/a.md', file_text: '# A' } },
        { type: 'tool_use', name: 'visualize:show_widget', input: { title: 'chart', widget_code: '<svg/>' } },
        { type: 'text', text: 'done' }] },
    ],
  };
  const n = normalizeConversation(c);
  assert.deepEqual(n.artifacts.map(a => a.filename), ['a.md', 'chart.html']);
  assert.equal(n.files[0].url, '/api/o/files/f/preview');
  const md = renderMarkdown(n, { tools: false });
  assert.doesNotMatch(md, /\[tool\]/);
  assert.match(renderMarkdown(n, { tools: true }), /\[tool\] web_search: q/);
  assert.match(md, /Artifact: a\.md/);
});
