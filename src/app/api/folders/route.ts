import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const FolderCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["document", "wiki"]),
  projectId: z.string().min(1),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return new Response(JSON.stringify({ error: "Missing projectId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const folders = await prisma.projectFolder.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  return Response.json(folders);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = FolderCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const folder = await prisma.projectFolder.create({
    data: parsed.data,
  });
  return Response.json(folder, { status: 201 });
}
