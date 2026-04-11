/**
 * Multi-turn agent loop with tool execution, NDJSON streaming,
 * risky-action confirmation, and error handling.
 *
 * This module is called from the chat API routes when mode is "agent" or "plan".
 * It replaces the single-pass streamModel call with an iterative loop that can
 * invoke tools and feed results back to the model.
 */

import { GoogleGenAI, type SafetySetting } from "@google/genai";
import { getSafetySettings, type SafetyPreset } from "./gemini";
import {
  ALL_TOOLS,
  TOOL_MAP,
  PROPOSE_PLAN_TOOL,
  toGeminiFunctionDeclarations,
  buildToolCatalogSummary,
  type AgentTool,
  type ToolContext,
  type ToolResult,
} from "./agentTools";
import type { ChatMode, NdjsonEvent } from "./streamTypes";
import { invoke } from "@tauri-apps/api/core";
import { generateId, getGlyph, readGlyphs, type FsGlyph } from "./fs-db";
import { assembleContext } from "./chatContext";
import { chainFromTip, messagesById, type BranchMessage } from "./messageBranch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

async function getApiKey(): Promise<string> {
    const key = await invoke<string | null>('get_config', { key: "GEMINI_API_KEY" });
    if (!key) throw new Error("Missing GEMINI_API_KEY. Set it in configuration.");
    return key;
}

export interface AgentLoopParams {
  provider: "gemini" | "openai" | "anthropic";
  model: string;
  systemInstruction?: string;
  messages?: Array<{ role: "user" | "model" | "assistant"; content: string }>;
  branchMessages?: BranchMessage[];
  tipId?: string;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  safetyPreset?: SafetyPreset;
  enableReasoning?: boolean;
  mode: ChatMode;
  toolContext: ToolContext;
  cursorPosition?: number;
  activeTimelineEventId?: string;
  /** ID of the glyph running this session (to prevent self-delegation). */
  glyphId?: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  ok: boolean;
  confirmed?: boolean;
}

export interface AgentLoopResult {
  content: string;
  reasoningContent: string;
  toolCalls: ToolCallRecord[];
  errors: Array<{ code: string; message: string }>;
}

type EmitFn = (event: NdjsonEvent) => void;

// ---------------------------------------------------------------------------
// Pending confirmation state (in-memory, per-loop)
// ---------------------------------------------------------------------------

interface PendingConfirmation {
  resolve: (approved: boolean) => void;
  loopId: string;
  tool: AgentTool;
  args: Record<string, unknown>;
  ctx: ToolContext;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();

export function resolveConfirmation(loopId: string, approved: boolean): boolean {
  const pending = pendingConfirmations.get(loopId);
  if (!pending) return false;
  pending.resolve(approved);
  pendingConfirmations.delete(loopId);
  return true;
}

// ---------------------------------------------------------------------------
// Robust delta extraction for Gemini streaming
// ---------------------------------------------------------------------------

/**
 * The Gemini SDK is inconsistent: sometimes `chunk.text` / `part.text`
 * is the **full cumulative** text so far, sometimes it is only the new
 * **delta**.  This helper handles both cases safely — matching the logic
 * from the original working reference codebase.
 */
function extractDelta(raw: string, accumulated: string): string {
  if (!raw) return "";
  if (accumulated && raw.startsWith(accumulated)) {
    return raw.slice(accumulated.length);
  }
  if (!accumulated) {
    return raw;
  }
  if (raw.includes(accumulated)) {
    return raw.slice(accumulated.length);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Specialist delegation helpers
// ---------------------------------------------------------------------------

async function validateSpecialist(
  glyphId: string,
  activeGlyphId?: string
): Promise<{ ok: true; glyph: FsGlyph } | { ok: false; error: string }> {
  const glyph = await getGlyph(glyphId);
  if (!glyph) return { ok: false, error: `Specialist glyph not found: ${glyphId}` };
  if (glyph.isSculpter !== false) {
    return { ok: false, error: `Glyph "${glyph.name}" is a Sculptor, not a chisel. Delegation must target a chisel.` };
  }
  if (glyphId === activeGlyphId) {
    return { ok: false, error: "Cannot delegate to the same glyph running the current session." };
  }
  return { ok: true, glyph };
}

/** Tool names allowed per specialist role in the write pipeline. */
const READ_ONLY_TOOLS = new Set([
  "search_artifacts", "read_artifact", "read_draft", "search_project",
  "read_timeline", "resolve_dead_links",
]);
const WRITER_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  "write_draft", "append_to_draft", "replace_in_draft",
  "create_document",
]);
const AUDITOR_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  "replace_in_draft", "read_draft",
]);

function toolsForRole(role?: string): AgentTool[] | null {
  const DELEGATION = new Set(["delegate_to_specialist", "delegate_fan_out"]);
  if (role === "researcher") return ALL_TOOLS.filter(t => READ_ONLY_TOOLS.has(t.schema.name));
  if (role === "writer")     return ALL_TOOLS.filter(t => WRITER_TOOLS.has(t.schema.name));
  if (role === "auditor")    return ALL_TOOLS.filter(t => AUDITOR_TOOLS.has(t.schema.name));
  // Default: all tools minus delegation (original behavior)
  return ALL_TOOLS.filter(t => !DELEGATION.has(t.schema.name));
}

interface SpecialistResult {
  summary: string;
  toolCallNames: string[];
}

async function runSpecialistInnerLoop(
  glyph: FsGlyph,
  task: string,
  toolContext: ToolContext,
  emit: EmitFn,
  abortSignal?: AbortSignal,
  toolOverride?: AgentTool[]
): Promise<SpecialistResult> {
  emit({ t: "sub", d: { phase: "start", glyphId: glyph.id, glyphName: glyph.name } });

  const innerResult: AgentLoopResult = {
    content: "",
    reasoningContent: "",
    toolCalls: [],
    errors: [],
  };

  const innerEmit: EmitFn = (event) => {
    if (event.t === "c") {
      innerResult.content += event.d;
      emit({ t: "sub", d: { phase: "delta", glyphId: glyph.id, glyphName: glyph.name, text: event.d } });
    } else if (event.t === "s") {
      emit({ t: "sub", d: { phase: "delta", glyphId: glyph.id, glyphName: glyph.name, text: `[${event.d}]\n` } });
    }
    // Risky tool confirmations and errors from inner loops still bubble up
    if (event.t === "confirm" || event.t === "e") emit(event);
  };

  const innerTools = toolOverride ?? ALL_TOOLS.filter(
    (t) => t.schema.name !== "delegate_to_specialist" && t.schema.name !== "delegate_fan_out"
  );

  // Glyphs saved via the UI do not persist a `provider` field (the Rust
  // FsGlyph struct only stores `role`, `model`, etc.), so anything missing
  // should be treated as Gemini — matching Chat.svelte's sculptor fallback.
  // Similarly, `systemInstruction` is absent for UI-created glyphs; the real
  // system prompt lives in `glyph.role`.
  const effectiveProvider = (glyph.provider || "gemini") as "gemini" | "openai" | "anthropic";
  const effectiveSystemInstruction = glyph.systemInstruction || glyph.role || "";

  if (effectiveProvider === "gemini") {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const safetySettings = getSafetySettings("none");
    const functionDeclarations = toGeminiFunctionDeclarations(innerTools);

    type ContentPart = Record<string, unknown>;
    type Content = { role: "user" | "model"; parts: ContentPart[] };

    const contents: Content[] = [
      { role: "user", parts: [{ text: task }] },
    ];

    for (let iteration = 0; iteration < MAX_INNER_ITERATIONS; iteration++) {
      if (abortSignal?.aborted) break;

      let stream;
      try {
        stream = await ai.models.generateContentStream({
          model: glyph.model,
          contents,
          config: {
            systemInstruction: effectiveSystemInstruction,
            temperature: glyph.temperature,
            maxOutputTokens: glyph.maxOutputTokens,
            abortSignal,
            safetySettings,
            tools: [{ functionDeclarations }],
          },
        });
      } catch (err: any) {
        const msg = (err?.message ?? String(err)).slice(0, 300);
        innerEmit({ t: "e", d: { code: "provider_error", message: `Specialist ${glyph.name}: ${msg}` } });
        break;
      }

      let textAccumulated = "";
      const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
      const rawModelParts: ContentPart[] = [];

      try {
        for await (const chunk of stream) {
          if (abortSignal?.aborted) break;
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            rawModelParts.push(part as ContentPart);
            if (part.functionCall) {
              functionCalls.push({
                name: part.functionCall.name ?? "",
                args: (part.functionCall.args as Record<string, unknown>) ?? {},
              });
            } else if (typeof part.text === "string" && !part.thought) {
              const delta = extractDelta(part.text, textAccumulated);
              if (delta) {
                textAccumulated += delta;
                innerEmit({ t: "c", d: delta });
              }
            }
          }
          if (parts.length === 0) {
            const t = chunk.text ?? "";
            if (t) {
              const delta = extractDelta(t, textAccumulated);
              if (delta) {
                textAccumulated += delta;
                innerEmit({ t: "c", d: delta });
              }
            }
          }
        }
      } catch {
        break;
      }

      if (functionCalls.length === 0) break;

      contents.push({ role: "model", parts: rawModelParts });

      const responseParts: ContentPart[] = [];
      for (const fc of functionCalls) {
        const tool = TOOL_MAP.get(fc.name);
        if (!tool || fc.name === "delegate_to_specialist" || fc.name === "delegate_fan_out") {
          responseParts.push({ functionResponse: { name: fc.name, response: wrapForGeminiFunctionResponse({ error: "Tool not available to specialists" }) } });
          continue;
        }

        if (tool.riskLevel === "risky") {
          const loopId = generateId();
          emit({ t: "confirm", d: { loopId, name: fc.name, args: fc.args, reason: `Specialist "${glyph.name}" wants to run ${fc.name} (destructive).` } });
          const approved = await new Promise<boolean>((resolve) => {
            pendingConfirmations.set(loopId, { resolve, loopId, tool, args: fc.args, ctx: toolContext });
            setTimeout(() => { if (pendingConfirmations.has(loopId)) { pendingConfirmations.delete(loopId); resolve(false); } }, 5 * 60 * 1000);
          });
          if (!approved) {
            responseParts.push({ functionResponse: { name: fc.name, response: wrapForGeminiFunctionResponse({ rejected: true }) } });
            continue;
          }
        }

        innerEmit({ t: "s", d: `${glyph.name}: ${fc.name}...` });
        let toolResult: { ok: boolean; data?: unknown; error?: string };
        try {
          toolResult = await tool.execute(fc.args, toolContext);
        } catch (err: any) {
          toolResult = { ok: false, error: (err?.message ?? String(err)).slice(0, 500) };
        }
        const fullInnerResult = toolResult.ok ? toolResult.data : { error: toolResult.error };
        responseParts.push({
          functionResponse: { name: fc.name, response: wrapForGeminiFunctionResponse(truncateForContext(fullInnerResult)) },
        });
        innerResult.toolCalls.push({ name: fc.name, args: fc.args, result: fullInnerResult, ok: toolResult.ok });
      }
      contents.push({ role: "user", parts: responseParts });
    }
  } else {
    // Non-Gemini specialist: single-pass generation (no native tool calling).
    // Note: if you reach this branch with a chisel that's supposed to use
    // draft-writing tools, the chisel won't actually call them — rely on the
    // auto-persist path in runChiselPipeline for the writer's output.
    const { streamModel } = await import("./providers");
    const deltas = await streamModel({
      provider: effectiveProvider,
      model: glyph.model,
      systemInstruction: effectiveSystemInstruction,
      messages: [{ role: "user", content: task }],
      temperature: glyph.temperature,
      maxOutputTokens: glyph.maxOutputTokens,
      abortSignal,
    });
    try {
      for await (const chunk of deltas) {
        if (chunk?.text && chunk.channel !== "reasoning") {
          innerResult.content += chunk.text;
          innerEmit({ t: "c", d: chunk.text });
        }
      }
    } catch {
      /* best effort */
    }
  }

  const summary = innerResult.content || "(specialist returned no output)";
  emit({ t: "sub", d: { phase: "end", glyphId: glyph.id, glyphName: glyph.name, text: `Completed. ${innerResult.toolCalls.length} tool calls.` } });
  return { summary, toolCallNames: innerResult.toolCalls.map(tc => tc.name) };
}

// ---------------------------------------------------------------------------
// Main agent loop (Gemini-first, with fallback for other providers)
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 30;
const MAX_INNER_ITERATIONS = 12;

/** Max chars for a single tool result fed back into the model context. */
const MAX_TOOL_RESULT_CHARS = 100000;

/**
 * Truncate a tool result to prevent context overflow when feeding it
 * back to the model. The full result is still emitted to the UI and
 * saved in the chat history — this only affects what the model sees.
 */
function truncateForContext(result: unknown): unknown {
  const json = JSON.stringify(result);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return result;

  if (Array.isArray(result)) {
    const truncated: unknown[] = [];
    let len = 2; // for []
    for (const item of result) {
      const itemJson = JSON.stringify(item);
      if (len + itemJson.length + 1 > MAX_TOOL_RESULT_CHARS - 80) {
        truncated.push({ _truncated: true, remaining: result.length - truncated.length, message: "Results truncated to fit context window" });
        break;
      }
      truncated.push(item);
      len += itemJson.length + 1;
    }
    return truncated;
  }

  if (typeof result === "object" && result !== null) {
    const str = JSON.stringify(result);
    if (str.length > MAX_TOOL_RESULT_CHARS) {
      return { _summary: str.slice(0, MAX_TOOL_RESULT_CHARS - 100), _truncated: true };
    }
  }

  return result;
}

/**
 * Gemini's functionResponse.response must be a JSON object (Struct),
 * never a bare array or primitive. Wrap non-object values accordingly.
 */
function wrapForGeminiFunctionResponse(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { results: value };
  if (value === null || value === undefined) return { result: null };
  if (typeof value !== "object") return { result: value };
  return value as Record<string, unknown>;
}

/**
 * Strip markdown code-block fences and JSON wrappers that models emit when
 * they can't call tools and try to simulate the call as text.
 */
function stripCodeBlockWrappers(text: string): string {
  let cleaned = text.trim();
  // Remove ```json ... ``` or ```markdown ... ``` or ``` ... ``` wrappers
  const fenceRe = /^```(?:json|markdown|text|plaintext)?\s*\n?([\s\S]*?)\n?\s*```$/;
  const m = cleaned.match(fenceRe);
  if (m) cleaned = m[1].trim();
  // If the model wrapped content in a JSON object like {"text": "..."}, extract it
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.text === "string") {
      cleaned = parsed.text;
    }
  } catch { /* not JSON, that's fine */ }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Shared pipeline runner (used by both research and write modes)
// ---------------------------------------------------------------------------

async function runChiselPipeline(
  pipelineTags: string[],
  params: AgentLoopParams,
  finalMessages: Array<{ role: string; content: string }>,
  emit: EmitFn,
  result: AgentLoopResult,
  label: string,
  useRoleTools = false
): Promise<{ cumulativeContext: string; writerRan: boolean }> {
  let cumulativeContext = "";
  let writerRan = false;
  const lastUserMsg = finalMessages[finalMessages.length - 1]?.content || "";
  // The full message may have RAG context prepended (wiki, draft, etc.).
  // Extract just the user's original request so downstream steps (writer,
  // auditor) aren't flooded with duplicate context that the researcher
  // already distilled for them.
  const ragSeparator = "\n---\n[NEW USER MESSAGE]\n";
  const sepIdx = lastUserMsg.indexOf(ragSeparator);
  const rawUserRequest = sepIdx !== -1 ? lastUserMsg.slice(sepIdx + ragSeparator.length) : lastUserMsg;
  const taskPromptFull = `Task: ${lastUserMsg}`;
  const taskPromptClean = `Task: ${rawUserRequest}`;

  const allGlyphs = await readGlyphs();
  const allChisels = allGlyphs.filter(g => !g.isSculpter && g.specialistRole);

  // Pre-fetch the active document ONCE. The writer needs to see existing
  // content to avoid clobbering it, and the auditor benefits from the same
  // context if it can't call read_draft (non-Gemini path). We read once at
  // the start rather than per-step because the pipeline stages may mutate
  // the draft — each stage reads fresh via its own tools when needed.
  let existingDraft = "";
  if (useRoleTools && params.toolContext.documentId && params.toolContext.projectId) {
    try {
      const { readDocument } = await import("./fs-db");
      const doc = await readDocument(params.toolContext.projectId, params.toolContext.documentId);
      if (doc?.content?.trim()) existingDraft = doc.content;
    } catch {
      /* best effort — if read fails, writer will operate without existing-draft context */
    }
  }

  for (let i = 0; i < pipelineTags.length; i++) {
    if (params.abortSignal?.aborted) break;

    const tag = pipelineTags[i];
    const chisel = allChisels.find(c => c.specialistRole === tag);
    if (!chisel) {
      emit({ t: "s", d: `[${label} PIPELINE] No chisel tagged '${tag}' found — skipping step ${i + 1}.` });
      continue;
    }

    // Role-specific instructions so each chisel stays in its lane.
    // The writer instruction adapts based on whether the chisel's provider
    // supports tool calling (Gemini) or not (everything else). UI-created
    // glyphs don't persist a `provider` field, so absence defaults to Gemini
    // — matching the fallback in runSpecialistInnerLoop.
    const canCallTools = (chisel.provider || "gemini") === "gemini";
    const WRITER_INSTRUCTION_TOOLS = "YOUR ROLE: WRITER. Using the research context provided, write the requested content. Call write_draft ONCE with the complete text. Do NOT call write_draft multiple times or loop — produce the full content in a single tool call. If the document already has content you are continuing from, first read_draft to see what exists, then use write_draft with the existing content plus your new content combined. Focus on prose quality, voice, and narrative flow. FORMATTING: Write plain prose paragraphs. Do NOT use markdown blockquote syntax (> lines) for narrative text. Only use > blockquotes for actual attributed quotes or epigraphs. Chapter body text should be plain paragraphs separated by blank lines — no markdown heading markers, no blockquote prefixes, no bullet lists unless the user specifically asks for them.";
    const WRITER_INSTRUCTION_NO_TOOLS = "YOUR ROLE: WRITER. Using the research context provided, write the requested content. Output ONLY the prose content — your entire response will be saved directly as the document body. Do NOT wrap your output in code blocks, JSON, markdown formatting, or any meta-commentary. Do NOT include tool call syntax, function names, or parameter labels. Just write the story/content directly as plain prose paragraphs separated by blank lines. Focus on prose quality, voice, and narrative flow. Do NOT use markdown blockquote syntax (> lines) for narrative text. Only use > blockquotes for actual attributed quotes or epigraphs. No markdown heading markers, no bullet lists unless the user specifically asks for them.";
    const ROLE_INSTRUCTIONS: Record<string, string> = {
      researcher: "YOUR ROLE: RESEARCHER. Gather relevant lore, context, and reference material using your search and read tools. Produce a concise brief of key facts, characters, locations, and plot points relevant to the task. Do NOT write prose, narrative, or chapter content — that is the writer's job.",
      writer: canCallTools ? WRITER_INSTRUCTION_TOOLS : WRITER_INSTRUCTION_NO_TOOLS,
      auditor: "YOUR ROLE: AUDITOR. First, read_draft to get the current document content. Then review it against the lore and context provided. Check for: factual consistency with lore, character voice accuracy, plot coherence, the user's specific instructions, and formatting issues (e.g. prose incorrectly wrapped in markdown blockquotes or other markup). If you find concrete issues, use replace_in_draft to fix them. Report a brief summary of what you checked and any changes made. Do NOT rewrite the entire draft — only fix specific issues.",
    };
    const roleInstruction = useRoleTools && ROLE_INSTRUCTIONS[tag] ? `\n\n${ROLE_INSTRUCTIONS[tag]}\n` : "";
    // Researcher gets the full RAG-augmented prompt so it can search/read
    // everything. Writer and auditor get only the clean user request — the
    // researcher's output (in cumulativeContext) already contains the
    // distilled lore/context they need, so feeding them raw RAG on top of
    // that causes duplication in the prose.
    const prompt = tag === "researcher" ? taskPromptFull : taskPromptClean;

    // For the writer, include the existing draft so it can decide whether to
    // continue, expand, or rewrite. Without this, a non-Gemini writer (or any
    // writer that doesn't call read_draft first) would blindly overwrite
    // existing content — nuking prior chapters when asked to "continue".
    const draftSection = (tag === "writer" && existingDraft)
      ? `\n\n[EXISTING DRAFT CONTENT]\n${existingDraft}\n[END EXISTING DRAFT]\n\nIMPORTANT: Your output will replace the entire document. If the user is asking you to continue, expand, or refine the existing content, include the parts you want to preserve verbatim in your output. If the user is asking for a fresh rewrite, ignore the existing content.`
      : "";
    const chiselTask = `[PIPELINE STEP ${i + 1}/${pipelineTags.length} - ${tag.toUpperCase()}]${roleInstruction}\n${prompt}${draftSection}\n\n[CONTEXT FROM PREVIOUS STEPS]\n${cumulativeContext}`;
    emit({ t: "s", d: `[${label} PIPELINE] Starting step ${i + 1}/${pipelineTags.length}: ${chisel.name} (${tag})` });

    const roleTools = useRoleTools ? (toolsForRole(tag) ?? undefined) : undefined;

    // Emit pipeline step info (overrides the generic "start" from runSpecialistInnerLoop)
    emit({ t: "sub", d: { phase: "start", glyphId: chisel.id, glyphName: chisel.name, step: i + 1, totalSteps: pipelineTags.length } });

    try {
      const { summary, toolCallNames } = await runSpecialistInnerLoop(chisel, chiselTask, params.toolContext, emit, params.abortSignal, roleTools);
      cumulativeContext += `\n\n--- OUTPUT FROM ${tag.toUpperCase()} ---\n${summary}`;

      if (useRoleTools && tag === "writer") {
        const wroteViaTool = toolCallNames.includes("write_draft") || toolCallNames.includes("append_to_draft");

        // If the writer produced content but never called write_draft (e.g. non-Gemini
        // provider with no tool-calling support, or the model simply didn't use the tool),
        // persist the output to the document automatically. The writer was given the
        // existing draft content as context and told its output will become the full
        // document, so overwriting is safe by design.
        if (
          !wroteViaTool &&
          summary.trim() &&
          params.toolContext.documentId
        ) {
          const cleanedText = stripCodeBlockWrappers(summary);
          if (cleanedText) {
            const writeTool = TOOL_MAP.get("write_draft");
            if (writeTool) {
              try {
                const writeResult = await writeTool.execute({ text: cleanedText }, params.toolContext);
                if (writeResult.ok) writerRan = true;
                else emit({ t: "s", d: `[${label} PIPELINE] Auto-persist failed: ${writeResult.error}` });
              } catch (writeErr: any) {
                emit({ t: "s", d: `[${label} PIPELINE] Auto-persist failed: ${writeErr.message}` });
              }
            }
          }
        } else if (wroteViaTool) {
          writerRan = true;
        }
      }

      const callId = generateId();
      emit({ t: "tc", d: { name: `pipeline_step_${tag}`, args: { task: "Auto-delegated pipeline step" }, callId } });
      emit({ t: "tr", d: { name: `pipeline_step_${tag}`, result: { summary }, ok: true, callId } });
      result.toolCalls.push({ name: `pipeline_step_${tag}`, args: { task: "Auto-delegated pipeline step" }, result: { summary }, ok: true });
    } catch (e: any) {
      emit({ t: "e", d: { code: "PIPELINE_ERR", message: `${label} pipeline step ${tag} failed: ${e.message}` } });
    }
  }

  return { cumulativeContext, writerRan };
}

function injectPipelineResults(
  finalMessages: Array<{ role: string; content: string }>,
  cumulativeContext: string,
  label: string
): void {
  if (!cumulativeContext || finalMessages.length === 0) return;
  const lastIdx = finalMessages.length - 1;
  if (finalMessages[lastIdx].role === "user") {
    finalMessages[lastIdx].content += `\n\n[${label} PIPELINE RESULTS]\nThe following context was generated autonomously by your specialist sub-agents. Use it to inform your final response:\n${cumulativeContext}`;
  }
}

export async function runAgentLoop(
  params: AgentLoopParams,
  emit: EmitFn
): Promise<AgentLoopResult> {
  const result: AgentLoopResult = {
    content: "",
    reasoningContent: "",
    toolCalls: [],
    errors: [],
  };

  let finalMessages: Array<{ role: "user" | "model" | "assistant"; content: string }> = [];
  let chainToRootList: any[] = [];
  
  if (params.branchMessages && params.tipId) {
    const byId = messagesById(params.branchMessages);
    chainToRootList = chainFromTip(params.tipId, byId);
    finalMessages = chainToRootList.map(m => ({
      role: m.role,
      content: m.content
    }));
  } else if (params.messages) {
    finalMessages = params.messages;
    chainToRootList = params.messages; // fallback for context assembly
  }

  // Assemble context
  const context = await assembleContext({
    projectId: params.toolContext.projectId,
    documentId: params.toolContext.documentId,
    timelineId: params.toolContext.timelineId,
    activeTimelineEventId: params.activeTimelineEventId,
    cursorPosition: params.cursorPosition,
    chainToRootList: chainToRootList as any,
  });

  const planModeAddition = params.mode === "plan"
    ? `[PLAN MODE] You must analyze the user's request and propose a structured plan using the propose_plan tool. Do NOT execute actions directly.\n\n${buildToolCatalogSummary()}`
    : "";

  const augmentedSystemInstruction = [
    params.systemInstruction || "",
    context.systemInstructionAdditions,
    planModeAddition,
  ].filter(Boolean).join("\n\n");

  // Prepend RAG context to the LAST user message (matching reference behavior).
  // This keeps wiki/DAG/draft context close to the user's question where models
  // weight it more heavily, rather than burying it in the system instruction.
  if (context.ragContextText && finalMessages.length > 0) {
    const lastIdx = finalMessages.length - 1;
    if (finalMessages[lastIdx].role === "user") {
      finalMessages = [...finalMessages];
      finalMessages[lastIdx] = {
        ...finalMessages[lastIdx],
        content: `${context.ragContextText}\n---\n[NEW USER MESSAGE]\n${finalMessages[lastIdx].content}`,
      };
    }
  }

  const historyChars = finalMessages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);

  emit({
    t: "ctx",
    d: {
      wikiChars: context.stats.wikiChars,
      dagChars: context.stats.dagChars,
      draftChars: context.stats.draftChars,
      systemChars: augmentedSystemInstruction.length,
      historyChars,
      ragChars: context.ragContextText.length,
    },
  });

  const effectiveParams = {
    ...params,
    messages: finalMessages,
    systemInstruction: augmentedSystemInstruction
  };

  let tools =
    effectiveParams.mode === "plan"
      ? [PROPOSE_PLAN_TOOL]
      : effectiveParams.mode === "ask"
      ? []
      : effectiveParams.mode === "research"
      ? [] // The main generation doesn't use tools directly, the pipeline does
      : ALL_TOOLS; // "agent" and "write" both get full tools

  // ---------------------------------------------------------------------------
  // Auto-delegation pipelines (run chisels BEFORE the final sculptor generation)
  // ---------------------------------------------------------------------------

  // Research mode: run the sculptor's custom pipeline (from glyph config)
  if (effectiveParams.mode === "research" && params.glyphId) {
    const activeGlyph = await getGlyph(params.glyphId);
    if (activeGlyph && activeGlyph.pipeline && activeGlyph.pipeline.length > 0) {
      const { cumulativeContext } = await runChiselPipeline(
        activeGlyph.pipeline, params, finalMessages, emit, result, "RESEARCH"
      );
      injectPipelineResults(finalMessages, cumulativeContext, "RESEARCH");
    } else {
        emit({ t: "s", d: `[RESEARCH PIPELINE] No pipeline defined for this Sculptor. Proceeding with standard generation.` });
    }
  }

  // Write mode: auto-discover researcher → writer → auditor chisels (no config needed)
  if (effectiveParams.mode === "write") {
    if (!params.glyphId) {
      emit({ t: "s", d: `[WRITE PIPELINE] No sculptor selected — falling back to standard generation.` });
    } else if (!params.toolContext.documentId) {
      emit({ t: "s", d: `[WRITE PIPELINE] No active document. Open or create a document before running Write mode — the writer and auditor need a draft target.` });
    } else {
      // Pre-flight: verify the required writer chisel exists. Without a writer,
      // running the pipeline would produce researcher brief + auditor commentary
      // but never actually change the document, then strip tools from the
      // sculptor — a silent failure. Fail fast with a clear error instead.
      const allGlyphs = await readGlyphs();
      const availableTags = new Set(
        allGlyphs.filter(g => !g.isSculpter && g.specialistRole).map(g => g.specialistRole!)
      );
      const WRITE_PIPELINE = ["researcher", "writer", "auditor"];
      const missingTags = WRITE_PIPELINE.filter(t => !availableTags.has(t));

      if (!availableTags.has("writer")) {
        emit({ t: "s", d: `[WRITE PIPELINE] Missing required 'writer' chisel. Create a Glyph in the Glyph Registry, uncheck "Sculptor", and set Chisel Tag to "writer". Falling back to standard generation.` });
      } else {
        if (missingTags.length > 0) {
          emit({ t: "s", d: `[WRITE PIPELINE] Optional chisel tags missing: ${missingTags.join(", ")}. Those stages will be skipped.` });
        }
        const { cumulativeContext, writerRan } = await runChiselPipeline(
          WRITE_PIPELINE, params, finalMessages, emit, result, "WRITE", true
        );

        if (!writerRan) {
          emit({ t: "s", d: `[WRITE PIPELINE] Writer chisel did not produce any output — document was not modified. Check the writer's system prompt and model configuration.` });
        } else {
          // Inject the full pipeline context so the sculptor can actually
          // summarize what happened. Previously the sculptor had tools stripped
          // AND no context, so it had to hallucinate the summary.
          const lastIdx = finalMessages.length - 1;
          if (finalMessages[lastIdx].role === "user") {
            finalMessages[lastIdx].content += `\n\n[WRITE PIPELINE COMPLETE]\nYour specialist sub-agents (researcher, writer, auditor) have finished running. The writer has already updated the active document, and the auditor has applied any targeted fixes it found.

[PIPELINE RESULTS]
${cumulativeContext}

[YOUR TASK]
Do NOT call write_draft, append_to_draft, replace_in_draft, or any other writing tool — your sub-agents handled that. Respond ONLY with a short summary (2-4 sentences) of what was written, based on the pipeline results above. Mention any issues the auditor flagged. Keep your response concise. Do NOT paste, repeat, or quote the written prose.`;
          }
          // Strip tools so the sculptor can only summarize
          tools = [];
        }
      }
    }
  }

  if (effectiveParams.provider === "gemini") {
    return runGeminiAgentLoop(effectiveParams, tools, emit, result);
  }

  // For non-Gemini providers, use a simpler approach:
  // single-pass with tool instructions in the system prompt
  return runGenericAgentLoop(effectiveParams, tools, emit, result);
}

// ---------------------------------------------------------------------------
// Gemini agent loop (native function calling)
// ---------------------------------------------------------------------------

async function runGeminiAgentLoop(
  params: AgentLoopParams,
  tools: AgentTool[],
  emit: EmitFn,
  result: AgentLoopResult
): Promise<AgentLoopResult> {
  const apiKey = await getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const safetySettings = getSafetySettings(params.safetyPreset ?? "none");
  const functionDeclarations = toGeminiFunctionDeclarations(tools);

  // Build conversation contents — use Record to preserve all fields (e.g. thoughtSignature)
  type ContentPart = Record<string, unknown>;
  type Content = { role: "user" | "model"; parts: ContentPart[] };

  const contents: Content[] = (params.messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : m.role,
    parts: [{ text: m.content }],
  }));

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (params.abortSignal?.aborted) break;

    let stream;
    try {
      stream = await ai.models.generateContentStream({
        model: params.model,
        contents,
        config: {
          systemInstruction: params.systemInstruction,
          temperature: params.temperature,
          maxOutputTokens: params.maxOutputTokens,
          abortSignal: params.abortSignal,
          safetySettings,
          ...(functionDeclarations.length > 0
            ? { tools: [{ functionDeclarations }] }
            : {}),
          ...(params.enableReasoning
            ? { thinkingConfig: { includeThoughts: true } }
            : {}),
        },
      });
    } catch (err: any) {
      const status = err?.status ?? err?.code ?? 0;
      const msg = err?.message ?? String(err);
      console.error("[AgentLoop] generateContentStream error:", msg);
      if (status === 429 || msg.includes("429") || msg.toLowerCase().includes("rate")) {
        const retryMatch = msg.match(/retry.after[:\s]*(\d+)/i);
        const errObj = { code: "rate_limited", message: "Rate limited by provider. Please wait and try again." };
        emit({ t: "e", d: { ...errObj, retryAfter: retryMatch ? parseInt(retryMatch[1]) : 30 } });
        result.errors.push(errObj);
      } else if (status === 401 || status === 403) {
        const errObj = { code: "auth_error", message: "Authentication failed. Check your API key." };
        emit({ t: "e", d: errObj });
        result.errors.push(errObj);
      } else {
        const errObj = { code: "provider_error", message: msg.slice(0, 500) };
        emit({ t: "e", d: errObj });
        result.errors.push(errObj);
      }
      return result;
    }

    let textAccumulated = "";
    let thoughtAccumulated = "";
    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    // Preserve raw model parts (including thoughtSignature on functionCall parts)
    const rawModelParts: ContentPart[] = [];

    try {
      for await (const chunk of stream) {
        if (params.abortSignal?.aborted) break;
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];

        for (const part of parts) {
          rawModelParts.push(part as ContentPart);

          if (part.functionCall) {
            functionCalls.push({
              name: part.functionCall.name ?? "",
              args: (part.functionCall.args as Record<string, unknown>) ?? {},
            });
          } else if (typeof part.text === "string") {
            if (part.thought) {
              const delta = extractDelta(part.text, thoughtAccumulated);
              if (delta) {
                thoughtAccumulated += delta;
                result.reasoningContent += delta;
                emit({ t: "r", d: delta });
              }
            } else {
              const delta = extractDelta(part.text, textAccumulated);
              if (delta) {
                textAccumulated += delta;
                result.content += delta;
                emit({ t: "c", d: delta });
              }
            }
          }
        }

        // Fallback for non-parts text
        if (parts.length === 0) {
          const t = chunk.text ?? "";
          if (t) {
            const delta = extractDelta(t, textAccumulated);
            if (delta) {
              textAccumulated += delta;
              result.content += delta;
              emit({ t: "c", d: delta });
            }
          }
        }
      }
    } catch (err: any) {
      if (!params.abortSignal?.aborted) {
        const errObj = { code: "stream_error", message: (err?.message ?? String(err)).slice(0, 500) };
        console.error("[AgentLoop] Stream error:", errObj.message);
        emit({ t: "e", d: errObj });
        result.errors.push(errObj);
      }
      return result;
    }

    // No function calls → we're done
    if (functionCalls.length === 0) {
      return result;
    }

    // Append the raw model response (preserves thoughtSignature on functionCall parts)
    contents.push({ role: "model", parts: rawModelParts });

    const responseParts: ContentPart[] = [];

    for (const fc of functionCalls) {
      const callId = generateId();
      emit({ t: "tc", d: { name: fc.name, args: fc.args, callId } });

      const tool = TOOL_MAP.get(fc.name);
      if (!tool) {
        const errorResult = { error: `Unknown tool: ${fc.name}` };
        emit({ t: "tr", d: { name: fc.name, result: errorResult, ok: false, callId } });
        responseParts.push({
          functionResponse: { name: fc.name, response: wrapForGeminiFunctionResponse(errorResult) },
        });
        result.toolCalls.push({ name: fc.name, args: fc.args, result: errorResult, ok: false });
        continue;
      }

      // Handle plan mode's propose_plan specially
      if (fc.name === "propose_plan") {
        emit({ t: "tp", d: (fc.args.steps ?? []) as any });
        const planResult = { ok: true, data: fc.args.steps };
        responseParts.push({
          functionResponse: { name: fc.name, response: wrapForGeminiFunctionResponse(planResult) },
        });
        result.toolCalls.push({
          name: fc.name,
          args: fc.args,
          result: planResult,
          ok: true,
        });
        return result;
      }

      // Handle delegate_to_specialist
      if (fc.name === "delegate_to_specialist") {
        const glyphId = String(fc.args.glyph_id ?? "");
        const task = String(fc.args.task ?? "");
        const validation = await validateSpecialist(glyphId, params.glyphId);
        if (!validation.ok) {
          const errResult = { error: validation.error };
          emit({ t: "tr", d: { name: fc.name, result: errResult, ok: false, callId } });
          responseParts.push({ functionResponse: { name: fc.name, response: wrapForGeminiFunctionResponse(errResult) } });
          result.toolCalls.push({ name: fc.name, args: fc.args, result: errResult, ok: false });
          continue;
        }
        emit({ t: "s", d: `Delegating to specialist: ${validation.glyph.name}...` });
        const { summary } = await runSpecialistInnerLoop(validation.glyph, task, params.toolContext, emit, params.abortSignal);
        const delegateResult = { ok: true, specialist: validation.glyph.name, summary };
        emit({ t: "tr", d: { name: fc.name, result: delegateResult, ok: true, callId } });
        responseParts.push({ functionResponse: { name: fc.name, response: wrapForGeminiFunctionResponse(delegateResult) } });
        result.toolCalls.push({ name: fc.name, args: fc.args, result: delegateResult, ok: true });
        continue;
      }

      // Handle delegate_fan_out (parallel delegation)
      if (fc.name === "delegate_fan_out") {
        const delegates = (fc.args.delegates ?? []) as Array<{ glyph_id: string; task: string }>;
        if (!Array.isArray(delegates) || delegates.length === 0) {
          const errResult = { error: "delegates array is required and must be non-empty" };
          emit({ t: "tr", d: { name: fc.name, result: errResult, ok: false, callId } });
          responseParts.push({ functionResponse: { name: fc.name, response: wrapForGeminiFunctionResponse(errResult) } });
          result.toolCalls.push({ name: fc.name, args: fc.args, result: errResult, ok: false });
          continue;
        }

        emit({ t: "s", d: `Running ${delegates.length} specialist(s) in parallel...` });
        const promises = delegates.map(async (d) => {
          const v = await validateSpecialist(String(d.glyph_id ?? ""), params.glyphId);
          if (!v.ok) return { specialist: d.glyph_id, ok: false, error: v.error };
          const { summary } = await runSpecialistInnerLoop(v.glyph, String(d.task ?? ""), params.toolContext, emit, params.abortSignal);
          return { specialist: v.glyph.name, ok: true, summary };
        });
        const results = await Promise.all(promises);
        const fanOutResult = { ok: true, results };
        emit({ t: "tr", d: { name: fc.name, result: fanOutResult, ok: true, callId } });
        responseParts.push({ functionResponse: { name: fc.name, response: wrapForGeminiFunctionResponse(fanOutResult) } });
        result.toolCalls.push({ name: fc.name, args: fc.args, result: fanOutResult, ok: true });
        continue;
      }

      // Risky action → confirmation
      if (tool.riskLevel === "risky") {
        const loopId = generateId();
        emit({
          t: "confirm",
          d: {
            loopId,
            name: fc.name,
            args: fc.args,
            reason: `This action (${fc.name}) is destructive and requires your approval.`,
            callId,
          },
        });
        emit({ t: "s", d: `Waiting for confirmation: ${fc.name}...` });

        const approved = await new Promise<boolean>((resolve) => {
          pendingConfirmations.set(loopId, {
            resolve,
            loopId,
            tool,
            args: fc.args,
            ctx: params.toolContext,
          });

          // Auto-reject after 5 minutes to prevent memory leaks
          setTimeout(() => {
            if (pendingConfirmations.has(loopId)) {
              pendingConfirmations.delete(loopId);
              resolve(false);
            }
          }, 5 * 60 * 1000);
        });

        if (!approved) {
          const rejectedResult = { rejected: true, message: "User rejected this action" };
          emit({ t: "tr", d: { name: fc.name, result: rejectedResult, ok: false, callId } });
          responseParts.push({
            functionResponse: { name: fc.name, response: wrapForGeminiFunctionResponse(rejectedResult) },
          });
          result.toolCalls.push({
            name: fc.name,
            args: fc.args,
            result: rejectedResult,
            ok: false,
            confirmed: false,
          });
          continue;
        }
      }

      // Execute the tool
      emit({ t: "s", d: `Executing ${fc.name}...` });
      let toolResult: ToolResult;
      try {
        toolResult = await tool.execute(fc.args, params.toolContext);
      } catch (err: any) {
        toolResult = { ok: false, error: (err?.message ?? String(err)).slice(0, 500) };
      }

      const fullResult = toolResult.ok ? toolResult.data : { error: toolResult.error };
      emit({ t: "tr", d: { name: fc.name, result: fullResult, ok: toolResult.ok, callId } });
      responseParts.push({
        functionResponse: {
          name: fc.name,
          response: wrapForGeminiFunctionResponse(truncateForContext(fullResult)),
        },
      });
      result.toolCalls.push({
        name: fc.name,
        args: fc.args,
        result: fullResult,
        ok: toolResult.ok,
        ...(tool.riskLevel === "risky" ? { confirmed: true } : {}),
      });
    }

    contents.push({ role: "user", parts: responseParts });
  }

  emit({ t: "s", d: "Reached maximum tool iterations." });
  return result;
}

// ---------------------------------------------------------------------------
// Generic agent loop for Anthropic / OpenAI (tool instructions in prompt)
// ---------------------------------------------------------------------------

async function runGenericAgentLoop(
  params: AgentLoopParams,
  tools: AgentTool[],
  emit: EmitFn,
  result: AgentLoopResult
): Promise<AgentLoopResult> {
  // For non-Gemini providers, we inject tool descriptions into the system
  // prompt and parse structured JSON tool calls from the model's text output.
  // This is a simpler approach that works across all providers without
  // provider-specific tool-calling APIs.

  const toolDescriptions = tools
    .map(
      (t) =>
        `- ${t.schema.name}: ${t.schema.description}\n  Parameters: ${JSON.stringify(t.schema.parameters.properties)}\n  Required: ${(t.schema.parameters.required ?? []).join(", ")}`
    )
    .join("\n\n");

  const toolSystemAddendum = `

You have access to tools. To use a tool, output a JSON block like this on its own line:
<tool_call>{"name": "tool_name", "args": {"param": "value"}}</tool_call>

After using a tool, wait for the result before continuing. You can use multiple tools in sequence.

Available tools:
${toolDescriptions}

When you're done using tools, continue with your normal text response.`;

  const augmentedSystem = (params.systemInstruction ?? "") + toolSystemAddendum;

  // Use streamModel for the text generation
  const { streamModel } = await import("./providers");
  const deltas = await streamModel({
    ...params,
    messages: params.messages?.map(m => ({
        role: m.role === "assistant" ? "model" : m.role,
        content: m.content
    })) || [],
    systemInstruction: augmentedSystem,
    enableReasoning: params.enableReasoning,
  });

  let fullText = "";
  try {
    for await (const chunk of deltas) {
      if (!chunk?.text) continue;
      if (chunk.channel === "reasoning") {
        result.reasoningContent += chunk.text;
        emit({ t: "r", d: chunk.text });
      } else {
        fullText += chunk.text;
        result.content += chunk.text;
        emit({ t: "c", d: chunk.text });
      }
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[AgentLoop/generic] Stream error:", msg);
    if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
      const errObj = { code: "rate_limited", message: "Rate limited by provider." };
      emit({ t: "e", d: { ...errObj, retryAfter: 30 } });
      result.errors.push(errObj);
    } else if (msg.includes("401") || msg.includes("403")) {
      const errObj = { code: "auth_error", message: "Authentication failed. Check your API key." };
      emit({ t: "e", d: errObj });
      result.errors.push(errObj);
    } else if (!params.abortSignal?.aborted) {
      const errObj = { code: "provider_error", message: msg.slice(0, 500) };
      emit({ t: "e", d: errObj });
      result.errors.push(errObj);
    }
  }

  // Parse any tool calls from the text output (best-effort)
  const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;
  while ((match = toolCallRegex.exec(fullText)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { name: string; args: Record<string, unknown> };
      const callId = generateId();
      emit({ t: "tc", d: { name: parsed.name, args: parsed.args, callId } });

      const tool = TOOL_MAP.get(parsed.name);
      if (!tool) {
        emit({ t: "tr", d: { name: parsed.name, result: { error: "Unknown tool" }, ok: false, callId } });
        result.toolCalls.push({ name: parsed.name, args: parsed.args, result: { error: "Unknown tool" }, ok: false });
        continue;
      }

      // Handle delegation in generic loop
      if (parsed.name === "delegate_to_specialist") {
        const gId = String(parsed.args.glyph_id ?? "");
        const tsk = String(parsed.args.task ?? "");
        const v = await validateSpecialist(gId, params.glyphId);
        if (!v.ok) {
          emit({ t: "tr", d: { name: parsed.name, result: { error: v.error }, ok: false, callId } });
          result.toolCalls.push({ name: parsed.name, args: parsed.args, result: { error: v.error }, ok: false });
        } else {
          const { summary } = await runSpecialistInnerLoop(v.glyph, tsk, params.toolContext, emit, params.abortSignal);
          const delResult = { ok: true, specialist: v.glyph.name, summary };
          emit({ t: "tr", d: { name: parsed.name, result: delResult, ok: true, callId } });
          result.toolCalls.push({ name: parsed.name, args: parsed.args, result: delResult, ok: true });
        }
        continue;
      }
      if (parsed.name === "delegate_fan_out") {
        const delegates = (parsed.args.delegates ?? []) as Array<{ glyph_id: string; task: string }>;
        if (!Array.isArray(delegates) || delegates.length === 0) {
          const errR = { error: "delegates array is required" };
          emit({ t: "tr", d: { name: parsed.name, result: errR, ok: false, callId } });
          result.toolCalls.push({ name: parsed.name, args: parsed.args, result: errR, ok: false });
        } else {
          const results = await Promise.all(delegates.map(async (d) => {
            const vv = await validateSpecialist(String(d.glyph_id ?? ""), params.glyphId);
            if (!vv.ok) return { specialist: d.glyph_id, ok: false, error: vv.error };
            const { summary: s } = await runSpecialistInnerLoop(vv.glyph, String(d.task ?? ""), params.toolContext, emit, params.abortSignal);
            return { specialist: vv.glyph.name, ok: true, summary: s };
          }));
          const fanResult = { ok: true, results };
          emit({ t: "tr", d: { name: parsed.name, result: fanResult, ok: true, callId } });
          result.toolCalls.push({ name: parsed.name, args: parsed.args, result: fanResult, ok: true });
        }
        continue;
      }

      if (tool.riskLevel === "risky") {
        const loopId = generateId();
        emit({
          t: "confirm",
          d: {
            loopId,
            name: parsed.name,
            args: parsed.args,
            reason: `This action (${parsed.name}) is destructive and requires your approval.`,
            callId,
          },
        });

        const approved = await new Promise<boolean>((resolve) => {
          pendingConfirmations.set(loopId, {
            resolve,
            loopId,
            tool,
            args: parsed.args,
            ctx: params.toolContext,
          });
          setTimeout(() => {
            if (pendingConfirmations.has(loopId)) {
              pendingConfirmations.delete(loopId);
              resolve(false);
            }
          }, 5 * 60 * 1000);
        });

        if (!approved) {
          emit({ t: "tr", d: { name: parsed.name, result: { rejected: true }, ok: false, callId } });
          result.toolCalls.push({ name: parsed.name, args: parsed.args, result: { rejected: true }, ok: false, confirmed: false });
          continue;
        }
      }

      emit({ t: "s", d: `Executing ${parsed.name}...` });
      let toolResult: ToolResult;
      try {
        toolResult = await tool.execute(parsed.args, params.toolContext);
      } catch (err: any) {
        toolResult = { ok: false, error: (err?.message ?? String(err)).slice(0, 500) };
      }

      emit({ t: "tr", d: { name: parsed.name, result: toolResult.data ?? toolResult.error, ok: toolResult.ok, callId } });
      result.toolCalls.push({
        name: parsed.name,
        args: parsed.args,
        result: toolResult.data ?? toolResult.error,
        ok: toolResult.ok,
        ...(tool.riskLevel === "risky" ? { confirmed: true } : {}),
      });
    } catch {
      /* malformed tool call JSON, skip */
    }
  }

  return result;
}
