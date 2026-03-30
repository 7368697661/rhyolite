import { resolveChatScope } from "@/lib/scopeResolver";

export async function findChatScope(chatId: string) {
  const result = await resolveChatScope(chatId);
  if (result) return { projectId: result.projectId, chat: result.chat };
  return null;
}
