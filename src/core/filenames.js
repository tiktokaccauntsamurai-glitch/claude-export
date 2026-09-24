// Windows Explorer refuses a whole ZIP if one entry exceeds ~260 UTF-8 bytes, and long extracted paths fail too.
// Export modules budget their own names; the save layer fits every path to these limits as a last resort.
export const PATH_MAX_BYTES = 200;
export const PATH_MAX_CHARS = 170;

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const utf8len = (c) => { const cp = c.codePointAt(0); return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; };
export const utf8Bytes = (s) => Array.from(String(s)).reduce((n, c) => n + utf8len(c), 0);

// Cut to at most maxChars code points AND maxBytes UTF-8 bytes (never splits a character).
export function clip(s, maxChars, maxBytes = Infinity) {
  let out = '';
  let bytes = 0;
  let n = 0;
  for (const c of String(s)) {
    const b = utf8len(c);
    if (n + 1 > maxChars || bytes + b > maxBytes) break;
    out += c; bytes += b; n++;
  }
  return out;
}

// Windows-safe single path segment. Windows Explorer refuses a whole ZIP if one entry name exceeds ~260 UTF-8 bytes
// (Cyrillic = 2 bytes/char), so callers pass a byte budget as well as a char budget.
export function safeName(s, max = 100, maxBytes = Infinity) {
  let r = String(s ?? 'untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (!r) r = 'untitled';
  r = clip(r, max, maxBytes).replace(/[. ]+$/, '');
  if (!r) r = 'untitled';
  if (RESERVED.test(r)) r = '_' + r;
  return r;
}

// "2026-09-20 Title" folder/file base shared by chats, artifacts and attachments of one chat.
export const chatBase = (createdAt, title, maxChars = 68, maxBytes = 99) =>
  `${String(createdAt || '').slice(0, 10) || 'undated'} ${safeName(title, maxChars, maxBytes)}`;

// Last-resort guard: shrink the longest segments until the whole path fits; keeps the extension.
export function fitPath(p, maxBytes = 200, maxChars = 170) {
  const fits = (s) => utf8Bytes(s) <= maxBytes && Array.from(s).length <= maxChars;
  if (fits(p)) return p;
  const segs = p.split('/');
  const last = segs.pop();
  const dot = last.lastIndexOf('.');
  const ext = dot > 0 ? last.slice(dot) : '';
  const parts = [...segs, dot > 0 ? last.slice(0, dot) : last].map(x => Array.from(x));
  const join = () => [...parts.slice(0, -1).map(x => x.join('')), parts[parts.length - 1].join('') + ext].join('/');
  for (let guard = 0; !fits(join()) && guard < 5000; guard++) {
    let k = 0;
    parts.forEach((x, i) => { if (x.length > parts[k].length || (x.length === parts[k].length && i > k)) k = i; });
    if (parts[k].length <= 1) break;
    parts[k].pop();
  }
  return join().split('/').map(x => x.replace(/[. ]+$/, '') || '_').join('/');
}

// Fit every path and keep them unique (case-insensitive) after shrinking.
export function fitAll(files, maxBytes, maxChars) {
  const used = new Set();
  return files.map((f) => {
    let p = fitPath(f.path, maxBytes, maxChars);
    if (used.has(p.toLowerCase())) {
      const dot = p.lastIndexOf('.');
      const stem = dot > p.lastIndexOf('/') ? p.slice(0, dot) : p;
      const ext = dot > p.lastIndexOf('/') ? p.slice(dot) : '';
      for (let i = 2; used.has(p.toLowerCase()); i++) p = fitPath(`${stem}-${i}${ext}`, maxBytes, maxChars);
    }
    used.add(p.toLowerCase());
    return p === f.path ? f : { ...f, path: p };
  });
}

// `used` is a Set of lowercase names; returns a stem not yet used with this ext.
export function uniqueName(used, stem, ext = '') {
  let n = stem;
  let i = 2;
  while (used.has((n + ext).toLowerCase())) n = `${stem}-${i++}`;
  used.add((n + ext).toLowerCase());
  return n;
}

// Unique file name (keeps extension): "a.png", "a-2.png", ...
export function uniqueFile(used, filename) {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  return uniqueName(used, stem, ext) + ext;
}

const MIME_EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'application/pdf': 'pdf' };
// Downloaded previews may be re-encoded (e.g. a .png shown as webp): make the extension match the real type.
export function fixExt(name, mime) {
  const want = MIME_EXT[String(mime || '').toLowerCase()];
  if (!want) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (ext === want || (want === 'jpg' && ext === 'jpeg')) return name;
  if (want === 'pdf') return dot > 0 ? name : name + '.pdf';
  return (dot > 0 && /^(png|jpe?g|gif|webp|bmp)$/.test(ext) ? name.slice(0, dot) : name) + '.' + want;
}
