import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const WikiEntryUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  aliases: z.string().optional(),
  folderId: z.string().nullable().optional(),
});

export async function GET(req: Request, { params }: any) {
  const { wikiId } = await params;
  const entry = await prisma.wikiEntry.findUnique({
    where: { id: wikiId },
  });
  if (!entry) return new Response(null, { status: 404 });
  return Response.json(entry);
}

export async function PUT(req: Request, { params }: any) {
  const { wikiId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = WikiEntryUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updated = await prisma.wikiEntry.update({
    where: { id: wikiId },
    data: parsed.data,
  });
  return Response.json(updated);
}

export async function DELETE(req: Request, { params }: any) {
  const { wikiId } = await params;
  await prisma.wikiEntry.delete({ where: { id: wikiId } });
  return new Response(null, { status: 204 });
}