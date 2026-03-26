import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ProjectUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  storyOutline: z.string().optional(),
  loreBible: z.string().optional(),
});

export async function GET(req: Request, { params }: any) {
  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) return new Response(null, { status: 404 });
  return Response.json(project);
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

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: parsed.data,
  });
  return Response.json(updated);
}

export async function DELETE(req: Request, { params }: any) {
  const { projectId } = await params;
  await prisma.project.delete({ where: { id: projectId } });
  return new Response(null, { status: 204 });
}