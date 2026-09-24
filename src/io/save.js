import { buildZip } from './zip.js';
import { saveBlob } from './download.js';
import { fitAll, utf8Bytes, PATH_MAX_BYTES, PATH_MAX_CHARS } from '../core/filenames.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const toBlob = d => (d instanceof Blob ? d : new Blob([d], { type: 'text/plain;charset=utf-8' }));

// files: [{path, data}]. Paths are relative to the Firefox Downloads folder.
// pack 'zip'  -> <folder>/claude-export-<stamp>.zip
// pack 'files'-> <folder>/[<stamp>/]<path>   (flat: no stamp subfolder)
export async function saveFiles(files, { pack, folder, askWhere = false, stamp, flat = false }, onZipProgress) {
  if (pack === 'zip') {
    const zip = await buildZip(fitAll(files, PATH_MAX_BYTES, PATH_MAX_CHARS), onZipProgress);
    const path = `${folder}/claude-export-${stamp}.zip`;
    await saveBlob(zip, path, { saveAs: askWhere });
    return path;
  }
  const dir = flat ? folder : `${folder}/${stamp}`;
  const fitted = fitAll(files, PATH_MAX_BYTES - utf8Bytes(dir) - 1, PATH_MAX_CHARS - Array.from(dir).length - 1);
  for (const f of fitted) {
    await saveBlob(toBlob(f.data), `${dir}/${f.path}`);
    if (fitted.length > 1) await sleep(150);
  }
  return dir + '/';
}

const pad = n => String(n).padStart(2, '0');
export function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
