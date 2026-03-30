import { NextResponse } from "next/server";
import { z } from "zod";
import { saveTimelineScope } from "../../resolveScope";
import { findEdgeScope } from "../scope";

const EdgeUpdateSchema = z.object({
  label: z.string().nullable().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ edgeId: string }> }
) {
  try {
    const { edgeId } = await params;
    const json = await request.json();
    const data = EdgeUpdateSchema.parse(json);

    const scope = await findEdgeScope(edgeId);
    if (!scope) return NextResponse.json({ error: "Edge not found" }, { status: 404 });

    scope.edge.label = data.label || null;

    await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);

    return NextResponse.json(scope.edge);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ edgeId: string }> }
) {
  const { edgeId } = await params;
  
  const scope = await findEdgeScope(edgeId);
  if (!scope) return NextResponse.json({ error: "Edge not found" }, { status: 404 });

  scope.data.edges = scope.data.edges.filter((e) => e.id !== edgeId);

  await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);

  return NextResponse.json({ success: true });
}
