// Fake claude.ai backend, shaped like the real responses captured by the diagnostics report.
export const ORG = 'org-1';

const msg = (uuid, parent, sender, content, extra = {}) => ({
  uuid, parent_message_uuid: parent, sender, index: 0, created_at: '2026-09-20T10:00:00Z', text: '', content,
  attachments: [], files: [], ...extra,
});

export function makeChats() {
  const chats = [
    { uuid: 'c-old', name: 'Old chat', created_at: '2026-01-05T10:00:00Z', updated_at: '2026-01-06T10:00:00Z', model: 'claude-sonnet', project_uuid: null, project: null },
    { uuid: 'c-mid', name: 'Middle: artifacts?', created_at: '2026-05-10T10:00:00Z', updated_at: '2026-05-11T10:00:00Z', model: 'claude-opus', project_uuid: 'p1', project: { name: 'Proj One' } },
    { uuid: 'c-new', name: 'Новый чат', created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-21T10:00:00Z', model: 'claude-opus', project_uuid: null, project: null },
  ];
  const details = {
    'c-old': { ...chats[0], current_leaf_message_uuid: 'b', chat_messages: [
      msg('a', null, 'human', [{ type: 'text', text: 'hello old' }]), msg('b', 'a', 'assistant', [{ type: 'text', text: 'hi from old' }])] },
    'c-mid': { ...chats[1], current_leaf_message_uuid: 'b', chat_messages: [
      msg('a', null, 'human', [{ type: 'text', text: 'make a doc' }], { files: [{ file_name: 'pic.png', file_kind: 'image', preview_url: '/api/org-1/files/f1/preview' }] }),
      msg('b', 'a', 'assistant', [
        { type: 'thinking', thinking: 'thought' },
        { type: 'tool_use', name: 'artifacts', input: { command: 'create', id: 'art-1', type: 'text/markdown', title: 'Design Doc', content: '# v1' } },
        { type: 'tool_use', name: 'artifacts', input: { command: 'rewrite', id: 'art-1', content: '# v2' } },
        { type: 'tool_use', name: 'web_search', input: { query: 'q' } },
        { type: 'text', text: 'done doc' }]),
    ] },
    'c-new': { ...chats[2], current_leaf_message_uuid: 'b', chat_messages: [
      msg('a', null, 'human', [{ type: 'text', text: 'привет' }]),
      msg('b', 'a', 'assistant', [{ type: 'tool_use', name: 'create_file', input: { path: '/mnt/out/report.py', file_text: 'print(1)' } }, { type: 'text', text: 'готово' }])] },
  };
  return { chats, details };
}

export function makeBackend(overrides = {}) {
  const { chats, details } = makeChats();
  const failing = new Set(overrides.failChats || []);
  const userArtifacts = overrides.userArtifacts ?? [
    { uuid: 'ua1', artifact_identifier: 'art-1', artifact_type: 'text/markdown', title: 'Design Doc', chat_conversation_uuid: 'c-mid', chat_conversation_name: 'Middle', visibility: 'private', updated_at: '2026-05-11T10:00:00Z', created_at: '2026-05-10T10:00:00Z' },
  ];
  const projects = [
    { uuid: 'p1', name: 'Proj One', description: 'D' },
    { uuid: 'p2', name: 'Proj Two', description: '' },
  ];
  return {
    org: ORG,
    chats, details, userArtifacts,
    get(path) {
      let m;
      if ((m = /\/chat_conversations\?limit=(\d+)&offset=(\d+)/.exec(path))) return chats.slice(+m[2], +m[2] + +m[1]);
      if ((m = /\/chat_conversations\/([^?]+)/.exec(path))) return failing.has(m[1]) ? new Error('HTTP 500 on ' + path) : (details[m[1]] || new Error('HTTP 404'));
      if (/\/user_artifacts\/count/.test(path)) return { count: userArtifacts.length, is_capped: false };
      if (/\/user_artifacts\?/.test(path)) return { artifacts: userArtifacts.slice(+/offset=(\d+)/.exec(path)[1]), next_cursor: null };
      if (/\/projects$/.test(path)) return projects;
      if ((m = /\/projects\/([^/]+)\/docs$/.exec(path))) return m[1] === 'p1' ? [{ file_name: 'notes.md', content: 'KNOWLEDGE' }] : [];
      if ((m = /\/projects\/([^/]+)\/files$/.exec(path))) return m[1] === 'p1' ? [{ file_name: 'paper.pdf', document_asset: { url: '/api/org-1/files/pdf1/document' } }] : [];
      if ((m = /\/projects\/([^/]+)$/.exec(path))) return { ...projects.find(p => p.uuid === m[1]), prompt_template: m[1] === 'p1' ? 'Be concise' : '' };
      if (/\/skills\/list-skills$/.test(path)) return { skills: [{ id: 'docx', name: 'docx', description: 'Word', creator_type: 'anthropic', source: 'anthropic-example', enabled: true }] };
      if (/\/memory\/settings$/.test(path)) return { memory_mode: 'melange' };
      if (/\/memory$/.test(path)) return { memory: 'I like tea' };
      return new Error('HTTP 404 on ' + path);
    },
    blob: (url) => (/pdf1/.test(url) ? { type: 'application/pdf', data: new Uint8Array([37, 80, 68, 70]).buffer } : { type: 'image/webp', data: new Uint8Array([1, 2, 3]).buffer }),
    probe: (path) => ({ status: /list-skills|\/memory\b|user_artifacts\?/.test(path) ? 200 : 404, ok: /list-skills|\/memory\b|user_artifacts\?/.test(path), contentType: 'application/json', size: 10,
      json: /list-skills/.test(path) ? { skills: [] } : undefined }),
  };
}
