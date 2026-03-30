import { NextRequest, NextResponse } from "next/server";
import { readPromptTemplates, writePromptTemplates, generateId, type FsPromptTemplate } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const templates = await readPromptTemplates(projectId);
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectId, name, template } = body as { projectId?: string; name?: string; template?: string };

  if (!projectId || !name || !template) {
    return NextResponse.json({ error: "projectId, name, and template are required" }, { status: 400 });
  }

  const templates = await readPromptTemplates(projectId);
  const newTemplate: FsPromptTemplate = {
    id: generateId(),
    projectId,
    name,
    template,
    createdAt: new Date().toISOString(),
  };
  templates.push(newTemplate);
  await writePromptTemplates(projectId, templates);

  return NextResponse.json(newTemplate, { status: 201 });
}
