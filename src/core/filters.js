export function applyFilter(convs, { mode = 'all', from, to, dateField = 'updated_at', selected = new Set(), query = '', projectId = '' } = {}) {
  let list = convs;
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(c => (c.name || '').toLowerCase().includes(q));
  }
  if (projectId) list = list.filter(c => c.project_uuid === projectId);
  if (mode === 'period') {
    const a = from ? Date.parse(from + 'T00:00:00') : -Infinity;
    const b = to ? Date.parse(to + 'T23:59:59.999') : Infinity;
    list = list.filter(c => { const t = Date.parse(c[dateField]); return t >= a && t <= b; });
  }
  if (mode === 'selected') list = list.filter(c => selected.has(c.uuid));
  return list;
}
