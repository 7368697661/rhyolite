import { prisma } from "@/lib/prisma";
import { backfillLinearMessageParentsIfNeeded } from "@/lib/chatBackfill";
import {
  chainFromTip,
  childrenByParent,
  extendTipFromModel,
  messagesById,
  parseBranchChoices,
  serializeBranchChoices,
  type BranchMessage,
} from "@/lib/messageBranch";
import { getSafetySettings, streamGeminiText, type SafetyPreset } from "@/lib/gemini";

export const dynamic = "force-dynamic";

type RegenerateInput = {
  chatId: string;
  safetyPreset?: SafetyPreset;
};

export async function POST(req: Request) {
  const body = (await req.json()) as RegenerateInput;
  if (!body?.chatId || typeof body.chatId !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'chatId'." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await backfillLinearMessageParentsIfNeeded(body.chatId);

  const chat = await prisma.chat.findUnique({
    where: { id: body.chatId },
    select: {
      id: true,
      glyphId: true,
      activeTipMessageId: true,
      branchChoicesJson: true,
      documentId: true,
    },
  });

  if (!chat) {
    return new Response(JSON.stringify({ error: "Chat not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!chat.activeTipMessageId) {
    return new Response(JSON.stringify({ error: "No active thread tip." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const glyph = await prisma.glyph.findUnique({
    where: { id: chat.glyphId },
  });
  if (!glyph) {
    return new Response(JSON.stringify({ error: "Glyph missing." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const all = (await prisma.chatMessage.findMany({
    where: { chatId: chat.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
      parentMessageId: true,
    },
  })) as BranchMessage[];

  const byId = messagesById(all);
  const chain = chainFromTip(chat.activeTipMessageId, byId);

  let lastUserIdx = -1;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) {
    return new Response(JSON.stringify({ error: "No user message found." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const promptChain = chain.slice(0, lastUserIdx + 1);
  const targetUser = chain[lastUserIdx];

  const contents = promptChain.map((m) => ({
    role: m.role as "user" | "model",
    parts: [{ text: m.content }],
  }));

  let systemInstruction = glyph.systemInstruction;

  if (chat.documentId) {
    const document = await prisma.document.findUnique({
      where: { id: chat.documentId },
      include: {
        project: {
          include: { wikiEntries: true },
        },
      },
    });

    if (document?.project) {
      const p = document.project;
      if (p.storyOutline) {
        systemInstruction += `\n\n---\nCHAPTER OUTLINE / PREVIOUS EVENTS:\n${p.storyOutline}`;
      }
      if (p.loreBible) {
        systemInstruction += `\n\n---\nSTORY / LORE BIBLE:\n${p.loreBible}`;
      }
      if (p.wikiEntries.length > 0) {
        systemInstruction += `\n\n---\nWIKI ENTRIES:\n`;
        for (const entry of p.wikiEntries) {
          systemInstruction += `\n### ${entry.title}\n${entry.content}\n`;
        }
      }
      if (document.content) {
        systemInstruction += `\n\n---\nCURRENT CHAPTER DRAFT:\n${document.content}\n\n(Please do not repeat the chapter text, only use it as context unless specifically asked to edit it.)`;
      }
    }
  }

  const abortSignal = req.signal;
  const deltas = await streamGeminiText({
    model: glyph.model,
    systemInstruction,
    contents,
    temperature: glyph.temperature,
    maxOutputTokens: glyph.maxOutputTokens,
    abortSignal,
    safetySettings: getSafetySettings(body.safetyPreset ?? "none"),
  });

  let fullText = "";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of deltas) {
          if (!delta) continue;
          fullText += delta;
          controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        if (!abortSignal.aborted) controller.error(err);
      } finally {
        try {
          const trimmed = fullText.trim();
          if (trimmed) {
            const modelMsg = await prisma.chatMessage.create({
              data: {
                chatId: chat.id,
                role: "model",
                content: fullText,
                parentMessageId: targetUser.id,
              },
              select: { id: true },
            });

            const choices = parseBranchChoices(chat.branchChoicesJson ?? "{}");
            choices[targetUser.id] = modelMsg.id;
            const fresh = (await prisma.chatMessage.findMany({
              where: { chatId: chat.id },
              select: {
                id: true,
                role: true,
                content: true,
                createdAt: true,
                parentMessageId: true,
              },
            })) as BranchMessage[];
            const kids = childrenByParent(fresh);
            const newTip = extendTipFromModel(
              modelMsg.id,
              kids,
              choices
            );

            await prisma.chat.update({
              where: { id: chat.id },
              data: {
                activeTipMessageId: newTip,
                branchChoicesJson: serializeBranchChoices(choices),
              },
            });
          }
        } catch {
          // ignore persistence errors
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
