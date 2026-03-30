import { findChatScope } from "../../scope";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: any) {
  const { chatId } = await params;

  const scope = await findChatScope(chatId);

  if (!scope) {
    return new Response(JSON.stringify({ error: "Chat not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { chat } = scope;

  // No need to backfill, FS chats are fresh.
  return Response.json({
    chat: {
      id: chat.id,
      activeTipMessageId: chat.activeTipMessageId,
      branchChoicesJson: chat.branchChoicesJson,
    },
    messages: chat.messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
  });
}
