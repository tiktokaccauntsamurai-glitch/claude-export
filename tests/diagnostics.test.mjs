import test from 'node:test';
import assert from 'node:assert';
import { shape, keyStats, scrubIds, patternOf } from '../src/core/scrub.js';
import { recordEntry, recordHeaders, selectReplayTargets } from '../src/core/recorder.js';
import { runDiagnostics } from '../src/core/diagnostics.js';

const ORG = '552c09dc-ce87-45c7-8c64-a6125e23982a';
const CONV = '11111111-2222-4333-8444-555555555555';

test('scrubIds / patternOf remove ids and query values', () => {
  assert.equal(scrubIds(`/api/organizations/${ORG}/x`), '/api/organizations/{id}/x');
  assert.equal(patternOf(`https://claude.ai/api/organizations/${ORG}/chat_conversations?limit=5&offset=10&limit=6`),
    '/api/organizations/{id}/chat_conversations?limit&offset');
});

test('shape keeps structure, never values', () => {
  const s = shape({ a: 'secret text', b: [1, 2], c: { d: null, e: true }, f: [] });
  assert.deepEqual(s, { a: 'string(11)', b: { $array: 2, $item: 'number' }, c: { d: 'null', e: 'boolean' }, f: { $array: 0 } });
  assert.doesNotMatch(JSON.stringify(s), /secret/);
  assert.equal(shape({ a: { b: { c: 1 } } }, 1).a, 'object(1 keys)');
  assert.deepEqual(keyStats([{ a: 1, b: 2 }, { a: 3 }, null]), { a: 2, b: 1 });
});

test('recorder: aggregates by pattern, ignores non-api, selects GET 200 targets', () => {
  const log = {};
  const rq = (method, url, statusCode) => recordEntry(log, { method, url, statusCode });
  rq('GET', `https://claude.ai/api/organizations/${ORG}/memory`, 200);
  rq('GET', `https://claude.ai/api/organizations/${ORG}/memory`, 200);
  rq('GET', `https://claude.ai/api/organizations/${ORG}/skills?limit=3`, 200);
  rq('GET', `https://claude.ai/api/organizations/${ORG}/chat_conversations/${CONV}?tree=True`, 200);
  rq('POST', `https://claude.ai/api/organizations/${ORG}/chat_conversations/${CONV}/completion`, 200);
  rq('GET', `https://claude.ai/api/organizations/${ORG}/gone`, 404);
  rq('GET', `https://claude.ai/api/event_logging/batch`, 200);
  rq('GET', 'https://cdn.example.com/x.js', 200);
  assert.equal(log[`GET /api/organizations/{id}/memory`].count, 2);
  assert.ok(!Object.keys(log).some(k => k.includes('cdn.example')));
  const targets = selectReplayTargets(log).map(t => t.pattern).sort();
  assert.deepEqual(targets, ['/api/organizations/{id}/memory', '/api/organizations/{id}/skills?limit']);
  assert.match(selectReplayTargets(log).find(t => t.pattern.endsWith('skills?limit')).example, /skills\?limit=3$/);
});

const detail = {
  uuid: CONV, name: 'SECRET-TITLE', created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-21T10:00:00Z', current_leaf_message_uuid: 'm2',
  chat_messages: [
    { uuid: 'm1', parent_message_uuid: null, sender: 'human', text: 'SECRET-USER-TEXT me@example.com', content: [{ type: 'text', text: 'SECRET-USER-TEXT me@example.com' }],
      files: [{ file_name: 'SECRET-FILE.png', file_kind: 'image', preview_url: `/api/${ORG}/files/${CONV}/preview` }] },
    { uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', content: [
      { type: 'thinking', thinking: 'SECRET-THOUGHT' },
      { type: 'tool_use', name: 'artifacts', input: { command: 'create', id: 'a', type: 'text/html', title: 'SECRET-ART', content: '<p>SECRET-BODY</p>' } },
      { type: 'tool_use', name: 'artifacts', input: { command: 'update', id: 'a', old_str: 'BODY', new_str: 'BODY2' } }] },
  ],
};

const jsonProbe = (json) => ({ status: 200, ok: true, contentType: 'application/json', size: 100, json });
const notFound = { status: 404, ok: false, contentType: 'text/html', size: 10 };

function mockApi(calls = []) {
  return async (op, args) => {
    calls.push([op, args?.path || args?.url]);
    if (op === 'orgId') return ORG;
    if (op === 'get') {
      if (args.path.includes('/chat_conversations?')) {
        return args.path.includes('offset=0')
          ? [{ uuid: CONV, name: 'SECRET-TITLE', updated_at: '2026-09-21', email: 'me@example.com' }] : [];
      }
      if (args.path.includes(`/chat_conversations/${CONV}`)) return detail;
      throw new Error(`HTTP 404 on ${args.path}`);
    }
    if (op === 'blob') return { type: 'image/png', data: new ArrayBuffer(4) };
    if (op === 'probe') {
      const p = args.path;
      if (p.endsWith('/projects')) return jsonProbe([{ uuid: 'p1', name: 'SECRET-PROJECT' }]);
      if (p.endsWith('/projects/p1')) return jsonProbe({ uuid: 'p1', prompt_template: 'SECRET-PROMPT' });
      if (p.endsWith('/projects/p1/docs')) return notFound;
      if (p.endsWith('/projects/p1/files')) return jsonProbe([{ file_name: 'SECRET.md', content: 'SECRET-DOC' }]);
      if (p.includes('/user_artifacts?')) return jsonProbe({ artifacts: [{ uuid: 'ua1', artifact_identifier: 'a', artifact_type: 'text/html', chat_conversation_uuid: CONV, latest_artifact_version_uuid: 'v1', title: 'SECRET-ART' }, { uuid: 'ua2', artifact_identifier: 'zzz', chat_conversation_uuid: CONV }], next_cursor: null });
      if (p.endsWith('/user_artifacts/count')) return jsonProbe({ count: 2, is_capped: false });
      if (p.endsWith('/user_artifacts/ua1/versions/v1')) return jsonProbe({ content: 'SECRET-CONTENT' });
      if (p.endsWith('/skills/list-skills')) return jsonProbe({ skills: [{ id: 'SECRETSKILL', name: 'x', source: 'user', creator_type: 'user', enabled: true, is_public_provisioned: false }, { id: 'docx', source: 'anthropic', creator_type: 'anthropic', enabled: false, is_public_provisioned: true }] });
      if (p.endsWith('/skills/SECRETSKILL/download')) return { status: 200, ok: true, contentType: 'application/zip', size: 999 };
      if (p.includes('/memory') && !p.includes('memory/')) return jsonProbe({ memory: 'SECRET-MEMORY' });
      if (p.includes('/files/')) return { status: 200, ok: true, contentType: 'image/png', size: 4 };
      if (p.startsWith('/api/organizations/') && p.endsWith('/gone')) throw new Error('boom ' + ORG);
      return notFound;
    }
    throw new Error('unexpected op ' + op);
  };
}

test('runDiagnostics: full report, validates our parser on real-shaped data, leaks no values', async () => {
  const calls = [];
  const rec = { 'GET /api/organizations/{id}/gone': { method: 'GET', pattern: '/api/organizations/{id}/gone', example: `/api/organizations/${ORG}/gone`, statuses: { 200: 1 }, count: 1, headerNames: ['accept', 'x-custom'] } };
  const steps = [];
  const rep = await runDiagnostics({ api: mockApi(calls), delay: 0, version: '9.9.9', recLog: rec, onStep: s => steps.push(s) });
  const by = Object.fromEntries(rep.steps.map(s => [s.name, s]));

  assert.deepEqual(steps, ['org', 'conversations.list', 'conversations.scan', 'files.download', 'projects', 'skills', 'user_artifacts', 'candidates', 'recorded']);
  assert.ok(rep.steps.every(s => s.ok), JSON.stringify(rep.steps.filter(s => !s.ok)));
  assert.equal(by['conversations.list'].count, 1);
  assert.equal(by['conversations.list'].offsetHonored, null);
  assert.equal(by['conversations.scan'].scanned, 1);
  assert.deepEqual([by['conversations.scan'].parsed.ok, by['conversations.scan'].parsed.failed], [1, 0]);
  assert.equal(by['conversations.scan'].parsed.artifacts, 1);
  assert.equal(by['conversations.scan'].parsed.versionsMax, 2);
  assert.deepEqual(by['conversations.scan'].blockTypes, { text: 1, thinking: 1, tool_use: 2 });
  assert.deepEqual(by['conversations.scan'].artifactCommands, { create: 1, update: 1 });
  assert.equal(by['conversations.scan'].filesWithPreviewUrl, 1);
  assert.equal(by['files.download'].preview_url.blobOk, true);
  assert.equal(by['files.download'].preview_url.blobBytes, 4);
  // docs 404 -> alternates were tried and /files worked
  assert.equal(by.projects.samples[0].docs.status, 404);
  assert.equal(by.projects.samples[0].alternates['/projects/{pid}/files'].status, 200);
  assert.equal(by.projects.samples[0].detailHasPromptTemplate, true);
  assert.equal(by.user_artifacts.list.status, 200);
  assert.deepEqual([by.user_artifacts.join.tried, by.user_artifacts.join.found, by.user_artifacts.join.notFound.length], [2, 1, 1]);
  assert.equal(by.user_artifacts.contentProbes.find(x => x.path.endsWith('versions/v1')).status, 200);
  assert.ok(Object.keys(by.skills.samples[0].probes).includes('skills/get-skill?id={id}'));
  assert.equal(by.recorded.allPatterns[0].method, 'GET');
  assert.equal(by.skills.count, 2);
  assert.equal(by.skills.enabled, 1);
  assert.deepEqual(by.skills.creatorTypes, { user: 1, anthropic: 1 });
  assert.equal(by.skills.samples[0].creatorType, 'user'); // custom skill probed first
  assert.equal(by.skills.samples[0].probes['skills/{id}/download'].contentType, 'application/zip');
  assert.deepEqual(by['conversations.scan'].fileKeys, { file_name: 1, file_kind: 1, preview_url: 1 });
  assert.ok(by['conversations.scan'].blockShapes.tool_use);
  assert.deepEqual(by['conversations.scan'].toolInputShapes.artifacts.command, 'string(6)');
  // candidate that answers is visible, others are 404
  assert.equal(by.candidates.results['/organizations/{org}/memory'].status, 200);
  assert.equal(by.candidates.results['/organizations/{org}/memory/files'].status, 404);
  // recorded replay: probe threw -> recorded as error, not a crash
  assert.equal(by.recorded.replayed, 1);
  assert.deepEqual(by.recorded.endpoints[0].pageRequestHeaders, ['accept', 'x-custom']);
  assert.match(by.recorded.endpoints[0].now.error, /boom \{id\}/);

  const text = JSON.stringify(rep);
  for (const secret of ['SECRET', 'me@example.com', ORG, CONV]) assert.ok(!text.includes(secret), `report leaks ${secret}`);
  assert.match(rep.summary, /\[OK \] conversations\.scan scanned=1, parsed ok\/failed=1\/0, artifacts=1/);
  assert.match(rep.summary, /v9\.9\.9/);
});

test('runDiagnostics: failing steps are recorded, not thrown; stops without org', async () => {
  const rep = await runDiagnostics({ api: async () => { throw new Error(`HTTP 403 on /organizations/${ORG}`); }, delay: 0 });
  assert.equal(rep.steps.length, 1);
  assert.equal(rep.steps[0].ok, false);
  assert.match(rep.steps[0].error, /HTTP 403 on \/organizations\/\{id\}/);
  assert.match(rep.summary, /\[ERR\] org/);
});

test('runDiagnostics: a chat that fails to parse is reported, scan continues', async () => {
  const bad = { ...detail, chat_messages: [{ uuid: 'x', sender: 'human', content: [{ type: 'tool_use', name: 'artifacts', input: null }], files: [null] }] };
  const api = mockApi();
  const wrapped = async (op, args) => (op === 'get' && args.path.includes(`/chat_conversations/${CONV}`) ? bad : api(op, args));
  const rep = await runDiagnostics({ api: wrapped, delay: 0 });
  const scan = rep.steps.find(s => s.name === 'conversations.scan');
  assert.equal(scan.ok, true);
  assert.equal(scan.scanned, 1);
});

test('recorder: header names only, merged into the same entry', () => {
  const log = {};
  const url = `https://claude.ai/api/organizations/${ORG}/x?a=1`;
  recordHeaders(log, { method: 'GET', url, requestHeaders: [{ name: 'Cookie', value: 'SECRET-COOKIE' }, { name: 'Anthropic-Client-Version', value: '1' }] });
  recordEntry(log, { method: 'GET', url, statusCode: 200 });
  const e = log['GET /api/organizations/{id}/x?a'];
  assert.deepEqual(e.headerNames, ['anthropic-client-version', 'cookie']);
  assert.equal(e.count, 1);
  assert.doesNotMatch(JSON.stringify(log), /SECRET-COOKIE/);
});
