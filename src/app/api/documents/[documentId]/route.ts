import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const DocumentUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  orderIndex: z.number().optional(),
  folderId: z.string().nullable().optional(),
});

export async function GET(req: Request, { params }: any) {
  const { documentId } = await params;
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });
  if (!document) return new Response(null, { status: 404 });
  return Response.json(document);
}

export async function PUT(req: Request, { params }: any) {
  const { documentId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = DocumentUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: parsed.data,
  });
  return Response.json(updated);
}

export async function DELETE(req: Request, { params }: any) {
  const { documentId } = await params;
  await prisma.document.delete({ where: { id: documentId } });
  return new Response(null, { status: 204 });
}