import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const FolderUpdateSchema = z.object({
  name: z.string().min(1).optional(),
});

export async function GET(req: Request, { params }: any) {
  const { folderId } = await params;
  const folder = await prisma.projectFolder.findUnique({
    where: { id: folderId },
  });
  if (!folder) return new Response(null, { status: 404 });
  return Response.json(folder);
}

export async function PUT(req: Request, { params }: any) {
  const { folderId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = FolderUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updated = await prisma.projectFolder.update({
    where: { id: folderId },
    data: parsed.data,
  });
  return Response.json(updated);
}

export async function DELETE(req: Request, { params }: any) {
  const { folderId } = await params;
  await prisma.projectFolder.delete({ where: { id: folderId } });
  return new Response(null, { status: 204 });
}
