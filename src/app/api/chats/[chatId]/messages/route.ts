import { prisma } from "@/lib/prisma";
import { backfillLinearMessageParentsIfNeeded } from "@/lib/chatBackfill";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: any) {
  const { chatId } = await params;

  await backfillLinearMessageParentsIfNeeded(chatId);

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      activeTipMessageId: true,
      branchChoicesJson: true,
    },
  });

  if (!chat) {
    return new Response(JSON.stringify({ error: "Chat not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
      parentMessageId: true,
    },
  });

  return Response.json({
    chat: {
      id: chat.id,
      activeTipMessageId: chat.activeTipMessageId,
      branchChoicesJson: chat.branchChoicesJson,
    },
    messages,
  });
}
