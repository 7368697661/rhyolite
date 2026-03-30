import { NextResponse } from "next/server";
import { z } from "zod";
import { generateId, type FsTimelineEvent } from "@/lib/fs-db";
import { resolveTimelineScope, saveTimelineScope } from "../resolveScope";

const NodeCreateSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    documentId: z.string().optional(),
    timelineId: z.string().optional(),
    positionX: z.number().default(0),
    positionY: z.number().default(0),
    color: z.string().nullable().optional(),
    referenceType: z.string().nullable().optional(),
    referenceId: z.string().nullable().optional(),
    nodeType: z.string().default("Event"),
    passFullContent: z.boolean().default(false),
  })
  .refine(
    (d) => Boolean(d.documentId) !== Boolean(d.timelineId),
    "Provide exactly one of documentId or timelineId"
  );

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const data = NodeCreateSchema.parse(json);

    const scope = await resolveTimelineScope(data.documentId || null, data.timelineId || null);
    if (!scope) {
      return NextResponse.json({ error: "Scope not found" }, { status: 404 });
    }

    const node: FsTimelineEvent = {
      id: generateId(),
      title: data.title,
      summary: null,
      content: null,
      documentId: data.documentId ?? null,
      timelineId: data.timelineId ?? null,
      positionX: data.positionX,
      positionY: data.positionY,
      color: data.color || null,
      referenceType: data.referenceType || null,
      referenceId: data.referenceId || null,
      nodeType: data.nodeType,
      passFullContent: data.passFullContent,
      tags: [],
    };

    scope.data.events.push(node);
    await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);

    return NextResponse.json({ ...node, tags: [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
