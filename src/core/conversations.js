import { EP } from './endpoints.js';

// `api(op, args)` is injected so this stays testable without browser.*
export async function listAllConversations(api, org, onProgress) {
  const all = [];
  const seen = new Set();
  for (let offset = 0; ; offset += 50) {
    const page = await api('get', { path: EP.conversations(org, { limit: 50, offset }) });
    const items = Array.isArray(page) ? page : (page.data || page.conversations || []);
    const fresh = items.filter(c => !seen.has(c.uuid));
    fresh.forEach(c => { seen.add(c.uuid); all.push(c); });
    onProgress?.(all.length);
    if (items.length < 50 || fresh.length === 0) break; // end, or API ignores offset
  }
  return all;
}
