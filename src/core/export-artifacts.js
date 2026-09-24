import { EP } from './endpoints.js';
import { normalizeConversation } from './normalize.js';
import { chatBase, uniqueName, uniqueFile, fixExt, safeName } from './filenames.js';
import { mapPool } from './export-run.js';
import { esc, linkTarget } from './md.js';


// Artifacts only (no chat text). opts: allVersions, binaries, noIndex
// -> { files, errors, aborted, stats: {chats, artifacts, attachments} }
export async function runArtifactsExport({ convs, org, opts, api, onProgress, signal, delay = 300 }) {
  const files = [];
  const errors = [];
  const rows = [];
  const used = new Set();
  const stats = { chats: 0, artifacts: 0, attachments: 0 };
  let done = 0;

  await mapPool(convs, 3, async (c) => {
    try {
      const detail = await api('get', { path: EP.conversation(org, c.uuid) });
      const n = normalizeConversation(detail, c);
      const base = uniqueName(used, chatBase(n.createdAt, n.title));
      let found = 0;

      for (const a of n.artifacts) {
        found++;
        stats.artifacts++;
        const path = `artifacts/${base}/${a.filename}`;
        files.push({ path, data: a.content });
        if (opts.allVersions && a.history.length > 1) {
          const dot = a.filename.lastIndexOf('.');
          const stem = dot > 0 ? a.filename.slice(0, dot) : a.filename;
          const ext = dot > 0 ? a.filename.slice(dot) : '';
          a.history.forEach((h, i) => files.push({ path: `artifacts/${base}/versions/${stem}.v${i + 1}${ext}`, data: h }));
        }
        rows.push({ date: (n.createdAt || '').slice(0, 10), chat: n.title, title: a.title, type: a.language || a.type || '', versions: a.versions, path });
      }

      if (opts.binaries) {
        const usedFiles = new Set();
        for (const f of n.files) {
          try {
            const r = await api('blob', { url: f.url });
            const name = uniqueFile(usedFiles, fixExt(safeName(f.name, 80, 100), r.type));
            files.push({ path: `attachments/${base}/${name}`, data: new Blob([r.data], { type: r.type }) });
            stats.attachments++;
            found++;
          } catch (e) {
            errors.push(`${c.uuid} "${c.name}" file "${f.name}": ${e.message}`);
          }
        }
      }
      if (found) stats.chats++;
    } catch (e) {
      errors.push(`${c.uuid} "${c.name}": ${e.message}`);
    }
    onProgress?.({ done: ++done, total: convs.length, errors: errors.length });
  }, { signal, delay });

  if (!opts.noIndex && rows.length) {
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const lines = rows.map(r => `| ${r.date} | ${esc(r.chat)} | ${esc(r.title)} | ${esc(r.type)} | ${r.versions} | [${esc(r.path)}](${linkTarget(r.path.replace(/^artifacts\//, ''))}) |`);
    files.push({
      path: 'artifacts/index.md',
      data: `# Artifacts\n\nTotal: ${rows.length}\n\n| Date | Chat | Artifact | Type | Versions | File |\n|---|---|---|---|---|---|\n${lines.join('\n')}\n`,
    });
  }
  if (errors.length) files.push({ path: 'errors.log', data: errors.join('\n') + '\n' });
  return { files, errors, aborted: !!signal?.aborted, stats };
}
