// background.js: first-install page + the endpoint recorder used by diagnostics.
import test from 'node:test';
import assert from 'node:assert';

const listeners = {};
const store = {};
const created = [];
globalThis.browser = {
  runtime: { onInstalled: { addListener: (f) => { listeners.installed = f; } }, getURL: (p) => 'moz-extension://x/' + p },
  tabs: { create: async (o) => { created.push(o); } },
  webRequest: {
    onCompleted: { addListener: (f, filter) => { listeners.completed = f; listeners.completedFilter = filter; } },
    onSendHeaders: { addListener: (f, filter, extra) => { listeners.headers = f; listeners.headersFilter = filter; listeners.headersExtra = extra; } },
  },
  storage: { local: {
    get: async (keys) => Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, store[k]])),
    set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
  } },
};
await import('../background.js');
const settle = () => new Promise(r => setTimeout(r, 30));
const ORG = '552c09dc-ce87-45c7-8c64-a6125e23982a';

test('opens the export page on first install only', async () => {
  listeners.installed({ reason: 'update' });
  assert.equal(created.length, 0);
  listeners.installed({ reason: 'install' });
  assert.deepEqual(created, [{ url: 'moz-extension://x/export/export.html' }]);
});

test('listens only to claude.ai/api and asks for request headers (names only are stored)', () => {
  assert.deepEqual(listeners.completedFilter, { urls: ['https://claude.ai/api/*'] });
  assert.deepEqual(listeners.headersFilter, { urls: ['https://claude.ai/api/*'] });
  assert.deepEqual(listeners.headersExtra, ['requestHeaders']);
});

test('nothing is recorded unless recording is switched on', async () => {
  listeners.completed({ method: 'GET', url: `https://claude.ai/api/organizations/${ORG}/memory`, statusCode: 200 });
  await settle();
  assert.equal(store.recLog, undefined);
});

test('recording: aggregates parallel requests without losing any, merges header names, never stores values', async () => {
  store.recording = true;
  store.recLog = {};
  const reqs = Array.from({ length: 25 }, (_, i) => ({ method: 'GET', url: `https://claude.ai/api/organizations/${ORG}/thing${i % 5}?limit=${i}`, statusCode: 200 }));
  reqs.forEach(r => listeners.completed(r)); // fired at once, like a busy page
  listeners.headers({ method: 'GET', url: reqs[0].url, requestHeaders: [{ name: 'Cookie', value: 'SECRET-COOKIE' }, { name: 'X-Frame-Surface', value: 'v' }] });
  listeners.completed({ method: 'POST', url: `https://claude.ai/api/organizations/${ORG}/skills/download`, statusCode: 200 });
  listeners.completed({ method: 'GET', url: 'https://cdn.example.com/a.js', statusCode: 200 });
  await settle();
  const log = store.recLog;
  const keys = Object.keys(log);
  assert.equal(keys.filter(k => k.startsWith('GET /api/organizations/{id}/thing')).length, 5);
  assert.equal(log['GET /api/organizations/{id}/thing0?limit'].count, 5);
  assert.deepEqual(log['GET /api/organizations/{id}/thing0?limit'].headerNames, ['cookie', 'x-frame-surface']);
  assert.ok(log['POST /api/organizations/{id}/skills/download'], 'non-GET requests are recorded too');
  assert.ok(!keys.some(k => k.includes('cdn.example')));
  assert.doesNotMatch(JSON.stringify(store), /SECRET-COOKIE/);
  assert.doesNotMatch(keys.join('\n') + Object.values(log).map(e => e.pattern).join('\n'), new RegExp(ORG)); // ids scrubbed from patterns
  assert.match(log['GET /api/organizations/{id}/thing0?limit'].example, new RegExp(ORG)); // real path kept for replay (browser storage only, never in the report)
});

test('stopping the recording stops the log', async () => {
  const before = JSON.stringify(store.recLog);
  store.recording = false;
  listeners.completed({ method: 'GET', url: `https://claude.ai/api/organizations/${ORG}/late`, statusCode: 200 });
  await settle();
  assert.equal(JSON.stringify(store.recLog), before);
});
