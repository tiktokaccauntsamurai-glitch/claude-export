// UI test harness: runs the REAL export.js / popup.js (bundled with esbuild) against the REAL HTML inside jsdom,
// with a fake `browser` (storage, tabs, downloads, permissions) and a fake claude.ai content script.
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const bundles = new Map();

async function bundle(entry) {
  if (!bundles.has(entry)) {
    const r = await build({ entryPoints: [join(ROOT, entry)], bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' });
    bundles.set(entry, r.outputFiles[0].text);
  }
  return bundles.get(entry);
}

// JSZip for the TEST side (reading what the page downloaded)
let JSZipNode;
export function getJSZip() {
  if (!JSZipNode) {
    globalThis.window ??= globalThis;
    globalThis.self ??= globalThis;
    vm.runInThisContext(readFileSync(join(ROOT, 'vendor/jszip.min.js'), 'utf8'));
    JSZipNode = globalThis.JSZip;
  }
  return JSZipNode;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export async function waitFor(cond, { timeout = 8000, step = 20, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = cond(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`waitFor timeout: ${what}`);
    await sleep(step);
  }
}

// fx: { get(path) -> json | Error, probe?(path) -> {status,...}, blob?(url) -> {type,data} }
export function makeBrowser({ fx, tabs = [{ id: 7, url: 'https://claude.ai/recents', title: 'Claude', active: true }], permission = true, storage = {} }) {
  const store = { ...storage };
  const log = { downloads: [], blobs: new Map(), created: [], calls: [], reloaded: [] };
  const handle = async (msg) => {
    const { op, args = {} } = msg;
    log.calls.push([op, args.path || args.url]);
    if (op === 'ping') return { data: { ok: true } };
    if (op === 'orgId') return { data: fx.org || 'org-1' };
    if (op === 'get') {
      const d = await fx.get(args.path);
      return d instanceof Error ? { error: d.message } : { data: d };
    }
    if (op === 'blob') {
      const b = fx.blob ? await fx.blob(args.url) : { type: 'image/png', data: new Uint8Array([1, 2, 3]).buffer };
      return b instanceof Error ? { error: b.message } : { data: b };
    }
    if (op === 'probe') return { data: fx.probe ? await fx.probe(args.path) : { status: 404, ok: false, contentType: 'text/plain', size: 0 } };
    return { error: 'unknown op ' + op };
  };
  const browser = {
    storage: {
      local: {
        get: async (keys) => {
          if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
          if (Array.isArray(keys)) return Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]]));
          return { ...store };
        },
        set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
      },
    },
    permissions: { contains: async () => permission, request: async () => true },
    runtime: { getManifest: () => ({ version: 'test' }), getURL: (p) => 'moz-extension://x/' + p },
    tabs: {
      query: async (q) => tabs.filter(t => (!q.active || t.active) && (!q.url || t.url.startsWith('https://claude.ai/'))),
      sendMessage: async (_id, msg) => handle(msg),
      create: async (o) => { log.created.push(o); return { id: 99 }; },
      reload: async (id) => { log.reloaded.push(id); },
    },
    downloads: {
      onChanged: { addListener() {} },
      download: async (o) => { log.downloads.push(o); return log.downloads.length; },
    },
  };
  return { browser, store, log };
}

export async function loadPage({ page, fx, tabs, permission, storage, pdf = true }) {
  const isPopup = page === 'popup';
  const html = readFileSync(join(ROOT, isPopup ? 'popup/popup.html' : 'export/export.html'), 'utf8');
  const code = await bundle(isPopup ? 'popup/popup.js' : 'export/export.js');
  const dom = new JSDOM(html, { url: `moz-extension://x/${isPopup ? 'popup/popup' : 'export/export'}.html`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const { browser, store, log } = makeBrowser({ fx, tabs, permission, storage });
  w.browser = browser;
  w.setImmediate = setImmediate; w.clearImmediate = clearImmediate; // JSZip's scheduler
  w.Blob = Blob; w.File = File; w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.URL.createObjectURL = (b) => { const u = 'blob:test/' + (log.blobs.size + 1); log.blobs.set(u, b); return u; };
  w.URL.revokeObjectURL = () => {};
  // jsdom's FileReader rejects Node Blobs; JSZip needs one to read Blob entries
  w.FileReader = class { readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = new w.Uint8Array(new Uint8Array(r)).buffer; /* copy into the page realm */ this.onload?.({ target: this }); }, (e) => this.onerror?.(e)); } };
  w.close = () => {};
  // never let a page timer (e.g. the popup 20s refresh) keep the test process alive if a test fails before close()
  const si = w.setInterval.bind(w);
  w.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); return id; };
  const nodeSI = setInterval;
  w.setInterval = (fn, ms) => { const t = nodeSI(fn, ms); t.unref?.(); return t; };
  w.console.warn = () => {};
  w.eval(readFileSync(join(ROOT, 'vendor/jszip.min.js'), 'utf8')); // real JSZip in the page
  w.JSZip.support.blob = true; // feature detection fails across jsdom/Node realms; real Firefox has Blob
  if (pdf) {
    // pdfmake is heavy and needs canvas-free fonts; the PDF pipeline itself has its own Node test.
    w.pdfMake = { vfs: {}, createPdf: (doc) => ({ getBlob: (cb) => cb(new Blob(['%PDF-stub ' + JSON.stringify(doc.content).length], { type: 'application/pdf' })) }) };
  }
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  w.eval(code);
  const $ = (id) => w.document.getElementById(id);
  const click = async (id) => { $(id).click(); await sleep(0); };
  const setValue = (id, v, ev = 'change') => { $(id).value = v; $(id).dispatchEvent(new w.Event(ev, { bubbles: true })); };
  const check = (id, on) => { $(id).checked = on; $(id).dispatchEvent(new w.Event('change', { bubbles: true })); };
  const text = (id) => $(id).textContent;
  const visible = (id) => !$(id).hidden;
  const tab = async (name) => { w.document.querySelector(`#tabs button[data-tab=${name}]`).click(); await sleep(10); };
  const setFiles = (id, files) => {
    Object.defineProperty($(id), 'files', { value: files, configurable: true });
    $(id).dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  // read a downloaded blob (zip or plain) by download index
  const downloaded = (i = 0) => {
    const d = log.downloads[i];
    return { filename: d.filename, saveAs: d.saveAs, blob: log.blobs.get(d.url) };
  };
  const readZip = async (i = 0) => {
    const { blob } = downloaded(i);
    return new (getJSZip())().loadAsync(Buffer.from(await blob.arrayBuffer()));
  };
  const close = () => w.close && dom.window.close();
  return { w, dom, $, click, setValue, check, text, visible, tab, setFiles, log, store, errors, downloaded, readZip, close, browser };
}
