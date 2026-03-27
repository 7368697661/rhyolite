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

  let systemInstruction = glyph.systemInstruction;
  let ragContextText = "";

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

      if (p.loreBible) {
        systemInstruction += `\n\n---\nCORE CANON / METAPHYSICS (ALWAYS ON):\n${p.loreBible}`;
      }
      if (p.storyOutline) {
        systemInstruction += `\n\n---\nSTORY OUTLINE:\n${p.storyOutline}`;
      }

      // Keyword-based Wiki RAG
      const recentUserText = promptChain.slice(-3).map(m => m.content).join("\n").toLowerCase();
      const draftText = document.content ? document.content.slice(-4000).toLowerCase() : "";
      const searchCorpus = recentUserText + "\n" + draftText;

      const matchedWikis = p.wikiEntries.filter(w => {
        const title = w.title.toLowerCase();
        const aliases = w.aliases.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
        if (searchCorpus.includes(title)) return true;
        for (const a of aliases) {
          if (searchCorpus.includes(a)) return true;
        }
        return false;
      });

      if (matchedWikis.length > 0) {
        ragContextText += `[RETRIEVED WIKI ENTRIES (For Context)]\n`;
        for (const entry of matchedWikis) {
          ragContextText += `### ${entry.title}\n${entry.content}\n\n`;
        }
      }

      if (document.content) {
        ragContextText += `\n[CURRENT CHAPTER DRAFT]\n${document.content}\n\n(Note: The above is the current state of the chapter. Do not repeat it verbatim unless rewriting. Use it to inform your continuation.)\n`;
      }
    }
  }

  const contents = promptChain.map((m, idx) => {
    const isLatestUser = idx === promptChain.length - 1 && m.role === "user";
    let text = m.content;

    if (isLatestUser && ragContextText) {
      text = `${ragContextText}\n---\n[NEW USER MESSAGE]\n${text}`;
    }

    return {
      role: m.role as "user" | "model",
      parts: [{ text }],
    };
  });

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
