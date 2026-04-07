import { listDocuments, listTimelines, listWikiEntries, type FsEventEdge, type FsTimelineEvent } from "./fs-db";

type NetworkNodeKind = "document" | "wiki" | "event";

function docNodeId(docId: string) {
  return `doc:${docId}`;
}

function wikiNodeId(wikiId: string) {
  return `wiki:${wikiId}`;
}

function eventNodeId(eventId: string) {
  return `evt:${eventId}`;
}

export interface NetworkData {
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: {
      kind: NetworkNodeKind;
      title: string;
      color: string;
      entityType?: "document" | "wiki" | "event";
      entityId?: string;
      timelineId?: string | null;
      documentId?: string | null;
      referenceType?: string | null;
      referenceId?: string | null;
      tags?: string[];
      nodeType?: string;
      passFullContent?: boolean;
      summary?: string | null;
    };
    type?: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    kind?: "timeline" | "reference" | "tag" | "link";
    label?: string | null;
  }>;
}

export async function getNetworkGraph(projectId: string): Promise<NetworkData> {
  const [documents, wikiEntries, timelines] = await Promise.all([
    listDocuments(projectId),
    listWikiEntries(projectId),
    listTimelines(projectId),
  ]);

  const documentTitleById = new Map(documents.map((d) => [d.id, d.title]));
  const wikiTitleById = new Map(wikiEntries.map((w) => [w.id, w.title]));

  const nodes: NetworkData["nodes"] = [];
  const edges: NetworkData["edges"] = [];

  // ── Content-based link scanning ──────────────────────────────────
  const titleToNodeId = new Map<string, string>();
  for (const d of documents) {
    titleToNodeId.set(d.title.toLowerCase(), docNodeId(d.id));
  }
  for (const w of wikiEntries) {
    titleToNodeId.set(w.title.toLowerCase(), wikiNodeId(w.id));
    for (const alias of (w.aliases ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)) {
      titleToNodeId.set(alias, wikiNodeId(w.id));
    }
  }

  const bracketLinkPattern = /\[\[([^\]]+)\]\]|\[([^\]!][^\]]*)\]/g;

  function extractContentLinks(
    sourceNodeId: string,
    content: string | null | undefined
  ) {
    if (!content) return;
    let match: RegExpExecArray | null;
    bracketLinkPattern.lastIndex = 0;
    const seen = new Set<string>();
    while ((match = bracketLinkPattern.exec(content)) !== null) {
      const raw = (match[1] ?? match[2] ?? "").trim().toLowerCase();
      if (!raw) continue;
      const targetNodeId = titleToNodeId.get(raw);
      if (!targetNodeId || targetNodeId === sourceNodeId) continue;
      const edgeKey = `link:${sourceNodeId}:${targetNodeId}`;
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      edges.push({
        id: edgeKey,
        source: sourceNodeId,
        target: targetNodeId,
        kind: "link",
        label: null,
      });
    }
  }

  for (const d of documents) {
    extractContentLinks(docNodeId(d.id), d.content);
  }
  for (const w of wikiEntries) {
    extractContentLinks(wikiNodeId(w.id), w.content);
  }

  // Documents
  for (const d of documents) {
    nodes.push({
      id: docNodeId(d.id),
      position: { x: 0, y: 0 },
      data: {
        kind: "document",
        title: d.title,
        color: "#fbbf24", // amber
        entityType: "document",
        entityId: d.id,
        timelineId: null,
        documentId: d.id,
      },
      type: "network",
    });
  }

  // Wiki entries
  for (const w of wikiEntries) {
    nodes.push({
      id: wikiNodeId(w.id),
      position: { x: 0, y: 0 },
      data: {
        kind: "wiki",
        title: w.title,
        color: "#22d3ee", // cyan
        entityType: "wiki",
        entityId: w.id,
        timelineId: null,
        documentId: null,
      },
      type: "network",
    });
  }

  const addTimelineEdgesAndRefs = (events: FsTimelineEvent[], eventEdges: FsEventEdge[]) => {
    for (const e of eventEdges) {
      edges.push({
        id: `edge:${e.id}`,
        source: eventNodeId(e.source),
        target: eventNodeId(e.target),
        kind: "timeline",
        label: e.label ?? null,
      });
    }

    for (const ev of events) {
      if (ev.referenceType === "document" && ev.referenceId) {
        edges.push({
          id: `ref:doc:${ev.id}:${ev.referenceId}`,
          source: eventNodeId(ev.id),
          target: docNodeId(ev.referenceId),
          kind: "reference",
          label: documentTitleById.get(ev.referenceId)
            ? `→ ${documentTitleById.get(ev.referenceId)}`
            : "→ DOC",
        });
      }
      if (ev.referenceType === "wiki" && ev.referenceId) {
        edges.push({
          id: `ref:wiki:${ev.id}:${ev.referenceId}`,
          source: eventNodeId(ev.id),
          target: wikiNodeId(ev.referenceId),
          kind: "reference",
          label: wikiTitleById.get(ev.referenceId)
            ? `→ ${wikiTitleById.get(ev.referenceId)}`
            : "→ ART",
        });
      }

      for (const tagId of ev.tags ?? []) {
        edges.push({
          id: `tag:wiki:${ev.id}:${tagId}`,
          source: eventNodeId(ev.id),
          target: wikiNodeId(tagId),
          kind: "tag",
          label: wikiTitleById.get(tagId) ? `@${wikiTitleById.get(tagId)}` : null,
        });
      }
    }
  };

  // Timelines
  for (const tl of timelines) {
    for (const ev of tl.events) {
      nodes.push({
        id: eventNodeId(ev.id),
        position: { x: 0, y: 0 },
        data: {
          kind: "event",
          title: ev.title,
          color: ev.color ?? "#8b5cf6",
          entityType: "event",
          entityId: ev.id,
          timelineId: tl.id,
          documentId: null,
          nodeType: ev.nodeType,
          passFullContent: ev.passFullContent,
          referenceType: ev.referenceType,
          referenceId: ev.referenceId,
          tags: ev.tags ?? [],
          summary: ev.summary ?? null,
        },
        type: "network",
      });
    }

    addTimelineEdgesAndRefs(tl.events, tl.edges);
  }

  const nodeById = new Map<string, typeof nodes[number]>();
  for (const n of nodes) nodeById.set(n.id, n);

  const edgeById = new Map<string, typeof edges[number]>();
  for (const e of edges) edgeById.set(e.id, e);

  return {
    nodes: Array.from(nodeById.values()),
    edges: Array.from(edgeById.values()),
  };
}