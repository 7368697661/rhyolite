import { prisma } from "@/lib/prisma";
import {
  extendTipFromModel,
  childrenByParent,
  parseBranchChoices,
  serializeBranchChoices,
  type BranchMessage,
} from "@/lib/messageBranch";
import { backfillLinearMessageParentsIfNeeded } from "@/lib/chatBackfill";
import { getSafetySettings, streamGeminiText, type SafetyPreset } from "@/lib/gemini";

export const dynamic = "force-dynamic";

type ChatMessageInput = {
  chatId?: string;
  message: string;
  glyphId?: string;
  documentId?: string | null;
  safetyPreset?: SafetyPreset;
  /** Model message id this user message continues from (active branch). Omit for first message in chat. */
  continuedFromModelMessageId?: string | null;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    base64?: string;
    text?: string;
  }>;
};

async function chainToRoot(chatId: string, messageId: string) {
  const all = await prisma.chatMessage.findMany({
    where: { chatId },
    select: {
      id: true,
      role: true,
      content: true,
      parentMessageId: true,
    },
  });
  const byId = new Map(all.map((m) => [m.id, m]));
  const chain: Array<{
    id: string;
    role: "user" | "model";
    content: string;
    parentMessageId: string | null;
  }> = [];
  let cur: string | null = messageId;
  while (cur) {
    const msg = byId.get(cur);
    if (!msg) break;
    chain.push({
      id: msg.id,
      role: msg.role as "user" | "model",
      content: msg.content,
      parentMessageId: msg.parentMessageId,
    });
    cur = msg.parentMessageId;
  }
  return chain.reverse();
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatMessageInput;
  if (!body?.message || typeof body.message !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'message'." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const attachmentLabel =
    attachments.length > 0
      ? `\n\n[Attachments: ${attachments.map((a) => a.filename).join(", ")}]`
      : "";

  let chatId = body.chatId;
  let glyphId: string;

  if (chatId) {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, glyphId: true },
    });
    if (!chat) {
      return new Response(JSON.stringify({ error: "Chat not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    glyphId = chat.glyphId;
  } else {
    if (!body.glyphId) {
      return new Response(
        JSON.stringify({
          error: "Creating a new chat requires 'glyphId'.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const title = body.message.trim().slice(0, 60) || "New chat";
    const chat = await prisma.chat.create({
      data: {
        title,
        glyphId: body.glyphId,
        documentId: body.documentId,
      },
      select: { id: true, glyphId: true },
    });
    chatId = chat.id;
    glyphId = chat.glyphId;
  }

  await backfillLinearMessageParentsIfNeeded(chatId!);

  const chatRow = await prisma.chat.findUnique({
    where: { id: chatId! },
    select: {
      activeTipMessageId: true,
      branchChoicesJson: true,
      documentId: true,
    },
  });

  let parentForUser: string | null = null;

  if (
    body.continuedFromModelMessageId &&
    typeof body.continuedFromModelMessageId === "string"
  ) {
    const cont = await prisma.chatMessage.findFirst({
      where: {
        id: body.continuedFromModelMessageId,
        chatId: chatId!,
        role: "model",
      },
    });
    if (!cont) {
      return new Response(
        JSON.stringify({ error: "Invalid continuedFromModelMessageId." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    parentForUser = cont.id;
  } else if (chatRow?.activeTipMessageId) {
    const tip = await prisma.chatMessage.findUnique({
      where: { id: chatRow.activeTipMessageId },
    });
    if (tip?.role === "model") {
      parentForUser = tip.id;
    } else if (tip?.role === "user") {
      const models = await prisma.chatMessage.findMany({
        where: {
          chatId: chatId!,
          parentMessageId: tip.id,
          role: "model",
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      parentForUser = models[0]?.id ?? null;
    }
  }

  const userMsg = await prisma.chatMessage.create({
    data: {
      chatId: chatId!,
      role: "user",
      content: `${body.message}${attachmentLabel}`,
      parentMessageId: parentForUser,
    },
    select: { id: true },
  });

  const glyph = await prisma.glyph.findUnique({
    where: { id: glyphId },
  });
  if (!glyph) {
    return new Response(JSON.stringify({ error: "Glyph not found." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const chainToRootList = await chainToRoot(chatId!, userMsg.id);
  
  let systemInstruction = glyph.systemInstruction;
  let ragContextText = "";

  if (chatRow?.documentId) {
    const document = await prisma.document.findUnique({
      where: { id: chatRow.documentId },
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
      const recentUserText = chainToRootList.slice(-3).map(m => m.content).join("\n").toLowerCase();
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

  const attachmentParts: Array<{
    text?: string;
    inlineData?: { data: string; mimeType: string };
  }> = attachments.reduce((acc, a) => {
    if (a.mimeType.startsWith("image/") && a.base64) {
      acc.push({
        inlineData: { data: a.base64, mimeType: a.mimeType },
      });
      return acc;
    }
    if (typeof a.text === "string" && a.text.trim().length > 0) {
      acc.push({ text: `\n[File: ${a.filename}]\n${a.text}` });
      return acc;
    }
    return acc;
  }, [] as Array<{ text?: string; inlineData?: { data: string; mimeType: string } }>);

  const contents = chainToRootList.map((m, idx) => {
    const isLatestUser =
      idx === chainToRootList.length - 1 && m.role === "user";
    
    let text = m.content;
    
    // Inject the RAG + Draft context ONLY into the final user message to save systemInstruction bloat
    if (isLatestUser && ragContextText) {
      text = `${ragContextText}\n---\n[NEW USER MESSAGE]\n${text}`;
    }

    if (!isLatestUser || attachmentParts.length === 0) {
      return {
        role: m.role,
        parts: [{ text }],
      };
    }
    return {
      role: m.role,
      parts: [{ text }, ...attachmentParts],
    };
  });

  const encoder = new TextEncoder();
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of deltas) {
          if (!delta) continue;
          fullText += delta;
          controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        if (!abortSignal.aborted) {
          controller.error(err);
        }
      } finally {
        try {
          const trimmed = fullText.trim();
          if (trimmed) {
            const modelMsg = await prisma.chatMessage.create({
              data: {
                chatId: chatId!,
                role: "model",
                content: fullText,
                parentMessageId: userMsg.id,
              },
              select: { id: true },
            });

            const all = (await prisma.chatMessage.findMany({
              where: { chatId: chatId! },
              select: {
                id: true,
                role: true,
                content: true,
                createdAt: true,
                parentMessageId: true,
              },
            })) as BranchMessage[];

            const choices = parseBranchChoices(
              chatRow?.branchChoicesJson ?? "{}"
            );
            choices[userMsg.id] = modelMsg.id;
            const kids = childrenByParent(all);
            const newTip = extendTipFromModel(modelMsg.id, kids, choices);

            await prisma.chat.update({
              where: { id: chatId! },
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
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
