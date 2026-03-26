import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ChatCreateSchema = z.object({
  title: z.string().min(1),
  glyphId: z.string().min(1),
  documentId: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const documentId = url.searchParams.get("documentId") ?? undefined;

  const whereClause: any = {};
  if (documentId) whereClause.documentId = documentId;

  const chats = await prisma.chat.findMany({
    where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
    orderBy: { updatedAt: "desc" },
    include: {
      glyph: { select: { id: true, name: true, model: true } },
      _count: { select: { messages: true } },
    },
  });

  return Response.json(chats);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = ChatCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid payload", details: parsed.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const chat = await prisma.chat.create({ data: parsed.data });
  return Response.json(chat, { status: 201 });
}

