// Lazy-load bundled vendor scripts (classic scripts that set globals). Keeps the popup fast.
const loaded = new Map();
function loadScript(path) {
  if (!loaded.has(path)) {
    loaded.set(path, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = browser.runtime.getURL(path);
      s.onload = () => res();
      s.onerror = () => { loaded.delete(path); rej(new Error('Failed to load ' + path)); };
      document.head.append(s);
    }));
  }
  return loaded.get(path);
}

export async function ensurePdf() {
  if (globalThis.pdfMake?.vfs) return;
  await loadScript('vendor/pdfmake.min.js');
  await loadScript('vendor/vfs_fonts.js');
}
export const ensureZip = () => (globalThis.JSZip ? Promise.resolve() : loadScript('vendor/jszip.min.js'));
