import {
  childrenByParent,
  extendTipFromModel,
  parseBranchChoices,
  serializeBranchChoices,
  type BranchMessage,
} from "@/lib/messageBranch";
import { collectSubtreeIds } from "@/lib/messageSubtree";
import { z } from "zod";
import { findChatScope } from "../../../scope";
import { writeChat, type FsChat } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

async function recomputeTipAfterDeletes(
  chat: FsChat,
  deletedIds: Set<string>,
  previousTip: string | null
) {
  const remaining = chat.messages as BranchMessage[];

  if (remaining.length === 0) {
    chat.activeTipMessageId = null;
    chat.branchChoicesJson = "{}";
    return;
  }

  let tip = previousTip;
  const byId = new Map(remaining.map((m) => [m.id, m]));
  while (tip && deletedIds.has(tip)) {
    const m = byId.get(tip);
    tip = m?.parentMessageId ?? null;
  }
  if (!tip || deletedIds.has(tip)) {
    const last = remaining.reduce((a, b) =>
      new Date(a.createdAt) > new Date(b.createdAt) ? a : b
    );
    tip = last.id;
  }

  const kids = childrenByParent(remaining);
  const choices = parseBranchChoices(chat.branchChoicesJson);

  const cleaned: Record<string, string> = {};
  for (const [u, m] of Object.entries(choices)) {
    if (!deletedIds.has(u) && !deletedIds.has(m)) cleaned[u] = m;
  }

  let newTip = tip;
  const tipMsg = byId.get(newTip);
  if (tipMsg?.role === "model") {
    newTip = extendTipFromModel(newTip, kids, cleaned);
  }

  chat.activeTipMessageId = newTip;
  chat.branchChoicesJson = serializeBranchChoices(cleaned);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ chatId: string; messageId: string }> }
) {
  const { chatId, messageId } = await params;

  const scope = await findChatScope(chatId);
  if (!scope) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  const { chat } = scope;
  const all = chat.messages.map((m) => ({ id: m.id, parentMessageId: m.parentMessageId }));

  const target = all.find((m) => m.id === messageId);
  if (!target) {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }

  const toDelete = new Set(collectSubtreeIds(messageId, all));
  const prevTip = chat.activeTipMessageId;

  chat.messages = chat.messages.filter((m) => !toDelete.has(m.id));

  await recomputeTipAfterDeletes(chat, toDelete, prevTip);
  chat.updatedAt = new Date().toISOString();
  await writeChat(scope.projectId, chat);

  return Response.json({ ok: true });
}

const PatchSchema = z.object({
  content: z.string().min(1),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ chatId: string; messageId: string }> }
) {
  const { chatId, messageId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const scope = await findChatScope(chatId);
  if (!scope) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  const { chat } = scope;
  const msg = chat.messages.find((m) => m.id === messageId && m.role === "user");
  if (!msg) {
    return Response.json({ error: "User message not found" }, { status: 404 });
  }

  const all = chat.messages.map((m) => ({ id: m.id, parentMessageId: m.parentMessageId }));
  const kids = all.filter((m) => m.parentMessageId === messageId);
  
  const toDelete = new Set<string>();
  for (const k of kids) {
    for (const id of collectSubtreeIds(k.id, all)) toDelete.add(id);
  }

  const prevTip = chat.activeTipMessageId;

  chat.messages = chat.messages.filter((m) => !toDelete.has(m.id));
  
  const updateMsg = chat.messages.find((m) => m.id === messageId);
  if (updateMsg) {
    updateMsg.content = parsed.data.content;
  }

  await recomputeTipAfterDeletes(chat, toDelete, prevTip);
  chat.updatedAt = new Date().toISOString();
  await writeChat(scope.projectId, chat);

  return Response.json({ ok: true });
}
