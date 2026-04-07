// @ts-nocheck — prisma schema not yet generated; this module is unused for now
import { prisma } from "@/lib/prisma";

/** Legacy chats: chain messages by createdAt and set tip to the last message. */
export async function backfillLinearMessageParentsIfNeeded(chatId: string) {
  const msgs = await prisma.chatMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    select: { id: true, parentMessageId: true },
  });
  if (msgs.length === 0) return;
  if (msgs.some((m) => m.parentMessageId != null)) return;

  let prevId: string | null = null;
  for (const m of msgs) {
    await prisma.chatMessage.update({
      where: { id: m.id },
      data: { parentMessageId: prevId },
    });
    prevId = m.id;
  }

  await prisma.chat.update({
    where: { id: chatId },
    data: { activeTipMessageId: prevId },
  });
}
