import { normalizeConversation } from './normalize.js';
import { safeName, uniqueName, uniqueFile } from './filenames.js';

// The official "Export data" archive from claude.ai (Settings -> Privacy): conversations.json (+ projects.json, ...).
// Messages are linear (no parent pointers), so normalizeConversation's index fallback applies.

export function normalizeOfficial(conv) {
  return normalizeConversation({ ...conv, current_leaf_message_uuid: undefined }, conv);
}

const isConversations = (j) => Array.isArray(j) && j.some(c => c && Array.isArray(c.chat_messages));
const isProjects = (j) => Array.isArray(j) && j.length > 0 && j.every(p => p && typeof p === 'object' && ('docs' in p || 'prompt_template' in p || 'name' in p)) && !isConversations(j);

// zipEntries: [{name, text()}]  (from JSZip); for a bare .json pass one entry.
// -> { conversations: listItems, projects: json|null, memories: {name,text}|null, warnings: [] }
export async function readOfficial(entries) {
  const res = { conversations: [], projects: null, memories: null, warnings: [] };
  for (const e of entries) {
    const base = e.name.split('/').pop().toLowerCase();
    if (!base.endsWith('.json')) continue;
    let json;
    try { json = JSON.parse(await e.text()); } catch { res.warnings.push(`${e.name}: not valid JSON`); continue; }
    if (base === 'conversations.json' || isConversations(json)) {
      for (const c of Array.isArray(json) ? json : []) {
        if (!c || !c.uuid || !Array.isArray(c.chat_messages)) continue;
        res.conversations.push({
          uuid: c.uuid, name: c.name || c.summary || '', created_at: c.created_at || '', updated_at: c.updated_at || c.created_at || '',
          model: c.model || '', kind: 'official', _conv: c, project_uuid: '', project: { name: '' },
        });
      }
    } else if (base === 'projects.json' || isProjects(json)) {
      res.projects = json;
    } else if (/memor/.test(base)) {
      res.memories = { name: e.name.split('/').pop(), text: JSON.stringify(json, null, 2) };
    }
  }
  return res;
}

// projects.json -> projects/<name>/INSTRUCTIONS.md, DESCRIPTION.md, knowledge/<doc>
export function officialProjectFiles(projects, root = 'official-export/') {
  const files = [];
  const used = new Set();
  for (const p of Array.isArray(projects) ? projects : []) {
    const dir = `${root}projects/${uniqueName(used, safeName(p.name || p.uuid || 'project', 60, 90))}`;
    if (typeof p.prompt_template === 'string' && p.prompt_template.trim()) files.push({ path: `${dir}/INSTRUCTIONS.md`, data: p.prompt_template });
    if (typeof p.description === 'string' && p.description.trim()) files.push({ path: `${dir}/DESCRIPTION.md`, data: p.description });
    const usedDocs = new Set();
    for (const d of Array.isArray(p.docs) ? p.docs : []) {
      const name = uniqueFile(usedDocs, safeName(d.filename || d.file_name || d.name || d.uuid || 'document', 80, 100));
      if (typeof d.content === 'string') files.push({ path: `${dir}/knowledge/${name}`, data: d.content });
    }
  }
  return files;
}
