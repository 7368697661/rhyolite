import { NextResponse } from "next/server";
import { z } from "zod";
import { generateId, type FsEventEdge } from "@/lib/fs-db";
import { findNodeScope } from "../nodes/scope";
import { saveTimelineScope } from "../resolveScope";

// Relax cuid validation since we use @paralleldrive/cuid2
const EdgeCreateSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  label: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const data = EdgeCreateSchema.parse(json);

    // Assume source and target are in the same scope. Look up by sourceId.
    const scope = await findNodeScope(data.sourceId);
    if (!scope) {
      return NextResponse.json({ error: "Scope not found for sourceId" }, { status: 404 });
    }

    const edge: FsEventEdge = {
      id: generateId(),
      sourceId: data.sourceId,
      targetId: data.targetId,
      label: data.label || null,
    };

    scope.data.edges.push(edge);
    await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);

    return NextResponse.json(edge);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
