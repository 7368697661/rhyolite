type Msg = { id: string; parentMessageId: string | null };

export function childrenByParentId(messages: Msg[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const x of messages) {
    if (!x.parentMessageId) continue;
    const arr = m.get(x.parentMessageId) ?? [];
    arr.push(x.id);
    m.set(x.parentMessageId, arr);
  }
  return m;
}

/** All message ids in the subtree rooted at `rootId` (including root). */
export function collectSubtreeIds(rootId: string, messages: Msg[]): string[] {
  const kids = childrenByParentId(messages);
  const out = new Set<string>();
  const q = [rootId];
  while (q.length) {
    const id = q.shift()!;
    out.add(id);
    for (const c of kids.get(id) ?? []) q.push(c);
  }
  return [...out];
}

