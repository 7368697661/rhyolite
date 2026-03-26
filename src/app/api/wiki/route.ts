import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const WikiEntryCreateSchema = z.object({
  title: z.string().min(1),
  projectId: z.string().min(1),
  content: z.string().optional(),
  aliases: z.string().optional(),
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

  const entries = await prisma.wikiEntry.findMany({
    where: { projectId },
    orderBy: { title: "asc" },
  });
  return Response.json(entries);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = WikiEntryCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const entry = await prisma.wikiEntry.create({
    data: parsed.data,
  });
  return Response.json(entry, { status: 201 });
}