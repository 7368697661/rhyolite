import { listDocuments, listWikiEntries, listTimelines } from "@/lib/fs-db";
import type { FsDocument, FsWikiEntry, FsTimeline } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

type SearchResult = {
  id: string;
  type: "document" | "wiki" | "timeline" | "event";
  title: string;
  snippet: string;
  score: number;
};

function buildSnippet(text: string, query: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 120) + (text.length > 120 ? "..." : "");

  const halfWindow = 60;
  const start = Math.max(0, idx - halfWindow);
  const end = Math.min(text.length, idx + query.length + halfWindow);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

function matchScore(text: string, query: string): number {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (!lower.includes(q)) return 0;
  if (lower === q) return 100;
  if (lower.startsWith(q)) return 80;
  const idx = lower.indexOf(q);
  return Math.max(1, 60 - idx * 0.1);
}

function searchDocuments(docs: FsDocument[], query: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const doc of docs) {
    const titleScore = matchScore(doc.title, query) * 2;
    const contentScore = matchScore(doc.content, query);
    const best = Math.max(titleScore, contentScore);
    if (best > 0) {
      const snippetSource = titleScore >= contentScore ? doc.title : doc.content;
      results.push({
        id: doc.id,
        type: "document",
        title: doc.title,
        snippet: buildSnippet(snippetSource, query),
        score: best,
      });
    }
  }
  return results;
}

function searchWikiEntries(entries: FsWikiEntry[], query: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const entry of entries) {
    const titleScore = matchScore(entry.title, query) * 2;
    const contentScore = matchScore(entry.content, query);
    const aliasScore = matchScore(entry.aliases, query) * 1.5;
    const best = Math.max(titleScore, contentScore, aliasScore);
    if (best > 0) {
      let snippetSource = entry.content;
      if (titleScore >= contentScore && titleScore >= aliasScore) snippetSource = entry.title;
      else if (aliasScore >= contentScore) snippetSource = entry.aliases;
      results.push({
        id: entry.id,
        type: "wiki",
        title: entry.title,
        snippet: buildSnippet(snippetSource, query),
        score: best,
      });
    }
  }
  return results;
}

function searchTimelines(timelines: FsTimeline[], query: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const tl of timelines) {
    const titleScore = matchScore(tl.title, query) * 2;
    if (titleScore > 0) {
      results.push({
        id: tl.id,
        type: "timeline",
        title: tl.title,
        snippet: buildSnippet(tl.title, query),
        score: titleScore,
      });
    }
    for (const evt of tl.events) {
      const evtTitleScore = matchScore(evt.title, query) * 1.5;
      const evtContentScore = matchScore(evt.content ?? "", query);
      const evtSummaryScore = matchScore(evt.summary ?? "", query);
      const best = Math.max(evtTitleScore, evtContentScore, evtSummaryScore);
      if (best > 0) {
        let snippetSource = evt.title;
        if (evtContentScore >= evtTitleScore && evtContentScore >= evtSummaryScore) snippetSource = evt.content ?? "";
        else if (evtSummaryScore >= evtTitleScore) snippetSource = evt.summary ?? "";
        results.push({
          id: evt.id,
          type: "event",
          title: `${evt.title} (${tl.title})`,
          snippet: buildSnippet(snippetSource, query),
          score: best,
        });
      }
    }
  }
  return results;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const projectId = url.searchParams.get("projectId");

  if (!projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }
  if (!q) {
    return Response.json({ results: [] });
  }

  const [docs, wikis, timelines] = await Promise.all([
    listDocuments(projectId),
    listWikiEntries(projectId),
    listTimelines(projectId),
  ]);

  const results: SearchResult[] = [
    ...searchDocuments(docs, q),
    ...searchWikiEntries(wikis, q),
    ...searchTimelines(timelines, q),
  ];

  results.sort((a, b) => b.score - a.score);

  return Response.json({ results: results.slice(0, 20) });
}
