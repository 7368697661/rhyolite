import { NextResponse } from "next/server";
import { builtInTemplates, type DagTemplate } from "@/lib/dagTemplates";
import {
  listProjects,
  listTimelines,
  readTimeline,
  writeTimeline,
  generateId,
  type FsTimelineEvent,
  type FsEventEdge,
} from "@/lib/fs-db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ templates: builtInTemplates });
}

async function findTimelineAndProject(timelineId: string) {
  const projects = await listProjects();
  for (const p of projects) {
    const timelines = await listTimelines(p.id);
    const t = timelines.find((x) => x.id === timelineId);
    if (t) return { projectId: p.id, timeline: t };
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { templateId, timelineId } = body as {
      templateId: string;
      timelineId: string;
    };

    if (!templateId || !timelineId) {
      return NextResponse.json(
        { error: "templateId and timelineId are required" },
        { status: 400 }
      );
    }

    const template = builtInTemplates.find((t) => t.id === templateId);
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    const result = await findTimelineAndProject(timelineId);
    if (!result) {
      return NextResponse.json(
        { error: "Timeline not found" },
        { status: 404 }
      );
    }

    const { projectId, timeline } = result;

    const tempIdToRealId = new Map<string, string>();
    for (const tNode of template.nodes) {
      tempIdToRealId.set(tNode.tempId, generateId());
    }

    const newEvents: FsTimelineEvent[] = template.nodes.map((tNode) => ({
      id: tempIdToRealId.get(tNode.tempId)!,
      title: tNode.title,
      summary: null,
      content: tNode.content,
      nodeType: tNode.nodeType,
      passFullContent: false,
      color: tNode.color,
      referenceType: null,
      referenceId: null,
      positionX: tNode.positionX,
      positionY: tNode.positionY,
      timelineId,
      documentId: null,
      tags: [],
    }));

    const newEdges: FsEventEdge[] = template.edges.map((tEdge) => ({
      id: generateId(),
      sourceId: tempIdToRealId.get(tEdge.sourceTempId)!,
      targetId: tempIdToRealId.get(tEdge.targetTempId)!,
      label: tEdge.label,
    }));

    timeline.events.push(...newEvents);
    timeline.edges.push(...newEdges);
    timeline.updatedAt = new Date().toISOString();

    await writeTimeline(timeline);

    return NextResponse.json({
      events: timeline.events,
      edges: timeline.edges,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
