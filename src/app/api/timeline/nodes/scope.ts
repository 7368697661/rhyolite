import {
  listProjects,
  listTimelines,
  listDocuments,
  readDocumentTimeline,
  lookupEntity,
  readTimeline,
  indexEntity,
} from "@/lib/fs-db";

/**
 * Searches for a timeline node across all scopes.
 *
 * Optimisation: if the node's parent timelineId is recorded in the entity
 * index we can skip the full project scan. Nodes themselves aren't indexed
 * (they live inside timelines), but we try to resolve via the timeline index
 * first, falling back to the full scan when needed. A successful scan also
 * back-fills the timeline index entry so subsequent lookups are fast.
 */
export async function findNodeScope(nodeId: string) {
  // Fast-path: check if any indexed timeline contains this node
  const indexed = await lookupEntity(nodeId);
  if (indexed && indexed.type === "timeline") {
    const t = await readTimeline(indexed.projectId, nodeId);
    if (t) {
      const node = t.events.find((e) => e.id === nodeId);
      if (node) {
        return { projectId: indexed.projectId, scopeType: "timeline" as const, id: t.id, data: t, node };
      }
    }
  }

  // Full scan (cold-start or stale index)
  const projects = await listProjects();
  for (const p of projects) {
    const timelines = await listTimelines(p.id);
    for (const t of timelines) {
      const node = t.events.find((e) => e.id === nodeId);
      if (node) {
        await indexEntity(t.id, p.id, "timeline");
        return { projectId: p.id, scopeType: "timeline" as const, id: t.id, data: t, node };
      }
    }
    const docs = await listDocuments(p.id);
    for (const d of docs) {
      const data = await readDocumentTimeline(p.id, d.id);
      const node = data.events.find((e) => e.id === nodeId);
      if (node) {
        return { projectId: p.id, scopeType: "document" as const, id: d.id, data, node };
      }
    }
  }
  return null;
}
