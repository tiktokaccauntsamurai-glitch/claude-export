import { EP } from './endpoints.js';
import { safeName, uniqueName } from './filenames.js';
import { esc, linkTarget } from './md.js';

const yaml = (v) => JSON.stringify(v ?? '');

// What claude.ai actually exposes today (see diagnostics): the skills LIST with descriptions, and the memory text/settings.
// Skill file contents and "melange"-mode memory content have no known endpoint yet.
// opts: skills, memory  -> { files, errors, notes:[{key,params}], aborted:false, stats:{skills, memoryChars} }
export async function exportMemoryAndSkills({ org, api, opts = { skills: true, memory: true } }) {
  const files = [];
  const errors = [];
  const notes = [];
  const stats = { skills: 0, memoryChars: 0 };

  if (opts.skills) {
    try {
      const r = await api('get', { path: EP.skills(org) });
      const skills = Array.isArray(r) ? r : (r?.skills || []);
      const used = new Set();
      const rows = [];
      for (const s of skills) {
        const name = s.name || s.id || 'skill';
        const dir = uniqueName(used, safeName(name, 60, 90));
        stats.skills++;
        files.push({
          path: `skills/${dir}/DESCRIPTION.md`,
          data: `---\nname: ${yaml(name)}\nsource: ${yaml(s.source)}\ncreator_type: ${yaml(s.creator_type)}\nenabled: ${!!s.enabled}\nupdated: ${yaml(s.updated_at)}\n---\n\n${s.description || ''}\n`,
        });
        const desc = esc(s.description).slice(0, 200);
        rows.push(`| ${esc(name)} | ${esc(s.source)} | ${esc(s.creator_type)} | ${s.enabled ? 'yes' : 'no'} | ${desc} | [DESCRIPTION.md](${linkTarget(dir)}/DESCRIPTION.md) |`);
      }
      files.push({ path: 'skills/skills.json', data: JSON.stringify(skills, null, 2) });
      files.push({
        path: 'skills/index.md',
        data: `# Skills (${skills.length})\n\nOnly descriptions are available from claude.ai; skill files are not exposed by a known endpoint.\n\n| Name | Source | Creator | Enabled | Description | File |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`,
      });
    } catch (e) {
      errors.push(`skills: ${e.message}`);
    }
  }

  if (opts.memory) {
    let mem = null;
    let settings = null;
    try { mem = await api('get', { path: EP.memory(org) }); } catch (e) { errors.push(`memory: ${e.message}`); }
    try { settings = await api('get', { path: EP.memorySettings(org) }); } catch (e) { errors.push(`memory settings: ${e.message}`); }
    if (mem || settings) {
      const text = typeof mem?.memory === 'string' ? mem.memory : '';
      stats.memoryChars = text.length;
      if (text.trim()) files.push({ path: 'memory/claude-ai-memory.md', data: text });
      else notes.push({ key: 'note_memory_empty', params: { mode: settings?.memory_mode || '?' } });
      files.push({ path: 'memory/memory-raw.json', data: JSON.stringify({ memory: mem, settings }, null, 2) });
    }
  }

  if (errors.length) files.push({ path: 'errors.log', data: errors.join('\n') + '\n' });
  return { files, errors, notes, aborted: false, stats };
}
