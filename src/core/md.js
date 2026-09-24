// Markdown helpers for the generated index tables.

// Text inside a table cell / link label: no pipes, brackets or line breaks.
export const esc = (s) => String(s ?? '')
  .replace(/\r?\n/g, ' ')
  .replace(/[|[\]]/g, (c) => '\\' + c);

// Link destination: percent-encode everything a Markdown link cannot contain, including "(" and ")"
// (file names like "Mixing resins (SLA).md" otherwise end the link early and break the table).
export const linkTarget = (path) => encodeURI(path).replace(/\(/g, '%28').replace(/\)/g, '%29');
