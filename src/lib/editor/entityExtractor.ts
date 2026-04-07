export interface EntitySuggestion {
  entityId: string;
  entityType: "document" | "wiki";
  entityTitle: string;
  matchText: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Extract all entity link targets from content.
 * Supports `[[Title]]`, `[[Title|display text]]`, and `[display](<Target>)`.
 */
export function extractWikilinks(content: string): Array<{ target: string; display: string; start: number; end: number }> {
  const results: Array<{ target: string; display: string; start: number; end: number }> = [];
  // [[Title]] and [[Title|display]]
  const wikiRe = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wikiRe.exec(content)) !== null) {
    const target = m[1].trim();
    const display = m[2]?.trim() || target;
    results.push({ target, display, start: m.index, end: m.index + m[0].length });
  }
  // [display](<Target>) — angle-bracket entity links
  const angleBracketRe = /\[([^\]]+)\]\(\s*<([^>]+)>\s*\)/g;
  while ((m = angleBracketRe.exec(content)) !== null) {
    const display = m[1].trim();
    const target = m[2].trim();
    results.push({ target, display, start: m.index, end: m.index + m[0].length });
  }
  return results;
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

  candidates.sort((a, b) => b.searchTerm.length - a.searchTerm.length);

  // Build a title/alias→entity lookup for wikilink resolution
  const titleMap = new Map<string, { entityId: string; entityType: "document" | "wiki"; entityTitle: string }>();
  for (const c of candidates) {
    const key = c.searchTerm.toLowerCase();
    if (!titleMap.has(key)) titleMap.set(key, { entityId: c.entityId, entityType: c.entityType, entityTitle: c.entityTitle });
  }

  // Pre-compute bracket & wikilink regions to skip from auto-detection
  const skipRanges: Array<[number, number]> = [];
  // Single-bracket regions (markdown links etc.)
  const bracketRe = /\[[^\]]*\]/g;
  let bm: RegExpExecArray | null;
  while ((bm = bracketRe.exec(content)) !== null) {
    skipRanges.push([bm.index, bm.index + bm[0].length]);
  }
  // Double-bracket wikilink regions
  const wikilinks = extractWikilinks(content);
  for (const wl of wikilinks) {
    skipRanges.push([wl.start, wl.end]);
  }

  const isInsideSkipRegion = (start: number, end: number): boolean =>
    skipRanges.some(([rStart, rEnd]) => start >= rStart && end <= rEnd);

  const seenEntityIds = new Set<string>();
  const suggestions: EntitySuggestion[] = [];

  // Phase 1: Resolve [[wikilinks]] to known entities
  for (const wl of wikilinks) {
    const match = titleMap.get(wl.target.toLowerCase());
    if (!match || seenEntityIds.has(match.entityId)) continue;
    if (selfId && match.entityId === selfId) continue;
    seenEntityIds.add(match.entityId);
    suggestions.push({
      entityId: match.entityId,
      entityType: match.entityType,
      entityTitle: match.entityTitle,
      matchText: content.substring(wl.start, wl.end),
      startIndex: wl.start,
      endIndex: wl.end,
    });
  }

  // Phase 2: Plain-text auto-detection (skipping bracket and wikilink regions)
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

      if (isInsideSkipRegion(start, end)) continue;

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
