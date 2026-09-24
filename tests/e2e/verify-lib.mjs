// Automatic verification of what the extension WROTE to disk (ZIPs, loose files, diagnostics reports).
// Used by the E2E checklist for Claude Desktop (Dispatch) and by unit tests. Pure logic + small IO helpers.
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const MAX_ENTRY_BYTES = 240; // Windows Explorer rejects a ZIP over ~260 UTF-8 bytes per entry name
const KNOWN_TOP = new Set(['chats', 'artifacts', 'attachments', 'projects', 'skills', 'memory', 'user-artifacts', 'claude-code', 'official-export', 'index.md', 'errors.log']);
const TEXT_EXT = /\.(md|txt|json|log|py|js|ts|html|css|jsx|tsx|csv|yml|yaml|xml|sh|svg|mmd)$/i;
const SECRETS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/"(access|refresh)Token"\s*:\s*"[^"]{10,}/, 'OAuth token JSON'],
  [/Bearer\s+[A-Za-z0-9._-]{30,}/, 'Bearer token'],
  [/sessionKey=[A-Za-z0-9%._-]{20,}/, 'session cookie'],
];

let JSZipLib;
export function getJSZip() {
  if (!JSZipLib) {
    globalThis.window ??= globalThis;
    globalThis.self ??= globalThis;
    vm.runInThisContext(readFileSync(join(ROOT, 'vendor/jszip.min.js'), 'utf8'));
    JSZipLib = globalThis.JSZip;
  }
  return JSZipLib;
}

const utf8 = (s) => Buffer.byteLength(s, 'utf8');
const add = (checks, name, status, detail = '') => checks.push({ name, status, detail });

// entries: [{ path, size, read: async () => Buffer }]
export async function checkEntries(entries, { label = 'archive' } = {}) {
  const checks = [];
  const paths = entries.map(e => e.path);
  add(checks, `${label}: has files`, entries.length ? 'PASS' : 'FAIL', `${entries.length} files`);

  const long = paths.filter(p => utf8(p) > MAX_ENTRY_BYTES);
  add(checks, `${label}: path length <= ${MAX_ENTRY_BYTES} bytes`, long.length ? 'FAIL' : 'PASS', long.slice(0, 3).map(p => `${utf8(p)}B ${p}`).join(' | '));

  const bad = paths.filter(p => p.split('/').some(s => /[<>:"|?*\x00-\x1f]/.test(s) || (s && (s !== s.trimEnd() || s.endsWith('.')))));
  add(checks, `${label}: Windows-safe names`, bad.length ? 'FAIL' : 'PASS', bad.slice(0, 3).join(' | '));

  const lower = new Map();
  for (const p of paths) lower.set(p.toLowerCase(), (lower.get(p.toLowerCase()) || 0) + 1);
  const dups = [...lower].filter(([, n]) => n > 1).map(([p]) => p);
  add(checks, `${label}: no duplicate names`, dups.length ? 'FAIL' : 'PASS', dups.slice(0, 3).join(' | '));

  const sensitive = paths.filter(p => /(^|\/)(\.credentials\.json|settings(\.local)?\.json|history\.jsonl|\.env)$/i.test(p));
  add(checks, `${label}: no credential/settings files`, sensitive.length ? 'FAIL' : 'PASS', sensitive.join(' | '));

  const tops = new Set(paths.map(p => p.split('/')[0]));
  const unknown = [...tops].filter(t => !KNOWN_TOP.has(t));
  add(checks, `${label}: expected top-level layout`, unknown.length ? 'WARN' : 'PASS', unknown.length ? `unknown: ${unknown.join(', ')}` : [...tops].sort().join(', '));

  const empty = entries.filter(e => e.size === 0 && !/errors\.log$/.test(e.path));
  add(checks, `${label}: no empty files`, empty.length ? 'WARN' : 'PASS', empty.slice(0, 5).map(e => e.path).join(' | '));

  const set = new Set(paths);
  const contents = new Map();
  for (const e of entries) if (TEXT_EXT.test(e.path) && e.size < 20e6) contents.set(e.path, (await e.read()).toString('utf8'));

  // PDFs
  const pdfs = entries.filter(e => /\.pdf$/i.test(e.path) && /(^|\/)chats\//.test(e.path));
  const badPdf = [];
  for (const e of pdfs) { const b = await e.read(); if (b.subarray(0, 5).toString() !== '%PDF-' || b.length < 800) badPdf.push(`${e.path} (${b.length}B)`); }
  add(checks, `${label}: PDFs are real PDFs`, badPdf.length ? 'FAIL' : 'PASS', pdfs.length ? (badPdf.join(' | ') || `${pdfs.length} pdf`) : 'no pdf');

  // chat markdown: front matter + turns + links to artifact files
  const chatMds = [...contents].filter(([p]) => /(^|\/)chats\/[^/]+\.md$/.test(p));
  const mdProblems = [];
  const brokenLinks = [];
  for (const [p, text] of chatMds) {
    if (!/^# (Human|Claude)/m.test(text)) mdProblems.push(`${p}: no turns`);
    if (text.startsWith('---\n') && !/^---\n(?:[\s\S]*?\n)?title: .+\n[\s\S]*?\n---\n/.test(text)) mdProblems.push(`${p}: bad front matter`);
    for (const m of text.matchAll(/→ `((?:\.\.\/)[^`]+)`/g)) {
      const target = posix.normalize(posix.join(posix.dirname(p), m[1]));
      if (!set.has(target)) brokenLinks.push(`${p} -> ${m[1]}`);
    }
  }
  add(checks, `${label}: chat markdown well-formed`, mdProblems.length ? 'FAIL' : 'PASS', mdProblems.slice(0, 3).join(' | ') || `${chatMds.length} chats`);
  add(checks, `${label}: artifact links in chats resolve`, brokenLinks.length ? 'FAIL' : 'PASS', brokenLinks.slice(0, 3).join(' | '));

  // index files: every table link must exist
  const idxProblems = [];
  for (const [p, text] of contents) {
    if (!/(^|\/)index\.md$/.test(p)) continue;
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      let target;
      try { target = decodeURIComponent(m[1]); } catch { idxProblems.push(`${p}: bad link ${m[1]}`); continue; }
      const full = posix.normalize(posix.join(posix.dirname(p), target));
      if (!set.has(full)) idxProblems.push(`${p} -> ${target}`);
    }
  }
  add(checks, `${label}: index.md links resolve`, idxProblems.length ? 'FAIL' : 'PASS', idxProblems.slice(0, 3).join(' | '));

  // secrets in content (WARN: chats may legitimately discuss tokens)
  const leaks = [];
  for (const [p, text] of contents) for (const [re, what] of SECRETS) if (re.test(text)) leaks.push(`${p}: ${what}`);
  add(checks, `${label}: no secret-looking strings`, leaks.length ? 'WARN' : 'PASS', leaks.slice(0, 3).join(' | '));

  // errors.log
  const errs = contents.get('errors.log');
  if (errs !== undefined) add(checks, `${label}: errors.log`, 'WARN', `${errs.split('\n').filter(Boolean).length} error lines: ${errs.split('\n').filter(Boolean).slice(0, 3).join(' | ')}`);
  else add(checks, `${label}: errors.log`, 'PASS', 'none');
  return checks;
}

export async function zipEntries(zipPath) {
  const zip = await new (getJSZip())().loadAsync(readFileSync(zipPath));
  return Object.values(zip.files).filter(f => !f.dir).map(f => ({ path: f.name, size: f._data?.uncompressedSize ?? 0, read: async () => Buffer.from(await f.async('uint8array')) }))
    .map(e => e); // size is refined below
}

// JSZip does not expose sizes reliably across versions; compute them by reading.
async function withSizes(entries) {
  for (const e of entries) { const b = await e.read(); e.size = b.length; const buf = b; e.read = async () => buf; }
  return entries;
}

export function windowsShellOpens(zipPath) {
  if (process.platform !== 'win32') return { status: 'SKIP', detail: 'not Windows' };
  const out = execFileSync('powershell', ['-NoProfile', '-File', resolve(ROOT, 'tests/helpers/shellzip.ps1'), '-Paths', resolve(zipPath)], { encoding: 'utf8' }).trim();
  const ok = /opens, [1-9]\d* top-level items/.test(out);
  return { status: ok ? 'PASS' : 'FAIL', detail: out.replace(/^.*-> /, '') };
}

export async function verifyZip(zipPath) {
  const checks = [];
  let entries;
  try { entries = await withSizes(await zipEntries(zipPath)); }
  catch (e) { return [{ name: `${zipPath}: readable ZIP`, status: 'FAIL', detail: e.message }]; }
  add(checks, 'zip: readable', 'PASS', `${statSync(zipPath).size} bytes`);
  const sh = windowsShellOpens(zipPath);
  add(checks, 'zip: opens in Windows Explorer', sh.status, sh.detail);
  checks.push(...await checkEntries(entries, { label: 'zip' }));
  return checks;
}

export function treeEntries(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, r);
      else out.push({ path: r, size: statSync(full).size, read: async () => readFileSync(full) });
    }
  };
  walk(dir, '');
  return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export function verifyDiagnostics(reportOrJson) {
  const checks = [];
  let r;
  try { r = typeof reportOrJson === 'string' ? JSON.parse(reportOrJson) : reportOrJson; }
  catch (e) { return [{ name: 'diagnostics: valid JSON', status: 'FAIL', detail: e.message }]; }
  const raw = JSON.stringify(r);
  const by = Object.fromEntries((r.steps || []).map(s => [s.name, s]));
  add(checks, 'diagnostics: has steps', (r.steps || []).length >= 5 ? 'PASS' : 'FAIL', `${(r.steps || []).length} steps`);
  const failed = (r.steps || []).filter(s => !s.ok);
  add(checks, 'diagnostics: every step ok', failed.length ? 'FAIL' : 'PASS', failed.map(s => `${s.name}: ${s.error}`).join(' | '));
  const scan = by['conversations.scan'];
  if (scan) {
    add(checks, 'diagnostics: chats parse without errors', scan.parsed?.failed || scan.parseErrors?.length ? 'FAIL' : 'PASS', `${scan.parsed?.ok}/${scan.scanned} parsed, ${scan.parsed?.artifacts} artifacts`);
    add(checks, 'diagnostics: chat fetch errors', scan.fetchErrors?.length ? 'FAIL' : 'PASS', (scan.fetchErrors || []).join(' | '));
  }
  const dl = by['files.download'];
  if (dl) {
    const bad = Object.entries(dl).filter(([, v]) => v && typeof v === 'object' && 'pattern' in v && (v.blobOk === false || !v.ok));
    add(checks, 'diagnostics: file download works', bad.length ? 'FAIL' : 'PASS', bad.map(([k, v]) => `${k}: ${v.blobError || v.status}`).join(' | '));
  }
  const ua = by.user_artifacts;
  if (ua) add(checks, 'diagnostics: artifacts page joins to chats', ua.join?.found === ua.join?.tried ? 'PASS' : 'FAIL', `${ua.join?.found}/${ua.join?.tried}`);
  const pr = by.projects;
  if (pr) {
    const missing = (pr.samples || []).filter(s => s.docs?.count && s.docs.withTextContent !== s.docs.count);
    add(checks, 'diagnostics: project knowledge has text', missing.length ? 'FAIL' : 'PASS', `${pr.count} projects`);
  }
  add(checks, 'diagnostics: report contains no ids', UUID.test(raw) ? 'FAIL' : 'PASS', (raw.match(UUID) || [''])[0]);
  add(checks, 'diagnostics: report contains no e-mail addresses', /[\w.+-]+@[\w-]+\.[\w.-]+/.test(raw.replace(/claude-exporter@local/g, '')) ? 'FAIL' : 'PASS');
  return checks;
}

export function summarizeChecks(checks) {
  const c = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  for (const k of checks) c[k.status] = (c[k.status] || 0) + 1;
  return { ...c, ok: c.FAIL === 0 };
}

export function newestFiles(dir, { since = 0, pattern = /./ } = {}) {
  const cutoff = since ? Date.now() - since * 60000 : 0;
  return readdirSync(dir).map(n => ({ n, full: join(dir, n), t: statSync(join(dir, n)).mtimeMs }))
    .filter(x => pattern.test(x.n) && x.t >= cutoff).sort((a, b) => b.t - a.t);
}

export function makeTempDir(prefix = 'cx-verify-') { return mkdtempSync(join(tmpdir(), prefix)); }
export const write = writeFileSync;
