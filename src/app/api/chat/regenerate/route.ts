import {
  chainFromTip,
  childrenByParent,
  extendTipFromModel,
  messagesById,
  parseBranchChoices,
  serializeBranchChoices,
  type BranchMessage,
} from "@/lib/messageBranch";
import { type SafetyPreset } from "@/lib/gemini";
import { streamModel } from "@/lib/providers";
import {
  buildTimelineDagRagFragment,
  resolveChatProjectContext,
} from "@/lib/timelineDagContext";
import { retrieveSimilar } from "@/lib/embeddings";
import { windowDraftContent } from "@/lib/draftWindowing";
import { findChatScope } from "../../chats/scope";
import { getGlyph, writeChat, generateId, type FsChatMessage } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

type RegenerateInput = {
  chatId: string;
  activeTimelineEventId?: string | null;
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

  const scope = await findChatScope(body.chatId);

  if (!scope) {
    return new Response(JSON.stringify({ error: "Chat not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { chat, projectId } = scope;

  if (!chat.activeTipMessageId) {
    return new Response(JSON.stringify({ error: "No active thread tip." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const glyph = await getGlyph(chat.glyphId);
  if (!glyph) {
    return new Response(JSON.stringify({ error: "Glyph missing." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const all = chat.messages as BranchMessage[];
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
  let wikiChars = 0;
  let dagChars = 0;
  let draftChars = 0;

  const { project, document } = await resolveChatProjectContext({
    documentId: chat.documentId,
    timelineId: chat.timelineId,
  });

  if (project) {
    const p = project;

    if (p.loreBible) {
      systemInstruction += `\n\n---\nCORE CANON / METAPHYSICS (ALWAYS ON):\n${p.loreBible}`;
    }
    if (p.storyOutline) {
      systemInstruction += `\n\n---\nSTORY OUTLINE:\n${p.storyOutline}`;
    }

    if (body.activeTimelineEventId) {
      const dagFragment = await buildTimelineDagRagFragment(
        body.activeTimelineEventId
      );
      dagChars = dagFragment.length;
      ragContextText += dagFragment;
    }

    const recentUserText = promptChain
      .slice(-3)
      .map((m) => m.content)
      .join("\n")
      .toLowerCase();
    const draftText = document?.content
      ? document.content.slice(-4000).toLowerCase()
      : "";
    const searchCorpus = recentUserText + "\n" + draftText;

    const keywordMatched = new Set<string>();
    const matchedWikis = p.wikiEntries.filter((w) => {
      const title = w.title.toLowerCase();
      const aliases = w.aliases
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (searchCorpus.includes(title)) { keywordMatched.add(w.id); return true; }
      for (const a of aliases) {
        if (searchCorpus.includes(a)) { keywordMatched.add(w.id); return true; }
      }
      return false;
    });

    try {
      const embeddingQuery = promptChain.slice(-2).map((m) => m.content).join("\n");
      const similar = await retrieveSimilar(p.id, embeddingQuery, 6);
      for (const hit of similar) {
        if (hit.type === "wiki" && !keywordMatched.has(hit.id)) {
          const entry = p.wikiEntries.find((w) => w.id === hit.id);
          if (entry) matchedWikis.push(entry);
        }
      }
    } catch { /* embedding retrieval is optional */ }

    if (matchedWikis.length > 0) {
      const wikiStart = ragContextText.length;
      ragContextText += `[RETRIEVED WIKI ENTRIES (For Context)]\n`;
      for (const entry of matchedWikis) {
        ragContextText += `### ${entry.title}\n${entry.content}\n\n`;
      }
      wikiChars = ragContextText.length - wikiStart;
    }

    if (document?.content) {
      const { text: windowedDraft, isWindowed } = windowDraftContent(
        document.content
      );
      const label = isWindowed
        ? `\n[CURRENT CHAPTER DRAFT (windowed — cursor region highlighted)]\n`
        : `\n[CURRENT CHAPTER DRAFT]\n`;
      const draftSection = `${label}${windowedDraft}\n\n(Note: The above is the current state of the chapter. Do not repeat it verbatim unless rewriting. Use it to inform your continuation.)\n`;
      draftChars = draftSection.length;
      ragContextText += draftSection;
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
  const flatMessages = contents.map((c) => ({
    role: c.role as "user" | "model",
    content: c.parts.map((p: any) => p.text ?? "").join(""),
  }));

  const deltas = await streamModel({
    provider: (glyph as any).provider ?? "gemini",
    model: glyph.model,
    systemInstruction,
    messages: flatMessages,
    temperature: glyph.temperature,
    maxOutputTokens: glyph.maxOutputTokens,
    abortSignal,
    safetyPreset: body.safetyPreset ?? "none",
  });

  const tokenBudget = {
    canon: Math.ceil(systemInstruction.length / 3.5),
    wiki: Math.ceil(wikiChars / 3.5),
    dag: Math.ceil(dagChars / 3.5),
    draft: Math.ceil(draftChars / 3.5),
    history: Math.ceil(
      flatMessages.reduce((sum, m) => sum + m.content.length, 0) / 3.5
    ),
    total: 0,
  };
  tokenBudget.total =
    tokenBudget.canon + tokenBudget.wiki + tokenBudget.dag +
    tokenBudget.draft + tokenBudget.history;

  let fullText = "";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          JSON.stringify({ __meta: true, tokenBudget }) + "\n"
        )
      );
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
            const modelMsg: FsChatMessage = {
              id: generateId(),
              chatId: chat.id,
              role: "model",
              content: fullText,
              parentMessageId: targetUser.id,
              createdAt: new Date().toISOString(),
            };

            chat.messages.push(modelMsg);

            const choices = parseBranchChoices(chat.branchChoicesJson ?? "{}");
            choices[targetUser.id] = modelMsg.id;
            
            const fresh = chat.messages as BranchMessage[];
            const kids = childrenByParent(fresh);
            const newTip = extendTipFromModel(
              modelMsg.id,
              kids,
              choices
            );

            chat.activeTipMessageId = newTip;
            chat.branchChoicesJson = serializeBranchChoices(choices);
            chat.updatedAt = new Date().toISOString();

            await writeChat(projectId, chat);
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
