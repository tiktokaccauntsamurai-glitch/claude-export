import { EP } from './endpoints.js';
import { normalizeConversation } from './normalize.js';
import { chatBase, uniqueName } from './filenames.js';
import { mapPool } from './export-run.js';
import { esc, linkTarget } from './md.js';

const list = (page) => (Array.isArray(page) ? page : (page?.artifacts || page?.data || []));

// The claude.ai "Artifacts" page (paged by limit/offset).
export async function listUserArtifacts(api, org, onProgress) {
  const all = [];
  const seen = new Set();
  for (let offset = 0; ; offset += 50) {
    const items = list(await api('get', { path: EP.userArtifacts(org, { limit: 50, offset }) }));
    const fresh = items.filter(a => a.uuid && !seen.has(a.uuid));
    fresh.forEach(a => { seen.add(a.uuid); all.push(a); });
    onProgress?.(all.length);
    if (items.length < 50 || !fresh.length) break;
  }
  return all;
}

export async function countUserArtifacts(api, org) {
  try {
    const r = await api('get', { path: EP.userArtifactsCount(org) });
    return typeof r?.count === 'number' ? r : null;
  } catch { return null; }
}

// The list has no content, so the final content is taken from the source chat (artifact_identifier == artifact id).
// opts: allVersions
// -> { files, errors, aborted, stats: {artifacts, chats, missing} }
export async function exportUserArtifacts({ artifacts, org, opts = {}, api, onProgress, signal, delay = 300 }) {
  const files = [];
  const errors = [];
  const rows = [];
  const used = new Set();
  const stats = { artifacts: 0, chats: 0, missing: 0 };
  let done = 0;

  const byChat = new Map();
  for (const a of artifacts) {
    const key = a.chat_conversation_uuid || '';
    if (!byChat.has(key)) byChat.set(key, []);
    byChat.get(key).push(a);
  }
  const groups = [...byChat.entries()];

  await mapPool(groups, 3, async ([chatId, wanted]) => {
    try {
      if (!chatId) throw new Error('artifact has no source chat (no chat_conversation_uuid)');
      const detail = await api('get', { path: EP.conversation(org, chatId) });
      const n = normalizeConversation(detail, { uuid: chatId, name: wanted[0].chat_conversation_name });
      const base = uniqueName(used, chatBase(n.createdAt, n.title));
      const byId = new Map(n.artifacts.map(x => [x.id, x]));
      let found = 0;
      for (const w of wanted) {
        const a = byId.get(w.artifact_identifier);
        if (!a) {
          stats.missing++;
          errors.push(`"${w.title}" (chat "${wanted[0].chat_conversation_name}"): artifact ${w.artifact_identifier} not found in the chat`);
          continue;
        }
        found++;
        stats.artifacts++;
        const path = `user-artifacts/${base}/${a.filename}`;
        files.push({ path, data: a.content });
        if (opts.allVersions && a.history.length > 1) {
          const dot = a.filename.lastIndexOf('.');
          const stem = dot > 0 ? a.filename.slice(0, dot) : a.filename;
          const ext = dot > 0 ? a.filename.slice(dot) : '';
          a.history.forEach((h, i) => files.push({ path: `user-artifacts/${base}/versions/${stem}.v${i + 1}${ext}`, data: h }));
        }
        rows.push({ date: (w.updated_at || w.created_at || '').slice(0, 10), title: w.title, type: w.code_language || w.artifact_type || '', visibility: w.visibility || '', chat: n.title, path });
      }
      if (found) stats.chats++;
    } catch (e) {
      errors.push(`chat ${chatId || '(none)'}: ${e.message}`);
    }
    onProgress?.({ done: ++done, total: groups.length, errors: errors.length });
  }, { signal, delay });

  if (rows.length) {
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const lines = rows.map(r => `| ${r.date} | ${esc(r.title)} | ${esc(r.type)} | ${esc(r.visibility)} | ${esc(r.chat)} | [${esc(r.path)}](${linkTarget(r.path.replace(/^user-artifacts\//, ''))}) |`);
    files.push({
      path: 'user-artifacts/index.md',
      data: `# Artifacts (from the Artifacts page)\n\nTotal: ${rows.length}\n\n| Date | Artifact | Type | Visibility | Chat | File |\n|---|---|---|---|---|---|\n${lines.join('\n')}\n`,
    });
  }
  if (errors.length) files.push({ path: 'errors.log', data: errors.join('\n') + '\n' });
  return { files, errors, aborted: !!signal?.aborted, stats };
}
