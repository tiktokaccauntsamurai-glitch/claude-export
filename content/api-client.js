(() => {
  const f = (typeof content !== 'undefined' && content.fetch) ? content.fetch.bind(content) : fetch;
  const ORIGIN = 'https://claude.ai';
  const BASE = ORIGIN + '/api';

  // Only ever talk to claude.ai.
  function toUrl(p) {
    if (/^https?:/.test(p)) {
      if (!p.startsWith(ORIGIN + '/')) throw new Error('blocked non-claude.ai URL');
      return p;
    }
    return p.startsWith('/api/') ? ORIGIN + p : BASE + p;
  }

  async function getJson(path, { retries = 3 } = {}) {
    for (let i = 0; ; i++) {
      const r = await f(toUrl(path), { credentials: 'include', headers: { Accept: 'application/json' } });
      if (r.ok) return r.json();
      if ((r.status === 429 || r.status >= 500) && i < retries) {
        await new Promise(res => setTimeout(res, 1000 * 2 ** i)); // backoff 1s,2s,4s
        continue;
      }
      throw new Error(`HTTP ${r.status} on ${path}` + (r.status === 403 ? ' (disable VPN / reload the claude.ai tab)' : ''));
    }
  }

  // Binary download uses the content script's OWN fetch (same-origin, cookies included): objects from
  // content.fetch are Xray wrappers and fail with "Permission denied to access property constructor".
  async function getBlob(url) {
    const r = await fetch(toUrl(url), { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
    const data = await r.arrayBuffer();
    return { type: (r.headers.get('content-type') || '').split(';')[0], data };
  }

  // Diagnostics: never throws on HTTP errors; returns status, content type, size and (small) JSON.
  async function probe(path) {
    const r = await f(toUrl(path), { credentials: 'include', headers: { Accept: 'application/json, */*' } });
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    const b = await r.blob();
    const out = { status: r.status, ok: r.ok, contentType: ct, size: b.size };
    if (/json/.test(ct) && b.size < 5e6) {
      try { out.json = JSON.parse(await b.text()); } catch { /* not valid JSON */ }
    }
    return out;
  }

  async function getOrgId() {
    const orgs = await getJson('/organizations');
    const chat = orgs.find(o => (o.capabilities || []).includes('chat'));
    return (chat || orgs[0]).uuid;
  }

  const handlers = {
    ping: async () => ({ ok: true }),
    orgId: getOrgId,
    get: ({ path }) => getJson(path),
    blob: ({ url }) => getBlob(url),
    probe: ({ path }) => probe(path),
  };

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.channel !== 'claude-api') return; // not ours
    const h = handlers[msg.op];
    if (!h) return Promise.resolve({ error: 'unknown op ' + msg.op });
    return h(msg.args || {}).then(data => ({ data }), e => ({ error: String(e.message || e) }));
  });
})();
