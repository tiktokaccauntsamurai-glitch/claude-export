import { EP } from './endpoints.js';
import { normalizeConversation } from './normalize.js';
import { renderMarkdown } from './render-md.js';
import { chatBase, uniqueName } from './filenames.js';
import { esc, linkTarget } from './md.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function mapPool(items, n, fn, { signal, delay = 0 } = {}) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && !signal?.aborted) {
      const idx = i++;
      await fn(items[idx], idx);
      if (delay) await sleep(delay);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}


// Files for ONE normalized chat: chats/<base>.md|pdf and artifacts/<base>/<file>, all under `root`.
export async function chatFiles({ n, base, opts, makePdf, root = '' }) {
  const files = [];
  const artPath = (a) => `../artifacts/${base}/${a.filename}`;
  const mdOpts = { ...opts, inlineArtifacts: opts.inlineArtifacts || !opts.artifacts, artifactPath: opts.artifacts ? artPath : null };
  if (opts.md) files.push({ path: `${root}chats/${base}.md`, data: renderMarkdown(n, mdOpts) });
  if (opts.pdf) {
    const md = renderMarkdown(n, { ...opts, inlineArtifacts: true, frontmatter: false, artifactPath: null });
    files.push({ path: `${root}chats/${base}.pdf`, data: await makePdf(md, n.title) });
  }
  if (opts.artifacts) for (const a of n.artifacts) files.push({ path: `${root}artifacts/${base}/${a.filename}`, data: a.content });
  return files;
}

// opts: md, pdf, artifacts (separate files), inlineArtifacts, thinking, tools, frontmatter
// deps: api(op,args), makePdf(md,title)=>Promise<Blob>, onProgress({done,total,errors}), signal
export async function runExport({ convs, org, opts, api, makePdf, onProgress, signal, delay = 300 }) {
  const files = [];
  const errors = [];
  const index = [];
  const used = new Set();
  let done = 0;

  await mapPool(convs, 3, async (c) => {
    try {
      const detail = await api('get', { path: EP.conversation(org, c.uuid) });
      const n = normalizeConversation(detail, c);
      const base = uniqueName(used, chatBase(n.createdAt, n.title));
      files.push(...await chatFiles({ n, base, opts, makePdf }));
      index.push({ base, title: n.title, createdAt: n.createdAt || '', model: n.model, artifacts: n.artifacts.length });
    } catch (e) {
      errors.push(`${c.uuid} "${c.name}": ${e.message}`);
      if (e.message && !/^HTTP/.test(e.message)) console.warn('export error', c.uuid, e);
    }
    onProgress?.({ done: ++done, total: convs.length, errors: errors.length });
  }, { signal, delay });

  if (!opts.noIndex) {
    index.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const ext = opts.md ? 'md' : 'pdf';
    const rows = index.map(r =>
      `| ${r.createdAt.slice(0, 10)} | [${esc(r.title)}](${linkTarget(`chats/${r.base}.${ext}`)}) | ${esc(r.model || '')} | ${r.artifacts} |`);
    files.push({
      path: 'index.md',
      data: `# Claude export\n\nChats: ${index.length}\n\n| Date | Chat | Model | Artifacts |\n|---|---|---|---|\n${rows.join('\n')}\n`,
    });
  }
  if (errors.length) files.push({ path: 'errors.log', data: errors.join('\n') + '\n' });
  return { files, errors, aborted: !!signal?.aborted };
}
