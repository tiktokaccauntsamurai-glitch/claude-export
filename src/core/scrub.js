// Helpers that keep diagnostic reports free of personal data: only structure, never values.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const scrubIds = (s) => String(s).replace(UUID, '{id}');

// "https://claude.ai/api/organizations/<uuid>/x?limit=5&a=b" -> "/api/organizations/{id}/x?a&limit"
export function patternOf(url) {
  const u = new URL(url, 'https://claude.ai');
  const names = [...new Set([...u.searchParams.keys()])].sort();
  return scrubIds(u.pathname) + (names.length ? '?' + names.join('&') : '');
}

// Structure of a JSON value without its data: strings become string(len), arrays {$array:n,$item:shape}.
export function shape(v, depth = 3) {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (!v.length || depth <= 0) return { $array: v.length };
    return { $array: v.length, $item: shape(v[0], depth - 1) };
  }
  switch (typeof v) {
    case 'string': return `string(${v.length})`;
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'object': {
      const keys = Object.keys(v);
      if (depth <= 0) return `object(${keys.length} keys)`;
      return Object.fromEntries(keys.slice(0, 80).map(k => [k, shape(v[k], depth - 1)]));
    }
    default: return typeof v;
  }
}

// How many items have each key: {uuid: 12, name: 12, summary: 9}
export function keyStats(items) {
  const out = {};
  for (const it of items) {
    if (it && typeof it === 'object') for (const k of Object.keys(it)) out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export const tally = (map, key) => { if (key != null && key !== '') map[key] = (map[key] || 0) + 1; };
