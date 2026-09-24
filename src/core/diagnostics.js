import { EP } from './endpoints.js';
import { normalizeConversation } from './normalize.js';
import { renderMarkdown } from './render-md.js';
import { shape, keyStats, scrubIds, patternOf, tally } from './scrub.js';
import { selectReplayTargets } from './recorder.js';

const arr = (p) => (Array.isArray(p) ? p : (p?.data || p?.conversations || p?.projects || p?.docs || p?.files || []));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Endpoints we do not know yet; GET-only probes (status + JSON structure, never values).
export const CANDIDATES = [
  '/organizations/{org}/memory', '/organizations/{org}/memory/settings', '/organizations/{org}/memory/files',
  '/organizations/{org}/memory/entries', '/organizations/{org}/memory/melange',
  '/organizations/{org}/published_artifacts',
];
const PROJECT_DOC_ALTERNATES = ['/projects/{pid}/files', '/projects/{pid}/knowledge', '/projects/{pid}/docs?limit=100'];

// api('probe') never throws on HTTP errors; returns {info (report-safe), json}
export async function probe(api, path) {
  try {
    const r = await api('probe', { path });
    const info = { status: r.status, ok: r.ok, contentType: r.contentType, size: r.size };
    if (r.json !== undefined) info.shape = shape(r.json, 3);
    return { info, json: r.json };
  } catch (e) {
    return { info: { error: scrubIds(e.message || e) } };
  }
}

export async function runDiagnostics({ api, onStep, scan = 15, recLog = null, version = '', delay = 200 }) {
  const report = { tool: 'claude-exporter diagnostics', version, at: new Date().toISOString(), steps: [] };
  const step = async (name, fn) => {
    onStep?.(name);
    const t0 = Date.now();
    try {
      report.steps.push({ name, ok: true, ...(await fn()), ms: Date.now() - t0 });
    } catch (e) {
      report.steps.push({ name, ok: false, error: scrubIds(e.message || String(e)), ms: Date.now() - t0 });
    }
  };

  let org = null;
  let list = [];
  let sampleFile = null;
  let projects = [];

  await step('org', async () => { org = await api('orgId'); return {}; });
  if (!org) return finish(report);

  await step('conversations.list', async () => {
    const page = await api('get', { path: EP.conversations(org, { limit: 50, offset: 0 }) });
    list = arr(page);
    const page2 = await api('get', { path: EP.conversations(org, { limit: 50, offset: 50 }) }).catch(() => null);
    const l2 = page2 ? arr(page2) : [];
    const ids = new Set(list.map(c => c.uuid));
    return {
      wrapper: Array.isArray(page) ? 'array' : Object.keys(page),
      count: list.length, page2Count: l2.length,
      offsetHonored: l2.length ? l2.some(c => !ids.has(c.uuid)) : null,
      keys: keyStats(list),
    };
  });

  await step('conversations.scan', async () => {
    const recent = [...list].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, scan);
    const agg = {
      scanned: 0, messageKeys: {}, blockTypes: {}, toolNames: {}, artifactCommands: {}, fileKinds: {},
      files: 0, filesWithDocAssetUrl: 0, filesWithPreviewUrl: 0, attachments: 0, legacyArtifactTags: 0, leafPresent: 0,
      fileKeys: {}, attachmentKeys: {}, fileShape: null, attachmentShape: null, blockShapes: {}, toolInputShapes: {},
      parsed: { ok: 0, failed: 0, artifacts: 0, versionsMax: 0, messages: 0, markdownChars: 0 }, parseErrors: [], fetchErrors: [],
    };
    for (const c of recent) {
      let detail;
      try {
        detail = await api('get', { path: EP.conversation(org, c.uuid) });
      } catch (e) { agg.fetchErrors.push(scrubIds(e.message)); continue; }
      agg.scanned++;
      if (agg.scanned === 1) agg.detailShape = shape({ ...detail, chat_messages: (detail.chat_messages || []).slice(0, 1) }, 4);
      if (detail.current_leaf_message_uuid) agg.leafPresent++;
      const msgs = detail.chat_messages || [];
      Object.entries(keyStats(msgs)).forEach(([k, n]) => { agg.messageKeys[k] = (agg.messageKeys[k] || 0) + n; });
      for (const m of msgs) {
        for (const a of (m.attachments || []).filter(Boolean)) {
          agg.attachments++;
          Object.keys(a).forEach(k => tally(agg.attachmentKeys, k));
          agg.attachmentShape ??= shape(a, 3);
        }
        for (const f of (m.files || []).filter(Boolean)) {
          agg.files++;
          Object.keys(f).forEach(k => tally(agg.fileKeys, k));
          agg.fileShape ??= shape(f, 3);
          tally(agg.fileKinds, f.file_kind);
          if (f.document_asset?.url) agg.filesWithDocAssetUrl++;
          if (f.preview_url) agg.filesWithPreviewUrl++;
          if (!sampleFile && (f.document_asset?.url || f.preview_url)) sampleFile = f;
        }
        for (const b of (Array.isArray(m.content) ? m.content : []).filter(Boolean)) {
          tally(agg.blockTypes, b.type);
          if (b.type && !agg.blockShapes[b.type]) agg.blockShapes[b.type] = shape(b, 3);
          if (b.type === 'tool_use') {
            tally(agg.toolNames, b.name);
            if (b.name && !agg.toolInputShapes[b.name]) agg.toolInputShapes[b.name] = shape(b.input, 2);
            if (b.name === 'artifacts') tally(agg.artifactCommands, b.input?.command);
          }
          if (b.type === 'text' && /<antArtifact/.test(b.text || '')) agg.legacyArtifactTags++;
        }
      }
      try {
        const n = normalizeConversation(detail, c);
        const md = renderMarkdown(n, { frontmatter: true });
        agg.parsed.ok++;
        agg.parsed.artifacts += n.artifacts.length;
        agg.parsed.versionsMax = Math.max(agg.parsed.versionsMax, ...n.artifacts.map(a => a.versions), 0);
        agg.parsed.messages += n.messages.length;
        agg.parsed.markdownChars += md.length;
      } catch (e) {
        agg.parsed.failed++;
        agg.parseErrors.push(scrubIds(e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e.message));
      }
      await sleep(delay);
    }
    return agg;
  });

  if (sampleFile) {
    await step('files.download', async () => {
      const out = {};
      for (const [label, url] of [['preview_url', sampleFile.preview_url], ['document_asset.url', sampleFile.document_asset?.url]]) {
        if (!url) continue;
        const p = await probe(api, url);
        out[label] = { pattern: patternOf(url), ...p.info };
        try {
          const b = await api('blob', { url });
          out[label].blobOk = true;
          out[label].blobBytes = b.data?.byteLength ?? null;
          out[label].blobType = b.type;
        } catch (e) { out[label].blobOk = false; out[label].blobError = scrubIds(e.message); }
      }
      return out;
    });
  }

  await step('projects', async () => {
    const p = await probe(api, EP.projects(org));
    projects = p.json ? arr(p.json).filter(x => x.uuid || x.id) : [];
    const res = { list: p.info, count: projects.length, keys: keyStats(projects), samples: [] };
    for (const pr of projects.slice(0, 3)) {
      const pid = pr.uuid || pr.id;
      const s = {};
      const d = await probe(api, EP.project(org, pid));
      s.detail = d.info;
      s.detailHasPromptTemplate = typeof d.json?.prompt_template === 'string' ? d.json.prompt_template.length > 0 : null;
      s.counts = { docs_count: d.json?.docs_count ?? null, files_count: d.json?.files_count ?? null };
      if (!res.samples.length) s.filesEndpoint = (await probe(api, EP.project(org, pid) + '/files')).info;
      const docs = await probe(api, EP.projectDocs(org, pid));
      const docList = docs.json ? arr(docs.json) : [];
      s.docs = { ...docs.info, count: docList.length, keys: keyStats(docList), withTextContent: docList.filter(x => typeof x.content === 'string').length };
      if (!docs.info.ok || !s.docs.withTextContent) {
        s.alternates = {};
        for (const alt of PROJECT_DOC_ALTERNATES) {
          const a = await probe(api, EP.project(org, pid) + alt.replace('/projects/{pid}', ''));
          s.alternates[alt] = a.info;
        }
      }
      res.samples.push(s);
      await sleep(delay);
    }
    return res;
  });

  await step('skills', async () => {
    const p = await probe(api, `/organizations/${org}/skills/list-skills`);
    const skills = Array.isArray(p.json?.skills) ? p.json.skills : [];
    const res = { list: p.info, count: skills.length, keys: keyStats(skills), sources: {}, creatorTypes: {}, enabled: 0, samples: [] };
    for (const s of skills) { tally(res.sources, s.source); tally(res.creatorTypes, s.creator_type); if (s.enabled) res.enabled++; }
    // custom (non-public) skills first: those are the ones worth exporting
    const pick = [...skills.filter(s => !s.is_public_provisioned), ...skills].slice(0, 2);
    for (const s of pick) {
      const id = encodeURIComponent(s.id);
      const out = {};
      for (const tail of ['', '/download', '/files', '/versions', '/content']) {
        out[`skills/{id}${tail}`] = (await probe(api, `/organizations/${org}/skills/${id}${tail}`)).info;
      }
      // list-skills suggests RPC-style names
      for (const rpc of ['get-skill', 'download-skill', 'list-skill-files']) {
        out[`skills/${rpc}?id={id}`] = (await probe(api, `/organizations/${org}/skills/${rpc}?id=${id}`)).info;
      }
      res.samples.push({ source: s.source, creatorType: s.creator_type, probes: out });
      await sleep(delay);
    }
    return res;
  });

  await step('user_artifacts', async () => {
    const list = await probe(api, EP.userArtifacts(org, { limit: 5, offset: 0 }));
    const count = await probe(api, EP.userArtifactsCount(org));
    const items = Array.isArray(list.json?.artifacts) ? list.json.artifacts : [];
    const res = { list: list.info, count: count.info, keys: keyStats(items), join: { tried: 0, found: 0, notFound: [] }, contentProbes: [] };
    // does joining "artifact page item" -> "artifact inside its source chat" work? (this is what the exporter relies on)
    for (const a of items.slice(0, 3)) {
      res.join.tried++;
      try {
        const detail = await api('get', { path: EP.conversation(org, a.chat_conversation_uuid) });
        const n = normalizeConversation(detail, {});
        if (n.artifacts.some(x => x.id === a.artifact_identifier)) res.join.found++;
        else res.join.notFound.push({ type: a.artifact_type, kind: a.anchor_source_kind ?? null, chatArtifacts: n.artifacts.length });
      } catch (e) { res.join.notFound.push({ error: scrubIds(e.message) }); }
      await sleep(delay);
    }
    // where could the content live? (only for the first artifact)
    const a = items[0];
    if (a) {
      const U = a.uuid, V = a.latest_artifact_version_uuid;
      const tpls = [`/user_artifacts/${U}`, `/user_artifacts/${U}/versions`, `/user_artifacts/${U}/versions/${V}`,
        `/artifacts/${U}`, `/artifacts/${U}/versions`, `/artifacts/${U}/versions/${V}`];
      for (const tpl of tpls) {
        const p = await probe(api, `/organizations/${org}${tpl}`);
        res.contentProbes.push({ path: scrubIds(tpl), ...p.info });
      }
    }
    return res;
  });

  await step('candidates', async () => {
    const out = {};
    for (const tpl of CANDIDATES) {
      out[tpl] = (await probe(api, tpl.replace('{org}', org))).info;
      await sleep(delay);
    }
    return { results: out };
  });

  if (recLog && Object.keys(recLog).length) {
    await step('recorded', async () => {
      const targets = selectReplayTargets(recLog);
      const out = [];
      for (const t of targets) {
        const p = await probe(api, t.example);
        out.push({ pattern: t.pattern, seen: t.count, recordedStatuses: t.statuses, pageRequestHeaders: t.headerNames, now: p.info });
        await sleep(delay);
      }
      // every recorded endpoint (any method), so non-GET calls such as a POST download are visible too
      const allPatterns = Object.values(recLog).map(e => ({ method: e.method, pattern: e.pattern, statuses: e.statuses }));
      return { totalRecorded: Object.keys(recLog).length, replayed: out.length, allPatterns, endpoints: out };
    });
  }

  return finish(report);
}

function finish(report) {
  report.summary = summarize(report);
  return report;
}

export function summarize(report) {
  const L = [`Claude Exporter diagnostics v${report.version || '?'} — ${report.at}`];
  for (const s of report.steps) {
    const mark = s.ok ? 'OK ' : 'ERR';
    let extra = '';
    if (!s.ok) extra = s.error;
    else if (s.name === 'conversations.list') extra = `count=${s.count}, page2=${s.page2Count}, offsetHonored=${s.offsetHonored}`;
    else if (s.name === 'conversations.scan') {
      extra = `scanned=${s.scanned}, parsed ok/failed=${s.parsed.ok}/${s.parsed.failed}, artifacts=${s.parsed.artifacts}, files=${s.files}` +
        (s.fetchErrors.length ? `, fetchErrors=${s.fetchErrors.length}` : '');
    } else if (s.name === 'files.download') {
      extra = Object.entries(s).filter(([k, v]) => v && typeof v === 'object' && 'pattern' in v)
        .map(([k, v]) => `${k}: status=${v.status ?? v.error} blob=${v.blobOk}`).join('; ');
    } else if (s.name === 'projects') {
      extra = `count=${s.count}; ` + s.samples.map(x => `docs(status=${x.docs.status ?? x.docs.error}, n=${x.docs.count}, text=${x.docs.withTextContent})`).join(' ');
    } else if (s.name === 'skills') {
      extra = `count=${s.count}, enabled=${s.enabled}; ` + s.samples.map(x => Object.entries(x.probes).map(([k, v]) => `${k}=${v.status ?? v.error}`).join(' ')).join(' | ');
    } else if (s.name === 'user_artifacts') {
      extra = `list=${s.list.status ?? s.list.error}, count=${s.count.status ?? s.count.error}, join ${s.join.found}/${s.join.tried}; ` +
        s.contentProbes.map(p => `${p.path}=${p.status ?? p.error}`).join(' ');
    } else if (s.name === 'candidates') {
      extra = Object.entries(s.results).map(([k, v]) => `${k}=${v.status ?? v.error}`).join(' ');
    } else if (s.name === 'recorded') extra = `recorded=${s.totalRecorded}, replayed=${s.replayed}`;
    L.push(`[${mark}] ${s.name} ${extra}`);
  }
  return L.join('\n');
}
