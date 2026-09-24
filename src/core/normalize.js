import { currentBranch } from './branch.js';
import { ArtifactCollector } from './artifacts.js';

const toolSummary = (input = {}) =>
  String(input.query || input.url || input.command || input.path || input.file_path || input.prompt || '').slice(0, 200);

function pushText(parts, col, text) {
  const withMarkers = col.extractLegacy(text);
  withMarkers.split(/\[\[artifact:([^\]]+)\]\]/).forEach((chunk, i) => {
    if (i % 2 === 1) parts.push({ kind: 'artifactRef', artifactId: chunk });
    else if (chunk.trim()) parts.push({ kind: 'text', text: chunk.trim() });
  });
}

// An artifact edited several times is rendered once, at its last reference.
export function dedupeRefs(messages) {
  const seen = new Set();
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const parts = messages[mi].parts;
    for (let pi = parts.length - 1; pi >= 0; pi--) {
      const p = parts[pi];
      if (p.kind !== 'artifactRef') continue;
      if (seen.has(p.artifactId)) parts.splice(pi, 1);
      else seen.add(p.artifactId);
    }
  }
}

export function normalizeConversation(conv, listEntry = {}) {
  const col = new ArtifactCollector();
  const messages = [];
  const files = [];
  for (const m of currentBranch(conv)) {
    const parts = [];
    for (const a of m.attachments || []) {
      parts.push({ kind: 'attachment', name: a.file_name || a.name || 'attachment', text: a.extracted_content || '' });
    }
    for (const f of m.files || []) {
      const url = f.document_asset?.url || f.preview_asset?.url || f.preview_url || f.thumbnail_url || '';
      parts.push({ kind: 'attachment', name: f.file_name || 'file', url });
      if (url) files.push({ name: f.file_name || 'file', url, kind: f.file_kind || '' });
    }
    const blocks = Array.isArray(m.content) && m.content.length
      ? m.content
      : (m.text ? [{ type: 'text', text: m.text }] : []);
    for (const b of blocks.filter(Boolean)) {
      if (b.type === 'text' && typeof b.text === 'string') {
        pushText(parts, col, b.text);
      } else if (b.type === 'thinking') {
        const t = b.thinking || b.text || '';
        if (t.trim()) parts.push({ kind: 'thinking', text: t });
      } else if (b.type === 'tool_use') {
        const id = col.handleToolUse(b.name, b.input || {});
        if (id) parts.push({ kind: 'artifactRef', artifactId: id });
        else parts.push({ kind: 'tool', name: b.name || 'tool', summary: toolSummary(b.input) });
      }
      // tool_result: skipped
    }
    messages.push({ role: m.sender === 'human' ? 'user' : 'assistant', createdAt: m.created_at, parts });
  }
  dedupeRefs(messages);
  const uuid = conv.uuid || listEntry.uuid;
  return {
    source: 'claude.ai',
    id: uuid,
    title: conv.name || listEntry.name || 'Untitled',
    createdAt: conv.created_at || listEntry.created_at,
    updatedAt: conv.updated_at || listEntry.updated_at,
    model: conv.model || listEntry.model || '',
    projectName: conv.project?.name || listEntry.project?.name || '',
    url: uuid ? `https://claude.ai/chat/${uuid}` : '',
    messages,
    files,
    artifacts: col.list(),
  };
}
