// Runs the real content/api-client.js against a mocked browser + fetch.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let listener;
const calls = [];
let routes = {};

globalThis.browser = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };
globalThis.fetch = async (url, opts) => {
  calls.push(url);
  const r = routes[url.replace('https://claude.ai', '')];
  if (!r) return mkResp(404, 'text/html', 'nope');
  return r();
};
const mkResp = (status, ct, body) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? ct : null) },
  json: async () => JSON.parse(body),
  blob: async () => new Blob([body], { type: ct }),
  arrayBuffer: async () => new TextEncoder().encode(body).buffer,
});
vm.runInThisContext(readFileSync(new URL('../content/api-client.js', import.meta.url), 'utf8'));

const send = (op, args) => listener({ channel: 'claude-api', op, args });

test('ignores messages from other channels', () => {
  assert.equal(listener({ channel: 'other', op: 'ping' }), undefined);
});

test('ping / unknown op', async () => {
  assert.deepEqual(await send('ping'), { data: { ok: true } });
  assert.match((await send('nope')).error, /unknown op/);
});

test('orgId prefers the org with chat capability', async () => {
  routes['/api/organizations'] = () => mkResp(200, 'application/json', JSON.stringify([
    { uuid: 'api-org', capabilities: ['api'] }, { uuid: 'chat-org', capabilities: ['chat'] }]));
  assert.deepEqual(await send('orgId'), { data: 'chat-org' });
});

test('get: 404 becomes an error with the path', async () => {
  const r = await send('get', { path: '/missing' });
  assert.match(r.error, /HTTP 404 on \/missing/);
});

test('never fetches anything outside claude.ai', async () => {
  const before = calls.length;
  const r = await send('get', { path: 'https://evil.example/x' });
  assert.match(r.error, /blocked/);
  assert.equal(calls.length, before);
});

test('absolute /api/ paths (file urls) are resolved against claude.ai origin', async () => {
  routes['/api/org/files/1/preview'] = () => mkResp(200, 'image/png', 'PNGDATA');
  const r = await send('blob', { url: '/api/org/files/1/preview' });
  assert.equal(r.data.type, 'image/png');
  assert.equal(Buffer.from(r.data.data).toString(), 'PNGDATA');
});

test('probe: does not throw on 404, reports status/type/size and small json', async () => {
  routes['/api/x'] = () => mkResp(200, 'application/json; charset=utf-8', '{"a":1}');
  const ok = (await send('probe', { path: '/x' })).data;
  assert.deepEqual([ok.status, ok.ok, ok.contentType, ok.size, ok.json], [200, true, 'application/json', 7, { a: 1 }]);
  const nf = (await send('probe', { path: '/none' })).data;
  assert.deepEqual([nf.status, nf.ok, nf.json], [404, false, undefined]);
});
