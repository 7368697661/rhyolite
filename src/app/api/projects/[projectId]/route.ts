import { z } from "zod";
import { readProject, writeProject } from "@/lib/fs-db";
import fs from "fs/promises";
import { getProjectDir } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const ProjectUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  storyOutline: z.string().optional(),
  loreBible: z.string().optional(),
});

export async function GET(req: Request, { params }: any) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return new Response(null, { status: 404 });
  return Response.json({ ...project, name: project.title });
}

export async function PUT(req: Request, { params }: any) {
  const { projectId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = ProjectUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const project = await readProject(projectId);
  if (!project) return new Response(null, { status: 404 });

  if (parsed.data.name !== undefined) project.title = parsed.data.name;
  if (parsed.data.storyOutline !== undefined) project.storyOutline = parsed.data.storyOutline;
  if (parsed.data.loreBible !== undefined) project.loreBible = parsed.data.loreBible;
  project.updatedAt = new Date().toISOString();

  await writeProject(project);
  return Response.json({ ...project, name: project.title });
}

export async function DELETE(req: Request, { params }: any) {
  const { projectId } = await params;
  try {
    const pDir = await getProjectDir(projectId);
    await fs.rm(pDir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
  return new Response(null, { status: 204 });
}