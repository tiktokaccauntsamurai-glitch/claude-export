import { ensureZip } from './libs.js';

export async function buildZip(files, onProgress) {
  await ensureZip();
  const zip = new globalThis.JSZip();
  for (const f of files) zip.file(f.path, f.data);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, m => onProgress?.(m.percent));
}
