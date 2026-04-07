import { listProjects, listTimelines, readDocument, listDocuments, readWikiEntry, listWikiEntries, type FsTimelineEvent, type FsEventEdge, type FsDocument, type FsWikiEntry } from "./fs-db";

/** BFS backward through edges (parents of active node), up to `depth` hops. */
function getAncestorSubgraph(
  startId: string,
  edges: FsEventEdge[],
  depth: number
) {
  const nodeIds = new Set<string>();
  const relevantEdges = new Set<FsEventEdge>();
  
  const queue: { id: string; d: number }[] = [{ id: startId, d: 0 }];
  nodeIds.add(startId);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr.d >= depth) continue;
    
    const parentEdges = edges.filter((e) => e.target === curr.id);
    for (const edge of parentEdges) {
      relevantEdges.add(edge);
      if (!nodeIds.has(edge.source)) {
        nodeIds.add(edge.source);
        queue.push({ id: edge.source, d: curr.d + 1 });
      }
    }
  }
  
  nodeIds.delete(startId); // keep startId out of the ancestor list if preferred, but we need it for edges
  return { ancestorIds: Array.from(nodeIds), subgraphEdges: Array.from(relevantEdges) };
}

async function getFullTimelineGraph(nodeId: string): Promise<{ activeNode: FsTimelineEvent, allNodes: FsTimelineEvent[], allEdges: FsEventEdge[], projectId: string } | null> {
  const projects = await listProjects();
  for (const p of projects) {
    const timelines = await listTimelines(p.id);
    for (const t of timelines) {
      const node = t.events.find((e) => e.id === nodeId);
      if (node) return { activeNode: node, allNodes: t.events, allEdges: t.edges, projectId: p.id };
    }
  }
  return null;
}

async function resolveNodeContent(node: FsTimelineEvent, projectId: string | null): Promise<{ content: string; summary: string }> {
  const content = node.content || "";
  const summary = node.summary || "";
  if (content || summary) return { content, summary };

  if (node.referenceType && node.referenceId && projectId) {
    try {
      if (node.referenceType === "wiki") {
        const wiki = await readWikiEntry(projectId, node.referenceId);
        if (wiki) return { content: wiki.content || "", summary: "" };
      } else if (node.referenceType === "document") {
        const doc = await readDocument(projectId, node.referenceId);
        if (doc) return { content: doc.content || "", summary: "" };
      }
    } catch { /* non-critical */ }
  }
  return { content: "", summary: "" };
}

export async function buildTimelineDagRagFragment(
  activeTimelineEventId: string
): Promise<string> {
  const graph = await getFullTimelineGraph(activeTimelineEventId);
  if (!graph) return "";

  const { activeNode, allNodes, allEdges, projectId } = graph;
  const { ancestorIds, subgraphEdges } = getAncestorSubgraph(activeNode.id, allEdges, 10);
  const ancestorNodes = allNodes.filter((n) => ancestorIds.includes(n.id));

  let ragContextText = `[TIMELINE DAG CONTEXT]\n`;
  ragContextText += `Active Node: [${activeNode.nodeType || "Event"}] "${activeNode.title}"\n`;
  const activeResolved = await resolveNodeContent(activeNode, projectId);
  if (activeResolved.content) {
    ragContextText += `Content: ${activeResolved.content}\n\n`;
  }

  if (ancestorNodes.length > 0) {
    ragContextText += `[UPSTREAM CONTEXT]\n`;
    for (const n of ancestorNodes) {
      const typeLabel = n.nodeType || "Event";
      const resolved = await resolveNodeContent(n, projectId);
      const details = n.passFullContent
        ? (resolved.content || resolved.summary || "No content.")
        : (resolved.summary || resolved.content || "No summary.");
      ragContextText += `* [${typeLabel}] "${n.title}":\n  ${details}\n`;
    }
    ragContextText += `\n`;
  }

  if (subgraphEdges.length > 0) {
    ragContextText += `[LOGICAL RELATIONSHIPS (DAG PATHS)]\n`;
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));
    
    for (const e of subgraphEdges) {
      const src = nodeMap.get(e.source);
      const tgt = nodeMap.get(e.target);
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
  chat: { documentId?: string | null; timelineId?: string | null; projectId?: string | null }
): Promise<{ project: ({ id: string; name: string } & { wikiEntries: FsWikiEntry[] }) | null; document: FsDocument | null }> {
  const projects = await listProjects();
  for (const p of projects) {
    if (chat.projectId && p.id !== chat.projectId) continue;

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

    // Fallback: if projectId matched but specific doc/timeline wasn't found,
    // still return the project with wiki entries so RAG can function
    if (chat.projectId && p.id === chat.projectId) {
      const wikiEntries = await listWikiEntries(p.id);
      let document: FsDocument | null = null;
      if (chat.documentId) {
        const docs = await listDocuments(p.id);
        document = docs.find((d) => d.id === chat.documentId) || null;
      }
      return { project: { ...p, wikiEntries }, document };
    }
  }
  return { project: null, document: null };
}
