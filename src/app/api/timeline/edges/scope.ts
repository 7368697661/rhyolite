import { listProjects, listTimelines, readDocumentTimeline, listDocuments } from "@/lib/fs-db";

export async function findEdgeScope(edgeId: string) {
  const projects = await listProjects();
  for (const p of projects) {
    const timelines = await listTimelines(p.id);
    for (const t of timelines) {
      const edge = t.edges.find((e) => e.id === edgeId);
      if (edge) {
        return { projectId: p.id, scopeType: "timeline" as const, id: t.id, data: t, edge };
      }
    }
    const docs = await listDocuments(p.id);
    for (const d of docs) {
      const data = await readDocumentTimeline(p.id, d.id);
      const edge = data.edges.find((e) => e.id === edgeId);
      if (edge) {
        return { projectId: p.id, scopeType: "document" as const, id: d.id, data, edge };
      }
    }
  }
  return null;
}
