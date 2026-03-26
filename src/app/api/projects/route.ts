import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ProjectCreateSchema = z.object({
  name: z.string().min(1),
  storyOutline: z.string().optional(),
  loreBible: z.string().optional(),
});

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { documents: true, wikiEntries: true } }
    }
  });
  return Response.json(projects);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = ProjectCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const project = await prisma.project.create({
    data: parsed.data,
  });
  return Response.json(project, { status: 201 });
}