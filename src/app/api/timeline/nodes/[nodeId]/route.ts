import { NextResponse } from "next/server";
import { z } from "zod";
import { readWikiEntry } from "@/lib/fs-db";
import { saveTimelineScope } from "../../resolveScope";
import { findNodeScope } from "../scope";

const NodeUpdateSchema = z.object({
  title: z.string().optional(),
  summary: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  tags: z.array(z.string()).optional(), // array of wikiEntry ids
  color: z.string().nullable().optional(),
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  nodeType: z.string().optional(),
  passFullContent: z.boolean().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  try {
    const { nodeId } = await params;
    const scope = await findNodeScope(nodeId);
    
    if (!scope) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    const tags = [];
    for (const tagId of scope.node.tags || []) {
      const w = await readWikiEntry(scope.projectId, tagId);
      if (w) tags.push({ id: w.id, title: w.title });
    }

    return NextResponse.json({ ...scope.node, tags });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  try {
    const { nodeId } = await params;
    const json = await request.json();
    const data = NodeUpdateSchema.parse(json);

    const scope = await findNodeScope(nodeId);
    if (!scope) return NextResponse.json({ error: "Node not found" }, { status: 404 });

    const n = scope.node;
    if (data.title !== undefined) n.title = data.title;
    if (data.summary !== undefined) n.summary = data.summary;
    if (data.content !== undefined) n.content = data.content;
    if (data.positionX !== undefined) n.positionX = data.positionX;
    if (data.positionY !== undefined) n.positionY = data.positionY;
    if (data.tags !== undefined) n.tags = data.tags;
    if (data.color !== undefined) n.color = data.color;
    if (data.referenceType !== undefined) n.referenceType = data.referenceType;
    if (data.referenceId !== undefined) n.referenceId = data.referenceId;
    if (data.nodeType !== undefined) n.nodeType = data.nodeType;
    if (data.passFullContent !== undefined) n.passFullContent = data.passFullContent;

    await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);

    const tags = [];
    for (const tagId of n.tags || []) {
      const w = await readWikiEntry(scope.projectId, tagId);
      if (w) tags.push({ id: w.id, title: w.title });
    }

    return NextResponse.json({ ...n, tags });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const { nodeId } = await params;
  const scope = await findNodeScope(nodeId);
  if (!scope) return NextResponse.json({ error: "Node not found" }, { status: 404 });

  scope.data.events = scope.data.events.filter((e) => e.id !== nodeId);
  scope.data.edges = scope.data.edges.filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId);

  await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);

  return NextResponse.json({ success: true });
}