export function currentBranch(conv) {
  const msgs = conv.chat_messages || [];
  const byUuid = new Map(msgs.map(m => [m.uuid, m]));
  const leaf = conv.current_leaf_message_uuid;
  if (leaf && byUuid.has(leaf)) {
    const path = [];
    const seen = new Set();
    for (let cur = byUuid.get(leaf); cur && !seen.has(cur.uuid);
         cur = cur.parent_message_uuid ? byUuid.get(cur.parent_message_uuid) : null) {
      seen.add(cur.uuid);
      path.push(cur);
    }
    return path.reverse();
  }
  return [...msgs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}
