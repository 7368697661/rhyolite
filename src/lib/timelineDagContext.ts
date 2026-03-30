import { listProjects, listTimelines, listDocuments, readDocumentTimeline, readProject, readDocument, listWikiEntries, type FsTimelineEvent, type FsEventEdge, type FsProject, type FsDocument, type FsWikiEntry } from "./fs-db";

/** BFS backward through edges (parents of active node), up to `depth` hops. */
function getAncestorSubgraph(
  startId: string,
  edges: { sourceId: string; targetId: string; label?: string | null }[],
  depth: number
) {
  const nodeIds = new Set<string>();
  const relevantEdges = new Set<{ sourceId: string; targetId: string; label?: string | null }>();
  
  const queue: { id: string; d: number }[] = [{ id: startId, d: 0 }];
  nodeIds.add(startId);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr.d >= depth) continue;
    
    const parentEdges = edges.filter((e) => e.targetId === curr.id);
    for (const edge of parentEdges) {
      relevantEdges.add(edge);
      if (!nodeIds.has(edge.sourceId)) {
        nodeIds.add(edge.sourceId);
        queue.push({ id: edge.sourceId, d: curr.d + 1 });
      }
    }
  }
  
  nodeIds.delete(startId); // keep startId out of the ancestor list if preferred, but we need it for edges
  return { ancestorIds: Array.from(nodeIds), subgraphEdges: Array.from(relevantEdges) };
}

async function getFullTimelineGraph(nodeId: string): Promise<{ activeNode: FsTimelineEvent, allNodes: FsTimelineEvent[], allEdges: FsEventEdge[] } | null> {
  const projects = await listProjects();
  for (const p of projects) {
    const timelines = await listTimelines(p.id);
    for (const t of timelines) {
      const node = t.events.find((e) => e.id === nodeId);
      if (node) return { activeNode: node, allNodes: t.events, allEdges: t.edges };
    }
    const docs = await listDocuments(p.id);
    for (const d of docs) {
      const data = await readDocumentTimeline(p.id, d.id);
      const node = data.events.find((e) => e.id === nodeId);
      if (node) return { activeNode: node, allNodes: data.events, allEdges: data.edges };
    }
  }
  return null;
}

export async function buildTimelineDagRagFragment(
  activeTimelineEventId: string
): Promise<string> {
  const graph = await getFullTimelineGraph(activeTimelineEventId);
  if (!graph) return "";

  const { activeNode, allNodes, allEdges } = graph;
  const { ancestorIds, subgraphEdges } = getAncestorSubgraph(activeNode.id, allEdges, 10);
  const ancestorNodes = allNodes.filter((n) => ancestorIds.includes(n.id));

  let ragContextText = `[TIMELINE DAG CONTEXT]\n`;
  ragContextText += `Active Node: [${activeNode.nodeType || "Event"}] "${activeNode.title}"\n`;
  if (activeNode.content) {
    ragContextText += `Content: ${activeNode.content}\n\n`;
  }

  if (ancestorNodes.length > 0) {
    ragContextText += `[UPSTREAM CONTEXT]\n`;
    for (const n of ancestorNodes) {
      const typeLabel = n.nodeType || "Event";
      const details = n.passFullContent 
        ? (n.content || n.summary || "No content.")
        : (n.summary || n.content || "No summary.");
      ragContextText += `* [${typeLabel}] "${n.title}":\n  ${details}\n`;
    }
    ragContextText += `\n`;
  }

  if (subgraphEdges.length > 0) {
    ragContextText += `[LOGICAL RELATIONSHIPS (DAG PATHS)]\n`;
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));
    
    for (const e of subgraphEdges) {
      const src = nodeMap.get(e.sourceId);
      const tgt = nodeMap.get(e.targetId);
      if (src && tgt) {
        const srcLabel = `[${src.nodeType || "Event"}] "${src.title}"`;
        const tgtLabel = `[${tgt.nodeType || "Event"}] "${tgt.title}"`;
        const edgeLabel = e.label ? e.label : "Leads to";
        ragContextText += `* ${srcLabel} --(${edgeLabel})--> ${tgtLabel}\n`;
      }
    }
    ragContextText += `\n`;
  }

  return ragContextText;
}

export async function resolveChatProjectContext(
  chat: { documentId: string | null; timelineId: string | null }
): Promise<{ project: (FsProject & { wikiEntries: FsWikiEntry[] }) | null; document: FsDocument | null }> {
  const projects = await listProjects();
  for (const p of projects) {
    if (chat.documentId) {
      const docs = await listDocuments(p.id);
      const document = docs.find((d) => d.id === chat.documentId);
      if (document) {
        const wikiEntries = await listWikiEntries(p.id);
        return { project: { ...p, wikiEntries }, document };
      }
    } else if (chat.timelineId) {
      const timelines = await listTimelines(p.id);
      const timeline = timelines.find((t) => t.id === chat.timelineId);
      if (timeline) {
        const wikiEntries = await listWikiEntries(p.id);
        return { project: { ...p, wikiEntries }, document: null };
      }
    }
  }
  return { project: null, document: null };
}
