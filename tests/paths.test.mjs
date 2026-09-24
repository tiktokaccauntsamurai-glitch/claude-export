// Bug (real account, v0.6.0): the exported ZIP could not be opened by Windows Explorer ("folder is invalid").
// Cause: ONE entry name was 266 UTF-8 bytes (Cyrillic = 2 bytes/char); Explorer rejects the whole archive above ~260.
import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clip, safeName, fitPath, fitAll, utf8Bytes, chatBase, PATH_MAX_BYTES, PATH_MAX_CHARS } from '../src/core/filenames.js';
import { runExport } from '../src/core/export-run.js';
import { runArtifactsExport } from '../src/core/export-artifacts.js';
import { exportUserArtifacts } from '../src/core/user-artifacts.js';
import { exportProjects } from '../src/core/projects.js';
import { exportMemoryAndSkills } from '../src/core/memory-skills.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RU = 'Кандидатский минимум по специальности компактные ответы с проверенными источниками и ссылками на литературу';
const long = (n) => RU.repeat(3).slice(0, n);

test('clip / safeName respect chars AND bytes, never split characters', () => {
  assert.equal(clip('абвгд', 3), 'абв');
  assert.equal(clip('абвгд', 99, 5), 'аб'); // 2 bytes per char
  assert.equal(clip('a😀b', 99, 4), 'a'); // emoji is 4 bytes, does not fit next to 'a' within 4? a(1)+😀(4)=5 > 4
  assert.equal(clip('a😀b', 99, 5), 'a😀');
  assert.equal(utf8Bytes('аб😀a'), 2 + 2 + 4 + 1);
  const n = safeName(long(200), 80, 99);
  assert.ok(utf8Bytes(n) <= 99 && Array.from(n).length <= 80);
  assert.equal(safeName('Test: chat?'), 'Test_ chat_'); // unchanged behaviour
  assert.equal(safeName('a'.repeat(300), 50).length, 50);
  assert.ok(!/[. ]$/.test(safeName('слово. ' + 'я'.repeat(80), 6, 99)));
});

test('the exact name from the bug report is now within budget', () => {
  const title = 'Подготовка ответов для поступления в аспирантуру';
  const file = 'Кандидатский минимум по специальности 2.5.5_ компактные ответы с проверенными источниками.md';
  const stem = safeName(file.replace(/\.md$/, ''), 56, 62);
  const p = `user-artifacts/${chatBase('2026-08-17T00:00:00Z', title)}/${stem}.md`;
  assert.ok(utf8Bytes(p) < 260 - 30, `${utf8Bytes(p)} bytes: ${p}`);
});

test('fitPath shrinks long segments, keeps extension and structure; fitAll keeps names unique', () => {
  const p = `user-artifacts/${long(80)}/${long(80)}.md`;
  const f = fitPath(p, 200, 170);
  assert.ok(utf8Bytes(f) <= 200 && Array.from(f).length <= 170, `${utf8Bytes(f)}`);
  assert.ok(f.startsWith('user-artifacts/') && f.endsWith('.md') && f.split('/').length === 3);
  assert.equal(fitPath('chats/a.md', 200, 170), 'chats/a.md');
  const two = fitAll([{ path: p, data: 1 }, { path: p + '', data: 2 }, { path: 'x.md', data: 3 }], 200, 170);
  assert.equal(new Set(two.map(x => x.path.toLowerCase())).size, 3);
  assert.ok(two.every(x => utf8Bytes(x.path) <= 200));
  assert.ok(two[0].data === 1 && two[1].data === 2);
});

// ---- adversarial titles through EVERY exporter: no raw path may approach the limit
const LIMIT = 230; // raw module output; the save layer additionally fits to 200
const badTitle = long(200);
const detail = {
  uuid: 'u1', name: badTitle, created_at: '2026-08-17T10:00:00Z', current_leaf_message_uuid: 'm2',
  chat_messages: [
    { uuid: 'm1', parent_message_uuid: null, sender: 'human', content: [{ type: 'text', text: 'go' }],
      files: [{ file_name: long(200) + '.png', file_kind: 'image', preview_url: '/api/o/files/1/preview' }] },
    { uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', content: [
      { type: 'tool_use', name: 'artifacts', input: { command: 'create', id: 'a', type: 'text/markdown', title: long(200), content: 'v1' } },
      { type: 'tool_use', name: 'artifacts', input: { command: 'rewrite', id: 'a', content: 'v2' } },
      { type: 'tool_use', name: 'create_file', input: { path: '/mnt/' + long(200) + '.md', file_text: 'x' } }] },
  ],
};
const api = async (op) => (op === 'blob' ? { type: 'image/png', data: new ArrayBuffer(2) } : detail);
const assertFits = (files, what) => {
  for (const f of files) {
    assert.ok(utf8Bytes(f.path) <= LIMIT, `${what}: ${utf8Bytes(f.path)} bytes > ${LIMIT}: ${f.path}`);
    for (const seg of f.path.split('/')) assert.ok(seg === seg.trimEnd() && !seg.endsWith('.'), `${what}: bad segment "${seg}"`);
  }
};

test('all exporters keep every path short enough for Windows, with worst-case Cyrillic names', async () => {
  const r1 = await runExport({ convs: [{ uuid: 'u1', name: badTitle }], org: 'o', api, delay: 0,
    opts: { md: true, pdf: true, artifacts: true, inlineArtifacts: false, frontmatter: true }, makePdf: async () => 'PDF' });
  assertFits(r1.files, 'chats');
  const r2 = await runArtifactsExport({ convs: [{ uuid: 'u1', name: badTitle }], org: 'o', api, delay: 0, opts: { allVersions: true, binaries: true } });
  assertFits(r2.files, 'artifacts');
  assert.ok(r2.files.length >= 6);
  const ua = { uuid: 'x', artifact_identifier: 'a', title: long(200), chat_conversation_uuid: 'u1', chat_conversation_name: badTitle };
  const r3 = await exportUserArtifacts({ artifacts: [ua], org: 'o', api, delay: 0, opts: { allVersions: true } });
  assertFits(r3.files, 'user-artifacts');
  assert.equal(r3.stats.artifacts, 1);
  const papi = async (op, args) => {
    if (op === 'blob') return { type: 'application/pdf', data: new ArrayBuffer(2) };
    if (args.path.endsWith('/docs')) return [{ file_name: long(200) + '.md', content: 'c' }];
    if (args.path.endsWith('/files')) return [{ file_name: long(200) + '.pdf', document_asset: { url: '/api/o/files/1/doc' } }];
    return { uuid: 'p1', prompt_template: 'x' };
  };
  const r4 = await exportProjects({ projects: [{ uuid: 'p1', name: long(200) }], org: 'o', api: papi, delay: 0 });
  assertFits(r4.files, 'projects');
  assert.ok(r4.files.some(f => f.path.includes('/knowledge/')) && r4.files.some(f => f.path.includes('/files/')));
  const sapi = async () => ({ skills: [{ id: 'a', name: long(200), description: 'd', enabled: true }] });
  const r5 = await exportMemoryAndSkills({ org: 'o', api: sapi, opts: { skills: true, memory: false } });
  assertFits(r5.files, 'skills');
});

// ---- End-to-end on Windows: the real Explorer engine (Shell.Application) must open our ZIP.
test('Windows shell opens a ZIP built from worst-case names', { skip: process.platform !== 'win32' }, async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;
  vm.runInThisContext(readFileSync(join(ROOT, 'vendor/jszip.min.js'), 'utf8'));
  const { buildZip } = await import('../src/io/zip.js');
  const r = await runArtifactsExport({ convs: [{ uuid: 'u1', name: badTitle }], org: 'o', api, delay: 0, opts: { allVersions: true, binaries: true } });
  // deliberately long file on top of the module output, as in the real report
  const files = fitAll([...r.files, { path: `user-artifacts/${chatBase('2026-08-17', long(60))}/${long(90)}.md`, data: 'x' }], PATH_MAX_BYTES, PATH_MAX_CHARS);
  // JSZip cannot read Blob in Node (no FileReader); the browser can. Only the test converts.
  const plain = await Promise.all(files.map(async f => (f.data instanceof Blob ? { ...f, data: new Uint8Array(await f.data.arrayBuffer()) } : f)));
  const blob = await buildZip(plain);
  const zipPath = join(mkdtempSync(join(tmpdir(), 'cxzip-')), 'claude-export.zip');
  writeFileSync(zipPath, Buffer.from(await blob.arrayBuffer()));
  const out = execFileSync('powershell', ['-NoProfile', '-File', resolve(ROOT, 'tests/helpers/shellzip.ps1'), '-Paths', zipPath], { encoding: 'utf8' });
  assert.match(out, /opens, [1-9]\d* top-level items/, out);
});
