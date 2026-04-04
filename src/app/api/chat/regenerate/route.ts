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
import { runAgentLoop } from "@/lib/agentLoop";
import { buildToolCatalogSummary } from "@/lib/agentTools";
import type { ChatMode, NdjsonEvent } from "@/lib/streamTypes";

export const dynamic = "force-dynamic";

type RegenerateInput = {
  chatId: string;
  activeTimelineEventId?: string | null;
  safetyPreset?: SafetyPreset;
  enableReasoning?: boolean;
  mode?: ChatMode;
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as RegenerateInput | null;
  if (!body) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.chatId || typeof body.chatId !== "string") {
    return Response.json({ error: "Missing 'chatId'." }, { status: 400 });
  }

  const scope = await findChatScope(body.chatId);

  if (!scope) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  const { chat, projectId } = scope;

  if (!chat.activeTipMessageId) {
    return Response.json({ error: "No active thread tip." }, { status: 400 });
  }

  const glyph = await getGlyph(chat.glyphId);
  if (!glyph) {
    return Response.json({ error: "Glyph missing." }, { status: 500 });
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
    return Response.json({ error: "No user message found." }, { status: 400 });
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

  const enableReasoning = body.enableReasoning === true;
  const mode: ChatMode = body.mode ?? "ask";
  const provider = (glyph as any).provider ?? "gemini";

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

  const encoder = new TextEncoder();

  // Mode-specific system prompt augmentation
  if (mode === "agent") {
    systemInstruction += `\n\n---\n[AGENT MODE]\nYou are an autonomous agent with access to project tools. Actively use tools to accomplish the user's request — search, read, create, and modify project entities as needed. If a search returns few results, try broader queries or different keywords. Do NOT stop after a single search; explore further until you have enough context to respond fully. Always prefer using tools over guessing.`;
  } else if (mode === "plan") {
    const catalog = buildToolCatalogSummary();
    systemInstruction += `\n\n---\n[PLAN MODE]\nYou MUST respond by calling the propose_plan tool with a structured plan. Do NOT respond with plain text — always use the propose_plan tool.\n\nHere are the tools you can include in your plan:\n${catalog}\n\nEach step in your plan should specify which tool to use, with what arguments, and a brief rationale. Order the steps logically. The user will review and approve the plan before any actions are executed.`;
  }

  if (mode === "agent" || mode === "plan") {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          encoder.encode(JSON.stringify({ __meta: true, tokenBudget, mode }) + "\n")
        );

        const loopResult = await runAgentLoop(
          {
            provider,
            model: glyph.model,
            systemInstruction,
            messages: flatMessages,
            temperature: glyph.temperature,
            maxOutputTokens: glyph.maxOutputTokens,
            abortSignal,
            safetyPreset: body.safetyPreset ?? "none",
            enableReasoning,
            mode,
            glyphId: chat.glyphId,
            toolContext: {
              projectId,
              timelineId: chat.timelineId ?? null,
              documentId: chat.documentId ?? null,
            },
          },
          (event: NdjsonEvent) => {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          }
        );

        try {
          const trimmed = loopResult.content.trim();
          if (trimmed || loopResult.toolCalls.length > 0 || loopResult.errors.length > 0) {
            const modelMsg: FsChatMessage = {
              id: generateId(),
              chatId: chat.id,
              role: "model",
              content: loopResult.content,
              ...(loopResult.reasoningContent.trim()
                ? { reasoningContent: loopResult.reasoningContent }
                : {}),
              ...(loopResult.toolCalls.length > 0
                ? { toolCalls: loopResult.toolCalls }
                : {}),
              ...(loopResult.errors.length > 0
                ? { errors: loopResult.errors }
                : {}),
              parentMessageId: targetUser.id,
              createdAt: new Date().toISOString(),
            };

            chat.messages.push(modelMsg);
            const choices = parseBranchChoices(chat.branchChoicesJson ?? "{}");
            choices[targetUser.id] = modelMsg.id;
            const fresh = chat.messages as BranchMessage[];
            const kids = childrenByParent(fresh);
            const newTip = extendTipFromModel(modelMsg.id, kids, choices);

            chat.activeTipMessageId = newTip;
            chat.branchChoicesJson = serializeBranchChoices(choices);
            chat.updatedAt = new Date().toISOString();
            await writeChat(projectId, chat);
          }
        } catch { /* ignore persistence errors */ }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  // Ask mode
  let fullContent = "";
  let fullReasoning = "";

  const deltas = await streamModel({
    provider,
    model: glyph.model,
    systemInstruction,
    messages: flatMessages,
    temperature: glyph.temperature,
    maxOutputTokens: glyph.maxOutputTokens,
    abortSignal,
    safetyPreset: body.safetyPreset ?? "none",
    enableReasoning,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          JSON.stringify({ __meta: true, tokenBudget, mode }) + "\n"
        )
      );
      try {
        for await (const chunk of deltas) {
          if (!chunk?.text) continue;
          if (chunk.channel === "reasoning") {
            fullReasoning += chunk.text;
            controller.enqueue(
              encoder.encode(JSON.stringify({ t: "r", d: chunk.text }) + "\n")
            );
          } else {
            fullContent += chunk.text;
            controller.enqueue(
              encoder.encode(JSON.stringify({ t: "c", d: chunk.text }) + "\n")
            );
          }
        }
      } catch (err) {
        if (!abortSignal.aborted) controller.error(err);
      } finally {
        try {
          const trimmed = fullContent.trim();
          if (trimmed) {
            const modelMsg: FsChatMessage = {
              id: generateId(),
              chatId: chat.id,
              role: "model",
              content: fullContent,
              ...(fullReasoning.trim()
                ? { reasoningContent: fullReasoning }
                : {}),
              parentMessageId: targetUser.id,
              createdAt: new Date().toISOString(),
            };

            chat.messages.push(modelMsg);

            const all = chat.messages as BranchMessage[];
            const choices = parseBranchChoices(chat.branchChoicesJson ?? "{}");
            choices[targetUser.id] = modelMsg.id;
            const kids = childrenByParent(all);
            const newTip = extendTipFromModel(modelMsg.id, kids, choices);

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
