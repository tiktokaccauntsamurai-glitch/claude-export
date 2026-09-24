import test from 'node:test';
import assert from 'node:assert';
import { applyFilter } from '../src/core/filters.js';
import { currentBranch } from '../src/core/branch.js';
import { normalizeConversation } from '../src/core/normalize.js';
import { renderMarkdown, fenceFor } from '../src/core/render-md.js';
import { mdToPdfDoc } from '../src/core/render-pdf.js';
import { safeName, uniqueName } from '../src/core/filenames.js';
import { runExport } from '../src/core/export-run.js';

test('filter: period is inclusive on both ends', () => {
  const cs = [{ uuid: 'a', updated_at: '2026-01-01T00:00:00' }, { uuid: 'b', updated_at: '2026-01-31T23:59:59' }, { uuid: 'c', updated_at: '2026-02-05T10:00:00' }];
  const r = applyFilter(cs, { mode: 'period', from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(r.map(c => c.uuid), ['a', 'b']);
});
test('filter: selected + query', () => {
  const cs = [{ uuid: 'a', name: 'Foo' }, { uuid: 'b', name: 'Bar' }];
  assert.deepEqual(applyFilter(cs, { mode: 'selected', selected: new Set(['a', 'b']), query: 'ba' }).map(c => c.uuid), ['b']);
});

const conv = {
  uuid: 'u1', name: 'Test: chat?', model: 'claude-x', created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-21T10:00:00Z',
  current_leaf_message_uuid: 'm4',
  chat_messages: [
    { uuid: 'm1', parent_message_uuid: null, index: 0, sender: 'human', created_at: '2026-09-20T10:00:00Z', content: [{ type: 'text', text: 'Привет' }], attachments: [{ file_name: 'n.txt', extracted_content: 'line1\nline2' }] },
    { uuid: 'm2', parent_message_uuid: 'm1', index: 1, sender: 'assistant', content: [{ type: 'text', text: 'old branch' }] },
    { uuid: 'm3', parent_message_uuid: 'm1', index: 1, sender: 'assistant', content: [{ type: 'text', text: 'Вот код' },
      { type: 'tool_use', name: 'artifacts', input: { command: 'create', id: 'a1', type: 'application/vnd.ant.code', language: 'python', title: 'Hello', content: 'print("hi")\n```\nx' } },
      { type: 'tool_use', name: 'artifacts', input: { command: 'update', id: 'a1', old_str: 'hi', new_str: 'hello' } },
      { type: 'tool_use', name: 'web_search', input: { query: 'q' } }] },
    { uuid: 'm4', parent_message_uuid: 'm3', index: 2, sender: 'human', content: [{ type: 'text', text: 'спасибо <antArtifact identifier="l1" type="text/markdown" title="Doc">body</antArtifact>' }] },
  ],
};

test('branch follows current leaf', () => {
  assert.deepEqual(currentBranch(conv).map(m => m.uuid), ['m1', 'm3', 'm4']);
});

test('normalize: artifact folded, deduped, legacy extracted', () => {
  const n = normalizeConversation(conv);
  const a = n.artifacts.find(x => x.id === 'a1');
  assert.equal(a.content, 'print("hello")\n```\nx');
  assert.equal(a.versions, 2);
  assert.equal(a.filename, 'Hello.py');
  assert.ok(n.artifacts.find(x => x.id === 'l1' && x.filename === 'Doc.md'));
  const refs = n.messages.flatMap(m => m.parts).filter(p => p.kind === 'artifactRef' && p.artifactId === 'a1');
  assert.equal(refs.length, 1);
});

test('markdown: fence longer than inner backticks, yaml quoted, thinking/tools off', () => {
  const n = normalizeConversation(conv);
  const md = renderMarkdown(n, { artifactPath: a => `../artifacts/x/${a.filename}` });
  assert.match(md, /^---\ntitle: "Test: chat\?"/);
  assert.match(md, /````python\nprint\("hello"\)/);
  assert.match(md, /# Human — 2026-09-20 10:00/);
  assert.match(md, /> \*\*Attachment: n\.txt\*\*\n> line1\n> line2/);
  assert.doesNotMatch(md, /web_search/);
  assert.equal(fenceFor('a ``` b'), '````');
});

test('pdf doc builds from markdown incl. cyrillic, table, list', () => {
  const md = '# Заголовок\n\nТекст **жирный** 😀\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```js\nlet a = 1;\n```\n';
  const doc = mdToPdfDoc(md, 'Тест');
  assert.ok(doc.content.length >= 5);
  assert.doesNotMatch(JSON.stringify(doc), /😀/);
});

test('filenames', () => {
  assert.equal(safeName('a/b:c?'), 'a_b_c_');
  assert.equal(safeName('CON'), '_CON');
  const used = new Set();
  assert.equal(uniqueName(used, 'x', '.md'), 'x');
  assert.equal(uniqueName(used, 'x', '.md'), 'x-2');
});

test('runExport: files, index, errors do not abort', async () => {
  const api = async (_, { path }) => {
    if (path.includes('bad')) throw new Error('HTTP 500');
    return conv;
  };
  const res = await runExport({
    convs: [{ uuid: 'u1', name: 'A' }, { uuid: 'bad', name: 'B' }], org: 'o', api,
    opts: { md: true, pdf: true, artifacts: true, inlineArtifacts: true, frontmatter: true },
    makePdf: async () => 'PDF',
  });
  const paths = res.files.map(f => f.path);
  assert.ok(paths.includes('chats/2026-09-20 Test_ chat_.md'));
  assert.ok(paths.includes('chats/2026-09-20 Test_ chat_.pdf'));
  assert.ok(paths.includes('artifacts/2026-09-20 Test_ chat_/Hello.py'));
  assert.ok(paths.includes('index.md') && paths.includes('errors.log'));
  assert.equal(res.errors.length, 1);
});
