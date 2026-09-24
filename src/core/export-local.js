import { chatBase, safeName, uniqueName } from './filenames.js';
import { chatFiles, mapPool } from './export-run.js';
import { parseSession } from './cc-sessions.js';
import { normalizeOfficial, officialProjectFiles } from './official.js';
import { shortDir } from './local-scan.js';

const chatBaseLocal = (createdAt, title) => chatBase(createdAt, title, 50, 70);

// items: list rows from readSessionMeta ('cc', _ref = File) or readOfficial ('official', _conv).
// opts: md, pdf, artifacts, inlineArtifacts, thinking, tools, frontmatter
// -> { files, errors, aborted, stats: { chats } }
export async function runLocalExport({ items, opts, makePdf, onProgress, signal }) {
  const files = [];
  const errors = [];
  const used = new Set();
  const stats = { chats: 0 };
  let done = 0;

  await mapPool(items, 2, async (it) => {
    try {
      let n;
      let root;
      if (it.kind === 'cc') {
        const label = safeName(it.project?.name || shortDir(it._dir), 30, 40);
        n = parseSession(await it._ref.text(), { uuid: it.uuid, projectLabel: it.project?.name, created_at: it.created_at, updated_at: it.updated_at });
        root = `claude-code/${label}/`;
      } else {
        n = normalizeOfficial(it._conv);
        root = 'official-export/';
      }
      const base = uniqueName(used, `${root}${chatBaseLocal(n.createdAt || it.created_at, n.title || it.name)}`).slice(root.length);
      files.push(...await chatFiles({ n, base, opts, makePdf, root }));
      stats.chats++;
    } catch (e) {
      errors.push(`${it.kind} "${it.name}": ${e.message}`);
    }
    onProgress?.({ done: ++done, total: items.length, errors: errors.length });
  }, { signal });

  if (errors.length) files.push({ path: 'errors.log', data: errors.join('\n') + '\n' });
  return { files, errors, aborted: !!signal?.aborted, stats };
}

// Non-chat files from a scanned .claude folder. data = the File itself (read lazily by the zip/download layer).
// opts: memory, skills, md   -> [{path, data}]
export function scanFiles(scan, opts) {
  const files = [];
  if (opts.memory) {
    for (const m of scan.memory) files.push({ path: `claude-code/memory/${safeName(shortDir(m.dir), 40, 60)}/${m.rest}`, data: m.ref });
  }
  if (opts.skills) {
    // skills/<name>/... (personal) or skills/synced/<bucket>/<name>/... (claude.ai synced) -> claude-code/skills/<name>/...
    const owner = new Map(); // "<bucket>/<name>" -> folder actually used
    const folders = new Set();
    for (const s of scan.skills) {
      const segs = s.p.split('/').slice(1); // drop "skills"
      const synced = segs[0] === 'synced';
      const bucket = synced ? segs[1] : '';
      const name = synced ? segs[2] : segs[0];
      const rest = synced ? segs.slice(3) : segs.slice(1);
      if (!name || !rest.length) continue; // stray file directly in a bucket
      const key = `${bucket}/${name}`;
      if (!owner.has(key)) {
        let folder = safeName(name, 60, 90);
        if (folders.has(folder.toLowerCase())) folder = uniqueName(folders, folder); else folders.add(folder.toLowerCase());
        owner.set(key, folder);
      }
      files.push({ path: `claude-code/skills/${owner.get(key)}/${rest.join('/')}`, data: s.ref });
    }
  }
  if (opts.md) {
    for (const s of scan.claudeMd) files.push({ path: 'claude-code/CLAUDE.md', data: s.ref });
    for (const group of ['agents', 'commands', 'rules']) {
      for (const s of scan[group]) files.push({ path: `claude-code/${s.p}`, data: s.ref });
    }
  }
  return files;
}

export { officialProjectFiles };
