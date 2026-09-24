// Bug: claude.ai tab opened before the extension was installed has no content script -> "Проверить подключение" hung/failed.
import test from 'node:test';
import assert from 'node:assert';

let state;
function setup({ tabs, respondsAfterReload = true, respondsInitially = true }) {
  state = { reloaded: [], created: 0, alive: new Set(respondsInitially ? tabs.map(t => t.id) : []), calls: [] };
  globalThis.browser = {
    tabs: {
      query: async (q) => (q.active ? tabs.filter(t => t.active) : tabs),
      sendMessage: async (id, msg) => {
        state.calls.push([id, msg.op]);
        if (!state.alive.has(id)) throw new Error('Could not establish connection');
        if (msg.op === 'ping') return { data: { ok: true } };
        if (msg.op === 'boom') return { error: 'HTTP 403' };
        return { data: { echoed: msg.op } };
      },
      reload: async (id) => { state.reloaded.push(id); if (respondsAfterReload) state.alive.add(id); },
      create: async () => { state.created++; const t = { id: 99 }; state.alive.add(99); return t; },
    },
  };
}

const bridge = await import('../src/io/bridge.js');
bridge._setPingDelay(0);

test('uses the tab that already has the content script, no reload', async () => {
  bridge._resetCache();
  setup({ tabs: [{ id: 7 }] });
  assert.equal(await bridge.findClaudeTab(), 7);
  assert.deepEqual(state.reloaded, []);
});

test('prefers the active claude.ai tab', async () => {
  bridge._resetCache();
  setup({ tabs: [{ id: 7 }, { id: 5, active: true }] });
  assert.equal(await bridge.findClaudeTab(), 5);
});

test('reloads a tab that has no content script (opened before install)', async () => {
  bridge._resetCache();
  setup({ tabs: [{ id: 7 }], respondsInitially: false });
  assert.equal(await bridge.findClaudeTab(), 7);
  assert.deepEqual(state.reloaded, [7]);
});

test('fails with a clear message if the tab never answers', async () => {
  bridge._resetCache();
  setup({ tabs: [{ id: 7 }], respondsInitially: false, respondsAfterReload: false });
  await assert.rejects(bridge.findClaudeTab(), /Content script/);
});

test('opens claude.ai when no tab exists', async () => {
  bridge._resetCache();
  setup({ tabs: [] });
  assert.equal(await bridge.findClaudeTab(), 99);
  assert.equal(state.created, 1);
});

test('api(): returns data, throws on {error}', async () => {
  bridge._resetCache();
  setup({ tabs: [{ id: 7 }] });
  assert.deepEqual(await bridge.api('orgId'), { echoed: 'orgId' });
  await assert.rejects(bridge.api('boom'), /HTTP 403/);
});
