import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ChatUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  glyphId: z.string().min(1).optional(),
  activeTipMessageId: z.string().min(1).nullable().optional(),
  branchChoicesJson: z.string().optional(),
  documentId: z.string().optional().nullable(),
});

export async function PUT(
  req: Request,
  { params }: any
) {
  const json = await req.json().catch(() => null);
  const parsed = ChatUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid payload", details: parsed.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const updated = await prisma.chat.update({
    where: { id: params.chatId },
    data: parsed.data,
  });
  return Response.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: any
) {
  await prisma.chat.delete({ where: { id: params.chatId } });
  return new Response(null, { status: 204 });
}

