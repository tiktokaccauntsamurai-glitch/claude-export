#!/usr/bin/env node
// Verify what the extension wrote to disk.
//   node tests/e2e/verify-export.mjs [--dir <Downloads/ClaudeExport>] [--since <minutes>] [--json <out.json>]
// Checks every claude-export-*.zip, every diagnostics-*.json, and every loose-file export tree (folders with chats/ etc.).
// Exit code 1 when any check FAILs. WARN = look at it, SKIP = not applicable here.
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { verifyZip, verifyDiagnostics, checkEntries, treeEntries, summarizeChecks, newestFiles } from './verify-lib.mjs';
import { readFileSync } from 'node:fs';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const dir = arg('--dir', join(homedir(), 'Downloads', 'ClaudeExport'));
const since = Number(arg('--since', 0));
const jsonOut = arg('--json', null);

if (!existsSync(dir)) { console.error(`Folder not found: ${dir}`); process.exit(2); }

const report = { dir, at: new Date().toISOString(), items: [] };
const show = (title, checks) => {
  const s = summarizeChecks(checks);
  console.log(`\n=== ${title}  [${s.ok ? 'OK' : 'FAILED'}: ${s.PASS} pass, ${s.WARN} warn, ${s.FAIL} fail]`);
  for (const c of checks) console.log(`  ${c.status.padEnd(4)} ${c.name}${c.detail ? '  —  ' + c.detail : ''}`);
  report.items.push({ title, summary: s, checks });
};

for (const f of newestFiles(dir, { since, pattern: /^claude-export-.*\.zip$/i })) show(`ZIP ${f.n}`, await verifyZip(f.full));
for (const f of newestFiles(dir, { since, pattern: /^diagnostics-.*\.json$/i })) show(`Diagnostics ${f.n}`, verifyDiagnostics(readFileSync(f.full, 'utf8')));

// loose-file exports: <dir>/chats, <dir>/artifacts (quick exports) and <dir>/<stamp>/... (separate-files mode)
const looseRoots = [];
const hasLayout = (d) => ['chats', 'artifacts', 'projects', 'skills', 'memory', 'claude-code', 'official-export', 'user-artifacts'].some(x => existsSync(join(d, x)));
if (hasLayout(dir)) looseRoots.push(dir);
for (const n of readdirSync(dir)) { const full = join(dir, n); if (statSync(full).isDirectory() && hasLayout(full) && (!since || Date.now() - statSync(full).mtimeMs < since * 60000)) looseRoots.push(full); }
for (const root of looseRoots) show(`Loose files ${root}`, await checkEntries(treeEntries(root).filter(e => !/^(claude-export-.*\.zip|diagnostics-.*\.json)$/.test(e.path)), { label: 'files' }));

if (!report.items.length) { console.log('Nothing to verify (no ZIP, diagnostics or export folder found' + (since ? ` in the last ${since} min` : '') + ').'); process.exit(3); }
const all = report.items.flatMap(i => i.checks);
const total = summarizeChecks(all);
console.log(`\nTOTAL: ${total.ok ? 'OK' : 'FAILED'} — ${total.PASS} pass, ${total.WARN} warn, ${total.FAIL} fail, ${total.SKIP} skip`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
process.exit(total.ok ? 0 : 1);
