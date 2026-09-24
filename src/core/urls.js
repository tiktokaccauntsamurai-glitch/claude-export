// Returns the conversation uuid if `url` is a claude.ai chat page, else null.
export function chatIdFromUrl(url) {
  const m = /^https:\/\/claude\.ai\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i.exec(url || '');
  return m ? m[1] : null;
}
