// Tests of the on-disk verifier itself (tests/e2e/verify-lib.mjs) and of the generated index links.
import test from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { checkEntries, verifyDiagnostics, verifyZip, summarizeChecks, treeEntries, getJSZip, makeTempDir } from './e2e/verify-lib.mjs';
import { runExport } from '../src/core/export-run.js';
import { runArtifactsExport } from '../src/core/export-artifacts.js';
import { exportUserArtifacts } from '../src/core/user-artifacts.js';
import { exportMemoryAndSkills } from '../src/core/memory-skills.js';
import { esc, linkTarget } from '../src/core/md.js';
import { fitAll } from '../src/core/filenames.js';

const E = (path, data = 'x') => { const b = Buffer.from(data); return { path, size: b.length, read: async () => b }; };
const status = (checks, re) => checks.find(c => re.test(c.name))?.status;
const md = '---\ntitle: "T"\nsource: https://claude.ai/chat/x\n---\n\n# Human — 2026-09-20 10:00\n\nhi\n\n# Claude — 2026-09-20 10:01\n\nyo\n';

test('verifier: a clean export passes everything', async () => {
  const c = await checkEntries([E('chats/a.md', md), E('artifacts/a/f.py', 'print(1)'), E('index.md', '| [a](chats/a.md) |'), E('chats/a.pdf', '%PDF-1.4 ' + 'x'.repeat(900))]);
  assert.equal(summarizeChecks(c).FAIL, 0, JSON.stringify(c.filter(x => x.status !== 'PASS')));
  assert.equal(summarizeChecks(c).WARN, 0);
});

test('verifier: catches long paths, illegal names, duplicates, secrets files, bad pdf, broken links', async () => {
  const long = 'user-artifacts/' + 'я'.repeat(70) + '/' + 'ы'.repeat(70) + '.md'; // > 240 bytes
  const c = await checkEntries([
    E(long), E('chats/what?.md', md), E('chats/trailing .md', md), E('a/B.md'), E('a/b.md'), E('.credentials.json', '{}'),
    E('chats/x.pdf', 'not a pdf'), E('chats/y.md', md.replace('title: "T"', 'nothing')), E('index.md', '[gone](chats/gone.md)'),
    E('chats/z.md', md + '\n**Artifact: A** → `../artifacts/z/A.py`\n'),
  ]);
  for (const re of [/path length/, /Windows-safe/, /duplicate/, /credential/, /PDFs/, /chat markdown/, /index\.md links/, /artifact links/]) {
    assert.equal(status(c, re), 'FAIL', String(re));
  }
});

test('verifier: warnings for empty files, unknown top-level dirs, secret-looking text, errors.log', async () => {
  const c = await checkEntries([E('mystery/a.md', ''), E('chats/a.md', md + '\nsk-ant-api03-' + 'A'.repeat(40)), E('errors.log', 'c1: HTTP 500\nc2: HTTP 500\n')]);
  assert.equal(status(c, /no empty files/), 'WARN');
  assert.equal(status(c, /top-level layout/), 'WARN');
  assert.equal(status(c, /secret-looking/), 'WARN');
  assert.equal(status(c, /errors\.log/), 'WARN');
  assert.match(c.find(x => /errors\.log/.test(x.name)).detail, /2 error lines/);
});

test('verifier: index links with encoded spaces and parentheses resolve', async () => {
  const name = 'chats/2026-01-01 Смола (SLA) [v2].md';
  const link = linkTarget(name);
  assert.ok(!/[()\s]/.test(link.replace(/%28|%29|%20/g, '')));
  const c = await checkEntries([E(name, md), E('index.md', `| [${esc('Смола (SLA) [v2]')}](${link}) |`)]);
  assert.equal(status(c, /index\.md links/), 'PASS');
});

test('verifier: real ZIP built by JSZip incl. the Windows shell check', async () => {
  const z = new (getJSZip())();
  z.file('chats/2026-01-01 A.md', md);
  z.file('index.md', '| [A](chats/2026-01-01%20A.md) |');
  const dir = makeTempDir();
  writeFileSync(join(dir, 'ok.zip'), await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const c = await verifyZip(join(dir, 'ok.zip'));
  assert.equal(summarizeChecks(c).FAIL, 0, JSON.stringify(c.filter(x => x.status === 'FAIL')));
  writeFileSync(join(dir, 'broken.zip'), 'PK\u0003\u0004garbage');
  assert.equal((await verifyZip(join(dir, 'broken.zip')))[0].status, 'FAIL');
  const bad = new (getJSZip())();
  bad.file('user-artifacts/' + 'я'.repeat(75) + '/' + 'ы'.repeat(75) + '.md', 'x'); // the exact v0.6.0 bug
  writeFileSync(join(dir, 'long.zip'), await bad.generateAsync({ type: 'nodebuffer' }));
  const lc = await verifyZip(join(dir, 'long.zip'));
  assert.equal(status(lc, /path length/), 'FAIL');
  if (process.platform === 'win32') assert.equal(status(lc, /Windows Explorer/), 'FAIL');
});

test('verifier: loose-file tree', async () => {
  const dir = makeTempDir();
  mkdirSync(join(dir, 'chats'));
  writeFileSync(join(dir, 'chats', 'a.md'), md);
  const c = await checkEntries(treeEntries(dir), { label: 'files' });
  assert.equal(summarizeChecks(c).FAIL, 0);
});

const goodReport = () => ({
  steps: [
    { name: 'org', ok: true }, { name: 'conversations.list', ok: true },
    { name: 'conversations.scan', ok: true, scanned: 15, parsed: { ok: 15, failed: 0, artifacts: 11 }, parseErrors: [], fetchErrors: [] },
    { name: 'files.download', ok: true, preview_url: { pattern: '/api/{id}/files/{id}/preview', ok: true, status: 200, blobOk: true } },
    { name: 'projects', ok: true, count: 1, samples: [{ docs: { count: 2, withTextContent: 2 } }] },
    { name: 'user_artifacts', ok: true, join: { tried: 3, found: 3, notFound: [] } },
  ],
});

test('verifier: diagnostics report — good, and each kind of problem', () => {
  assert.equal(summarizeChecks(verifyDiagnostics(goodReport())).FAIL, 0);
  const mutate = (fn) => { const r = goodReport(); fn(r); return verifyDiagnostics(r); };
  assert.equal(status(mutate(r => { r.steps[1].ok = false; r.steps[1].error = 'HTTP 403'; }), /every step ok/), 'FAIL');
  assert.equal(status(mutate(r => { r.steps[2].parsed.failed = 1; }), /parse without errors/), 'FAIL');
  assert.equal(status(mutate(r => { r.steps[3].preview_url.blobOk = false; }), /file download/), 'FAIL');
  assert.equal(status(mutate(r => { r.steps[5].join.found = 1; }), /joins/), 'FAIL');
  assert.equal(status(mutate(r => { r.steps[4].samples[0].docs.withTextContent = 1; }), /knowledge/), 'FAIL');
  assert.equal(status(mutate(r => { r.leak = '552c09dc-ce87-45c7-8c64-a6125e23982a'; }), /no ids/), 'FAIL');
  assert.equal(status(mutate(r => { r.leak = 'me@example.com'; }), /e-mail/), 'FAIL');
  assert.equal(verifyDiagnostics('{oops')[0].status, 'FAIL');
});

// ---- Bug found by running the verifier on real exports: links with "(" ")" or "[" "]" in file names broke the index tables.
test('all generated index tables use safe link targets for tricky names', async () => {
  const tricky = 'Mixing resins (SLA) [draft] 100%';
  const detail = { uuid: 'u', name: tricky, created_at: '2026-01-01T00:00:00Z', current_leaf_message_uuid: 'b',
    chat_messages: [{ uuid: 'a', parent_message_uuid: null, sender: 'human', content: [{ type: 'text', text: 'q' }] },
      { uuid: 'b', parent_message_uuid: 'a', sender: 'assistant', content: [{ type: 'tool_use', name: 'artifacts', input: { command: 'create', id: 'x', title: tricky, type: 'text/markdown', content: 'c' } }] }] };
  const api = async () => detail;
  const r1 = await runExport({ convs: [{ uuid: 'u', name: tricky }], org: 'o', api, delay: 0, opts: { md: true, artifacts: true } });
  const r2 = await runArtifactsExport({ convs: [{ uuid: 'u', name: tricky }], org: 'o', api, delay: 0, opts: {} });
  const r3 = await exportUserArtifacts({ artifacts: [{ uuid: 'ua', artifact_identifier: 'x', title: tricky, chat_conversation_uuid: 'u', chat_conversation_name: tricky }], org: 'o', api, delay: 0 });
  const r4 = await exportMemoryAndSkills({ org: 'o', api: async () => ({ skills: [{ id: 's', name: tricky, description: 'd' }] }), opts: { skills: true } });
  for (const [label, res] of [['chats', r1], ['artifacts', r2], ['user-artifacts', r3], ['skills', r4]]) {
    const files = fitAll(res.files, 200, 170);
    const entries = files.map(f => E(f.path, typeof f.data === 'string' ? f.data : 'x'));
    const c = await checkEntries(entries, { label });
    assert.equal(status(c, /index\.md links/), 'PASS', `${label}: ${JSON.stringify(c.find(x => /index/.test(x.name)))}`);
    const idx = res.files.find(f => /index\.md$/.test(f.path)).data;
    assert.ok(!/\]\([^)]*\([^)]*\)/.test(idx.split('\n').filter(l => l.startsWith('| ')).join('\n')) || /%28/.test(idx), `${label}: raw parentheses in link`);
    assert.match(idx, /%28SLA%29/);
    assert.match(idx, /\\\[draft\\\]/);
  }
});
