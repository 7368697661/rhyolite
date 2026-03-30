export interface EntitySuggestion {
  entityId: string;
  entityType: "document" | "wiki";
  entityTitle: string;
  matchText: string;
  startIndex: number;
  endIndex: number;
}

export function extractEntityMentions(
  content: string,
  documents: Array<{ id: string; title: string }>,
  wikiEntries: Array<{ id: string; title: string; aliases: string }>,
  selfId?: string
): EntitySuggestion[] {
  const candidates: Array<{
    entityId: string;
    entityType: "document" | "wiki";
    entityTitle: string;
    searchTerm: string;
  }> = [];

  for (const doc of documents) {
    if (selfId && doc.id === selfId) continue;
    if (doc.title.length >= 3) {
      candidates.push({
        entityId: doc.id,
        entityType: "document",
        entityTitle: doc.title,
        searchTerm: doc.title,
      });
    }
  }

  for (const wiki of wikiEntries) {
    if (selfId && wiki.id === selfId) continue;
    if (wiki.title.length >= 3) {
      candidates.push({
        entityId: wiki.id,
        entityType: "wiki",
        entityTitle: wiki.title,
        searchTerm: wiki.title,
      });
    }
    const aliases = wiki.aliases
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length >= 3);
    for (const alias of aliases) {
      candidates.push({
        entityId: wiki.id,
        entityType: "wiki",
        entityTitle: wiki.title,
        searchTerm: alias,
      });
    }
  }

  // Sort longest search terms first so longer matches take priority
  candidates.sort((a, b) => b.searchTerm.length - a.searchTerm.length);

  // Pre-compute bracket regions to skip already-linked text
  const bracketRanges: Array<[number, number]> = [];
  const bracketRe = /\[[^\]]*\]/g;
  let bm: RegExpExecArray | null;
  while ((bm = bracketRe.exec(content)) !== null) {
    bracketRanges.push([bm.index, bm.index + bm[0].length]);
  }

  const isInsideBrackets = (start: number, end: number): boolean =>
    bracketRanges.some(([bStart, bEnd]) => start >= bStart && end <= bEnd);

  const seenEntityIds = new Set<string>();
  const suggestions: EntitySuggestion[] = [];
  const contentLower = content.toLowerCase();

  for (const candidate of candidates) {
    if (seenEntityIds.has(candidate.entityId)) continue;

    const termLower = candidate.searchTerm.toLowerCase();
    const escaped = termLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    let match: RegExpExecArray | null;

    while ((match = re.exec(contentLower)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (isInsideBrackets(start, end)) continue;

      seenEntityIds.add(candidate.entityId);
      suggestions.push({
        entityId: candidate.entityId,
        entityType: candidate.entityType,
        entityTitle: candidate.entityTitle,
        matchText: content.substring(start, end),
        startIndex: start,
        endIndex: end,
      });
      break;
    }
  }

  suggestions.sort((a, b) => a.startIndex - b.startIndex);
  return suggestions;
}
