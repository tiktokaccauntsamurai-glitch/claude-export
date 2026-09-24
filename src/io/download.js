const pending = new Map();
browser.downloads.onChanged.addListener(d => {
  if (d.state && d.state.current !== 'in_progress' && pending.has(d.id)) {
    URL.revokeObjectURL(pending.get(d.id));
    pending.delete(d.id);
  }
});

const cleanSeg = (p) => p.replace(/[<>:"\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || '_';

// relPath is relative to the Firefox downloads folder.
export async function saveBlob(blob, relPath, { saveAs = false } = {}) {
  const url = URL.createObjectURL(blob);
  const filename = relPath.split('/').map(cleanSeg).join('/');
  try {
    const id = await browser.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' });
    pending.set(id, url);
    return id;
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}
