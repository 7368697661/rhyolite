import { listProjects, listDocuments, listTimelines, readDocumentTimeline, readTimeline, writeDocumentTimeline, writeTimeline, type FsTimelineEvent, type FsEventEdge } from "@/lib/fs-db";

export async function resolveTimelineScope(documentId: string | null, timelineId: string | null) {
  const projects = await listProjects();
  for (const p of projects) {
    if (timelineId) {
      const timelines = await listTimelines(p.id);
      const t = timelines.find((x) => x.id === timelineId);
      if (t) {
        return {
          projectId: p.id,
          scopeType: "timeline" as const,
          id: timelineId,
          data: t
        };
      }
    } else if (documentId) {
      const docs = await listDocuments(p.id);
      const d = docs.find((x) => x.id === documentId);
      if (d) {
        const data = await readDocumentTimeline(p.id, documentId);
        return {
          projectId: p.id,
          scopeType: "document" as const,
          id: documentId,
          data
        };
      }
    }
  }
  return null;
}

export async function saveTimelineScope(
  projectId: string, 
  scopeType: "timeline" | "document", 
  id: string, 
  data: { events: FsTimelineEvent[], edges: FsEventEdge[], title?: string, createdAt?: string, updatedAt?: string }
) {
  if (scopeType === "timeline") {
    await writeTimeline({
      id,
      projectId,
      title: data.title || "Untitled",
      events: data.events,
      edges: data.edges,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } else {
    await writeDocumentTimeline(projectId, id, { events: data.events, edges: data.edges });
  }
}