import { ArtifactCollector } from './artifacts.js';
import { dedupeRefs } from './normalize.js';

// Claude Code session files: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl (undocumented, so parse defensively).
// One assistant turn is spread over MANY assistant lines (one content block each) interleaved with tool_result "user" lines.

export function parseLines(text) {
  const out = [];
  for (const l of text.split('\n')) {
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch { /* partial or corrupt line */ }
  }
  return out;
}

export function cleanUserText(s) {
  return String(s ?? '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1')
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, ' $1')
    .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, '$1')
    .trim();
}

const blocksOf = (content) => (typeof content === 'string' ? [{ type: 'text', text: content }] : (Array.isArray(content) ? content.filter(Boolean) : []));
const toolSummary = (i = {}) => String(i.command || i.file_path || i.pattern || i.url || i.description || i.prompt || i.skill || i.query || '').slice(0, 200);
const norm = (p) => String(p).replace(/\\/g, '/');

// Real user prompt text of a line, or null when the line is only tool results / meta.
function userPrompt(l) {
  if (l.type !== 'user' || l.isMeta || l.isSidechain || !l.message) return null;
  const blocks = blocksOf(l.message.content);
  const texts = blocks.filter(b => b.type === 'text').map(b => cleanUserText(b.text)).filter(Boolean);
  const images = blocks.filter(b => b.type === 'image').length;
  if (!texts.length && !images) return null;
  return [...texts, ...(images ? ['[image]'] : [])];
}

// Cheap listing info from the first and last 64 KB of a (possibly 16 MB) session file.
export async function readSessionMeta(file, dirName, label = dirName) {
  const CH = 65536;
  const size = file.size;
  const big = size > 2 * CH;
  const head = parseLines(big ? dropPartialTail(await file.slice(0, CH).text()) : await file.text());
  const tail = big ? parseLines(dropPartialHead(await file.slice(size - CH).text())) : [];
  const all = [...head, ...tail];
  let title = null;
  let firstPrompt = null;
  let cwd = '';
  for (const l of all) {
    if (l.type === 'ai-title' && l.aiTitle) title = l.aiTitle;
    if (!firstPrompt) { const p = userPrompt(l); if (p) firstPrompt = p[0]; }
    if (!cwd && l.cwd) cwd = l.cwd;
  }
  if (!title && !firstPrompt) return null; // no conversation in this file
  const stamps = (arr) => arr.map(l => l.timestamp).filter(Boolean);
  const created = stamps(head)[0] || null;
  const last = stamps(tail.length ? tail : head).at(-1) || null;
  const modified = file.lastModified ? new Date(file.lastModified).toISOString() : null;
  const cwdLabel = cwd ? norm(cwd).split('/').filter(Boolean).at(-1) : '';
  return {
    uuid: String(file.name || '').replace(/\.jsonl$/i, ''),
    name: (title || firstPrompt).replace(/\s+/g, ' ').slice(0, 100),
    created_at: created || modified || '',
    updated_at: last || modified || created || '',
    model: '', kind: 'cc', size, _ref: file, _dir: dirName,
    project_uuid: dirName, project: { name: cwdLabel || label },
  };
}
const dropPartialTail = (s) => s.slice(0, s.lastIndexOf('\n') + 1);
const dropPartialHead = (s) => s.slice(s.indexOf('\n') + 1);

export function parseSession(text, meta = {}) {
  const lines = parseLines(text);
  const col = new ArtifactCollector();
  const turns = [];
  let cur = null;
  let title = null;
  let model = '';
  let cwd = '';
  let first = null;
  let last = null;

  for (const l of lines) {
    if (l.timestamp) { first ??= l.timestamp; last = l.timestamp; }
    if (l.type === 'ai-title' && l.aiTitle) title = l.aiTitle;
    if (!cwd && l.cwd) cwd = l.cwd;
    if (l.isSidechain) continue;

    const prompt = userPrompt(l);
    if (prompt) {
      turns.push({ role: 'user', createdAt: l.timestamp, parts: prompt.map(text => ({ kind: 'text', text })) });
      cur = null;
      continue;
    }
    if (l.type !== 'assistant' || !l.message) continue; // tool_result carriers, attachments, mode lines...
    if (!model && l.message.model && !/synthetic/i.test(l.message.model)) model = l.message.model;
    if (!cur) { cur = { role: 'assistant', createdAt: l.timestamp, parts: [] }; turns.push(cur); }
    for (const b of blocksOf(l.message.content)) {
      if (b.type === 'text' && b.text?.trim()) cur.parts.push({ kind: 'text', text: b.text.trim() });
      else if (b.type === 'thinking' && b.thinking?.trim()) cur.parts.push({ kind: 'thinking', text: b.thinking });
      else if (b.type === 'tool_use') cur.parts.push(...toolParts(b, col));
    }
  }

  const messages = turns.filter(t => t.parts.length);
  dedupeRefs(messages);
  const firstUser = messages.find(m => m.role === 'user')?.parts[0]?.text || '';
  return {
    source: 'claude-code',
    id: meta.sessionId || meta.uuid || '',
    title: (title || firstUser || meta.uuid || 'Untitled').replace(/\s+/g, ' ').slice(0, 100),
    createdAt: first || meta.created_at || '', updatedAt: last || meta.updated_at || '',
    model, projectName: meta.projectLabel || (cwd ? norm(cwd).split('/').filter(Boolean).at(-1) : ''), url: '',
    messages, files: [], artifacts: col.list(),
  };
}

// Write/Edit/MultiEdit are replayed into "artifacts" (final file content, with version history).
function toolParts(b, col) {
  const i = b.input || {};
  const path = i.file_path ? norm(i.file_path) : '';
  if (b.name === 'Write' && path) {
    const id = col.handleToolUse('create_file', { path, file_text: i.content ?? '' });
    col.map.get(id).title = path;
    return [{ kind: 'artifactRef', artifactId: id }];
  }
  if ((b.name === 'Edit' || b.name === 'MultiEdit') && path) {
    const id = 'file:' + path;
    const a = col.map.get(id);
    if (a) {
      const edits = b.name === 'MultiEdit' ? (i.edits || []) : [i];
      for (const e of edits) {
        if (typeof e.old_string !== 'string') continue;
        a.content = e.replace_all ? a.content.split(e.old_string).join(e.new_string ?? '') : a.content.replace(e.old_string, () => e.new_string ?? '');
      }
      a.versions++;
      a.history.push(a.content);
      return [{ kind: 'artifactRef', artifactId: id }];
    }
  }
  return [{ kind: 'tool', name: b.name || 'tool', summary: toolSummary(i) }];
}
