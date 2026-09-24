import test from 'node:test';
import assert from 'node:assert';
import { listAllConversations } from '../src/core/conversations.js';

const mk = (a, b) => Array.from({ length: b - a }, (_, i) => ({ uuid: 'c' + (a + i) }));

test('paginates until short page', async () => {
  const pages = { 0: mk(0, 50), 50: mk(50, 70) };
  const api = async (_, { path }) => pages[+path.match(/offset=(\d+)/)[1]];
  assert.equal((await listAllConversations(api, 'o')).length, 70);
});

test('stops when API ignores offset (duplicate page)', async () => {
  let calls = 0;
  const api = async () => { calls++; return mk(0, 50); };
  assert.equal((await listAllConversations(api, 'o')).length, 50);
  assert.equal(calls, 2);
});

test('accepts {data:[...]} wrapper', async () => {
  const api = async () => ({ data: mk(0, 3) });
  assert.equal((await listAllConversations(api, 'o')).length, 3);
});
