import { EP } from './endpoints.js';
import { safeName, uniqueName, uniqueFile, fixExt } from './filenames.js';
import { mapPool } from './export-run.js';

// API answers may be a bare array or wrapped; be tolerant.
const arr = (p) => (Array.isArray(p) ? p : (p?.data || p?.projects || p?.docs || p?.files || []));
const idOf = (p) => p.uuid || p.id;

export async function listProjects(api, org) {
  return arr(await api('get', { path: EP.projects(org) }))
    .filter(p => idOf(p))
    .map(p => ({ ...p, uuid: idOf(p), name: p.name || p.title || 'Untitled project' }));
}

// -> { files, errors, aborted, stats: {projects, knowledge} }
// Layout: projects/<name>/INSTRUCTIONS.md, DESCRIPTION.md, knowledge/<text file>, files/<pdf/image>, _project.json (raw API detail)
export async function exportProjects({ projects, org, api, withFiles = true, onProgress, signal, delay = 300 }) {
  const files = [];
  const errors = [];
  const used = new Set();
  const stats = { projects: 0, knowledge: 0, files: 0 };
  let done = 0;

  await mapPool(projects, 2, async (p) => {
    const folder = uniqueName(used, safeName(p.name, 60, 90));
    const dir = `projects/${folder}`;
    let detail = p;
    try {
      detail = { ...p, ...(await api('get', { path: EP.project(org, p.uuid) })) };
    } catch (e) {
      errors.push(`project "${p.name}" details: ${e.message}`);
    }
    const prompt = detail.prompt_template ?? detail.instructions ?? '';
    if (typeof prompt === 'string' && prompt.trim()) files.push({ path: `${dir}/INSTRUCTIONS.md`, data: prompt });
    if (typeof detail.description === 'string' && detail.description.trim()) files.push({ path: `${dir}/DESCRIPTION.md`, data: detail.description });

    try {
      const docs = arr(await api('get', { path: EP.projectDocs(org, p.uuid) }));
      const usedDocs = new Set();
      for (const d of docs) {
        const name = uniqueFile(usedDocs, safeName(d.file_name || d.filename || d.name || d.uuid || 'document', 80, 100));
        if (typeof d.content === 'string') {
          files.push({ path: `${dir}/knowledge/${name}`, data: d.content });
          stats.knowledge++;
        } else {
          errors.push(`project "${p.name}" knowledge "${name}": no text content in API response (keys: ${Object.keys(d).join(', ')})`);
        }
      }
    } catch (e) {
      errors.push(`project "${p.name}" knowledge: ${e.message}`);
    }

    if (withFiles) {
      try {
        const pf = arr(await api('get', { path: EP.projectFiles(org, p.uuid) }));
        const usedPf = new Set();
        for (const f of pf) {
          const url = f.document_asset?.url || f.preview_asset?.url || f.thumbnail_asset?.url;
          const label = f.file_name || f.uuid || 'file';
          if (!url) { errors.push(`project "${p.name}" file "${label}": no download url`); continue; }
          try {
            const r = await api('blob', { url });
            const name = uniqueFile(usedPf, fixExt(safeName(label, 80, 100), r.type));
            files.push({ path: `${dir}/files/${name}`, data: new Blob([r.data], { type: r.type }) });
            stats.files++;
          } catch (e) {
            errors.push(`project "${p.name}" file "${label}": ${e.message}`);
          }
        }
      } catch (e) {
        errors.push(`project "${p.name}" files: ${e.message}`);
      }
    }

    files.push({ path: `${dir}/_project.json`, data: JSON.stringify(detail, null, 2) });
    stats.projects++;
    onProgress?.({ done: ++done, total: projects.length, errors: errors.length });
  }, { signal, delay });

  if (errors.length) files.push({ path: 'errors.log', data: errors.join('\n') + '\n' });
  return { files, errors, aborted: !!signal?.aborted, stats };
}
