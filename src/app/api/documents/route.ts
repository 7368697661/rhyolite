import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const DocumentCreateSchema = z.object({
  title: z.string().min(1),
  projectId: z.string().min(1),
  content: z.string().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  
  if (!projectId) {
    return new Response(JSON.stringify({ error: "projectId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const documents = await prisma.document.findMany({
    where: { projectId },
    orderBy: { orderIndex: "asc" },
  });
  return Response.json(documents);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = DocumentCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Set orderIndex to place it at the end
  const lastDoc = await prisma.document.findFirst({
    where: { projectId: parsed.data.projectId },
    orderBy: { orderIndex: "desc" },
  });
  const orderIndex = lastDoc ? lastDoc.orderIndex + 1 : 0;

  const doc = await prisma.document.create({
    data: { ...parsed.data, orderIndex },
  });
  return Response.json(doc, { status: 201 });
}