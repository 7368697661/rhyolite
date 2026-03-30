import { NextRequest, NextResponse } from "next/server";
import { readPromptTemplates, writePromptTemplates, listProjects } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ promptId: string }> }
) {
  const { promptId } = await params;

  const projects = await listProjects();
  for (const project of projects) {
    const templates = await readPromptTemplates(project.id);
    const idx = templates.findIndex((t) => t.id === promptId);
    if (idx !== -1) {
      templates.splice(idx, 1);
      await writePromptTemplates(project.id, templates);
      return NextResponse.json({ success: true });
    }
  }

  return NextResponse.json({ error: "Template not found" }, { status: 404 });
}
