import { z } from "zod";
import { writeChat } from "@/lib/fs-db";
import { findChatScope } from "../scope";

export const dynamic = "force-dynamic";

const ChatUpdateSchema = z.object({
  glyphId: z.string().min(1),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = ChatUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const scope = await findChatScope(chatId);
  if (!scope) return Response.json({ error: "Chat not found" }, { status: 404 });

  scope.chat.glyphId = parsed.data.glyphId;
  scope.chat.updatedAt = new Date().toISOString();

  await writeChat(scope.projectId, scope.chat);

  return Response.json(scope.chat);
}
