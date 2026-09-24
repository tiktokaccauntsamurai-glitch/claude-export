// Regression tests for bugs that actually happened while building this extension.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir, out = []) {
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, n);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith('.js')) out.push(rel);
  }
  return out;
}

// ---- Bug: i18n.js had a raw newline inside a string literal -> whole popup/export page died silently.
test('every extension JS file parses (node --check)', () => {
  const files = ['src', 'popup', 'export', 'content'].flatMap(d => walk(d)).concat('background.js');
  assert.ok(files.length > 15);
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' }); }
    catch (e) { assert.fail(`${f} has a syntax error:\n${e.stderr}`); }
  }
});

// ---- Bug: `node --test tests/` fails on Node 24 -> npm test crashed.
test('npm test script uses a quoted glob', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.test, /--test .*"tests\/\*\*\/\*\.test\.mjs"/);
  assert.match(pkg.scripts.test, /--test-timeout=\d+/); // a hung UI test must fail, not block the run forever
});

// ---- Bug: stale old extension version was loaded; keep versions in sync and files present.
test('manifest is consistent with package.json and files exist', () => {
  const m = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(m.version, pkg.version);
  assert.equal(m.manifest_version, 3);
  assert.ok(m.host_permissions.includes('https://claude.ai/*'));
  assert.ok(m.browser_specific_settings.gecko.id);
  const refs = [...m.background.scripts, m.action.default_popup, ...Object.values(m.icons), m.action.default_icon['48'],
    ...m.content_scripts.flatMap(c => c.js)];
  for (const r of refs) assert.ok(existsSync(join(ROOT, r)), `missing file referenced by manifest: ${r}`);
  for (const lib of ['jszip.min.js', 'pdfmake.min.js', 'vfs_fonts.js', 'marked.esm.js']) assert.ok(existsSync(join(ROOT, 'vendor', lib)), lib);
});

// ---- Bug class: JS calls $('id') for an element that is not in the HTML -> "null.onclick" crash, page dead.
test('every element id used by popup.js / export.js exists in its HTML', () => {
  for (const [js, html] of [['popup/popup.js', 'popup/popup.html'], ['export/export.js', 'export/export.html']]) {
    const src = read(js);
    const ids = new Set(read(html).match(/\bid="([^"]+)"/g).map(s => s.slice(4, -1)));
    const used = new Set();
    for (const m of src.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)) used.add(m[1]);
    for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) used.add(m[1]);
    for (const m of src.matchAll(/for \(const id of \[([^\]]+)\]/g)) for (const q of m[1].matchAll(/'([^']+)'/g)) used.add(q[1]);
    const opt = /const OPT_IDS = \{([\s\S]*?)\};/.exec(src);
    if (opt) for (const q of opt[1].matchAll(/'(o[A-Za-z]+)'/g)) used.add(q[1]);
    for (const id of used) assert.ok(ids.has(id), `${js}: #${id} is not in ${html}`);
    assert.ok(used.size > 5);
  }
});

// ---- Bug: exportBtn had data-i18n AND its text set from code -> language switch reset the label.
test('elements whose text is set from code have no data-i18n', () => {
  const html = read('export/export.html');
  assert.doesNotMatch(html, /id="exportBtn"[^>]*data-i18n/);
});

// ---- Bug: content script must be a classic script (no ES modules) and talk only to claude.ai.
test('content script is classic and handles only its own channel', () => {
  const src = read('content/api-client.js');
  assert.doesNotMatch(src, /^\s*(import|export)\s/m);
  assert.match(src, /msg\?\.channel !== 'claude-api'/);
});

// ---- Bug: PDF must be generated with Cyrillic text (Roboto bundled) -- run the real vendor libs.
test('pdfmake really produces a PDF for Cyrillic markdown', async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;
  const run = (f) => vm.runInThisContext(readFileSync(join(ROOT, f), 'utf8'));
  run('vendor/pdfmake.min.js');
  run('vendor/vfs_fonts.js');
  const { mdToPdfDoc } = await import('../src/core/render-pdf.js');
  const md = '# Заголовок\n\nПривет, мир! **жирный** `код` 😀\n\n1. один\n2. два\n\n> цитата\n\n| a | б |\n|---|---|\n| 1 | 2 |\n\n```py\nprint("x")\n```\n';
  const buf = await new Promise((res) => globalThis.pdfMake.createPdf(mdToPdfDoc(md, 'Тест')).getBuffer(res));
  assert.equal(Buffer.from(buf).subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 5000);
});

// ---- Bug (found by diagnostics on the real account): blob download failed with
// "Permission denied to access property constructor" because content.fetch responses are Xray wrappers.
test('content script downloads binaries with its own fetch, not content.fetch / Uint8Array copies', () => {
  const src = read('content/api-client.js');
  const body = /async function getBlob[\s\S]*?\n  }\n/.exec(src)[0];
  assert.match(body, /await fetch\(/);
  assert.doesNotMatch(body, /content\.fetch|\bf\(|new Uint8Array/);
});

// ---- Docs must not rot: every npm script and file the README/INSTALL/E2E docs mention has to exist.
test('docs reference existing scripts and files', () => {
  const pkg = JSON.parse(read('package.json'));
  const docs = ['README.md', 'docs/INSTALL.md', 'docs/E2E-CLAUDE-DESKTOP.md'].map(read).join('\n');
  for (const m of docs.matchAll(/npm run ([a-z:]+)/g)) assert.ok(pkg.scripts[m[1]], `docs mention "npm run ${m[1]}" but package.json has no such script`);
  for (const f of ['docs/api-notes.md', 'docs/INSTALL.md', 'docs/E2E-CLAUDE-DESKTOP.md', 'CHANGELOG.md', 'tests/e2e/verify-export.mjs', 'tests/helpers/shellzip.ps1']) {
    assert.ok(existsSync(join(ROOT, f)), `missing ${f}`);
  }
  for (const m of read('README.md').matchAll(/\]\((docs\/[^)]+)\)/g)) assert.ok(existsSync(join(ROOT, m[1])), `README links to missing ${m[1]}`);
  assert.ok(read('CHANGELOG.md').includes('## ' + pkg.version + '\n'), 'CHANGELOG.md has no entry for the current version');
});

test('build/sign scripts exclude dev files from the extension package', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const s of ['build', 'sign', 'lint']) {
    for (const x of ['tests', 'node_modules', 'docs', 'README.md', 'package.json']) {
      assert.ok(pkg.scripts[s].split(/\s+/).includes(x), `${s} must ignore ${x}`);
    }
  }
  assert.match(pkg.scripts.sign, /--channel=unlisted/);
});
