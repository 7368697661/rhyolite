import { NextResponse } from "next/server";
import { resolveTimelineScope } from "./resolveScope";
import { readWikiEntry } from "@/lib/fs-db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get("documentId");
  const timelineId = searchParams.get("timelineId");

  if ((documentId && timelineId) || (!documentId && !timelineId)) {
    return NextResponse.json(
      { error: "Provide exactly one of documentId or timelineId" },
      { status: 400 }
    );
  }

  const scope = await resolveTimelineScope(documentId, timelineId);
  if (!scope) {
    return NextResponse.json({ nodes: [], edges: [] });
  }

  const nodes = [...scope.data.events];
  // Need to populate tags for frontend compatibility
  const enrichedNodes = await Promise.all(
    nodes.map(async (n) => {
      const tags = [];
      for (const tagId of n.tags || []) {
        const w = await readWikiEntry(scope.projectId, tagId);
        if (w) tags.push({ id: w.id, title: w.title });
      }
      return { ...n, tags };
    })
  );

  return NextResponse.json({ nodes: enrichedNodes, edges: scope.data.edges });
}
