export const fenceFor = (content) => {
  const maxRun = (content.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
  return '`'.repeat(Math.max(3, maxRun + 1));
};

const fmt = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '');
const extOf = (name) => (name.includes('.') ? name.split('.').pop() : '');

function frontmatter(n, exportedAt) {
  const lines = ['---', `title: ${JSON.stringify(n.title)}`];
  if (n.url) lines.push(`source: ${n.url}`);
  if (n.model) lines.push(`model: ${JSON.stringify(n.model)}`);
  if (n.projectName) lines.push(`project: ${JSON.stringify(n.projectName)}`);
  if (n.createdAt) lines.push(`created: ${n.createdAt}`);
  if (n.updatedAt) lines.push(`updated: ${n.updatedAt}`);
  lines.push(`exported: ${exportedAt}`, '---', '');
  return lines.join('\n');
}

// opts: inlineArtifacts, thinking, tools, frontmatter, exportedAt, artifactPath(a) => relative path | null
export function renderMarkdown(n, o = {}) {
  const opts = { inlineArtifacts: true, thinking: false, tools: false, frontmatter: true, exportedAt: new Date().toISOString(), artifactPath: null, ...o };
  const byId = new Map(n.artifacts.map(a => [a.id, a]));
  const out = [];
  if (opts.frontmatter) out.push(frontmatter(n, opts.exportedAt));

  for (const m of n.messages) {
    const body = [];
    for (const p of m.parts) {
      if (p.kind === 'text') {
        body.push(p.text);
      } else if (p.kind === 'thinking') {
        if (opts.thinking) body.push('> **Thinking**\n' + p.text.split('\n').map(l => '> ' + l).join('\n'));
      } else if (p.kind === 'tool') {
        if (opts.tools) body.push(`*[tool] ${p.name}${p.summary ? ': ' + p.summary : ''}*`);
      } else if (p.kind === 'attachment') {
        const head = `> **Attachment: ${p.name}**`;
        if (p.text) body.push(head + '\n' + p.text.split('\n').map(l => '> ' + l).join('\n'));
        else body.push(head + (p.url ? `\n> ${p.url}` : ''));
      } else if (p.kind === 'artifactRef') {
        const a = byId.get(p.artifactId);
        if (!a) continue;
        const path = opts.artifactPath?.(a);
        let s = `**Artifact: ${a.title}**` + (path ? ` → \`${path}\`` : '') + (a.versions > 1 ? ` (v${a.versions})` : '');
        if (opts.inlineArtifacts) {
          const f = fenceFor(a.content);
          s += `\n\n${f}${a.language || extOf(a.filename)}\n${a.content}\n${f}`;
        }
        body.push(s);
      }
    }
    if (!body.length) continue;
    out.push(`# ${m.role === 'user' ? 'Human' : 'Claude'}${m.createdAt ? ' — ' + fmt(m.createdAt) : ''}`, '', body.join('\n\n'), '');
  }
  return out.join('\n');
}
