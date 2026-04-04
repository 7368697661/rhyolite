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
  type AgentTool,
  type ToolContext,
  type ToolResult,
} from "./agentTools";
import type { ChatMode, NdjsonEvent } from "./streamTypes";
import { generateId, getGlyph, readGlyphs, type FsGlyph } from "./fs-db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentLoopParams {
  provider: "gemini" | "openai" | "anthropic";
  model: string;
  systemInstruction?: string;
  messages: Array<{ role: "user" | "model"; content: string }>;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  safetyPreset?: SafetyPreset;
  enableReasoning?: boolean;
  mode: ChatMode;
  toolContext: ToolContext;
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
// Specialist delegation helpers
// ---------------------------------------------------------------------------

async function validateSpecialist(
  glyphId: string,
  activeGlyphId?: string
): Promise<{ ok: true; glyph: FsGlyph } | { ok: false; error: string }> {
  const glyph = await getGlyph(glyphId);
  if (!glyph) return { ok: false, error: `Specialist glyph not found: ${glyphId}` };
  if (glyph.isSculpter !== false) {
    return { ok: false, error: `Glyph "${glyph.name}" is a Sculpter, not a specialist. Delegation must target a specialist.` };
  }
  if (glyphId === activeGlyphId) {
    return { ok: false, error: "Cannot delegate to the same glyph running the current session." };
  }
  return { ok: true, glyph };
}

async function runSpecialistInnerLoop(
  glyph: FsGlyph,
  task: string,
  toolContext: ToolContext,
  emit: EmitFn,
  abortSignal?: AbortSignal
): Promise<string> {
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

  const innerTools = ALL_TOOLS.filter(
    (t) => t.schema.name !== "delegate_to_specialist" && t.schema.name !== "delegate_fan_out"
  );

  if (glyph.provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      emit({ t: "sub", d: { phase: "end", glyphId: glyph.id, glyphName: glyph.name, text: "Error: Missing GEMINI_API_KEY" } });
      return "Error: Missing GEMINI_API_KEY";
    }
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
            systemInstruction: glyph.systemInstruction,
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
            } else if (part.text && !part.thought) {
              const delta = part.text.slice(textAccumulated.length);
              if (delta) {
                textAccumulated += delta;
                innerEmit({ t: "c", d: delta });
              }
            }
          }
          if (parts.length === 0) {
            const t = chunk.text ?? "";
            if (t) {
              const delta = t.slice(textAccumulated.length);
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
    // Non-Gemini specialist: single-pass generation
    const { streamModel } = await import("./providers");
    const deltas = await streamModel({
      provider: glyph.provider,
      model: glyph.model,
      systemInstruction: glyph.systemInstruction,
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
  return summary;
}

// ---------------------------------------------------------------------------
// Main agent loop (Gemini-first, with fallback for other providers)
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 20;
const MAX_INNER_ITERATIONS = 8;

/** Max chars for a single tool result fed back into the model context. */
const MAX_TOOL_RESULT_CHARS = 3000;

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

  const tools =
    params.mode === "plan"
      ? [PROPOSE_PLAN_TOOL]
      : params.mode === "agent"
        ? ALL_TOOLS
        : [];

  if (tools.length === 0) {
    throw new Error("Agent loop requires agent or plan mode");
  }

  if (params.provider === "gemini") {
    return runGeminiAgentLoop(params, tools, emit, result);
  }

  // For non-Gemini providers, use a simpler approach:
  // single-pass with tool instructions in the system prompt
  return runGenericAgentLoop(params, tools, emit, result);
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  const ai = new GoogleGenAI({ apiKey });

  const safetySettings = getSafetySettings(params.safetyPreset ?? "none");
  const functionDeclarations = toGeminiFunctionDeclarations(tools);

  // Build conversation contents — use Record to preserve all fields (e.g. thoughtSignature)
  type ContentPart = Record<string, unknown>;
  type Content = { role: "user" | "model"; parts: ContentPart[] };

  const contents: Content[] = params.messages.map((m) => ({
    role: m.role,
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
          tools: [{ functionDeclarations }],
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
          } else if (part.text) {
            if (part.thought) {
              const delta = part.text.slice(thoughtAccumulated.length);
              if (delta) {
                thoughtAccumulated += delta;
                result.reasoningContent += delta;
                emit({ t: "r", d: delta });
              }
            } else {
              const delta = part.text.slice(textAccumulated.length);
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
            const delta = t.slice(textAccumulated.length);
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
        const summary = await runSpecialistInnerLoop(validation.glyph, task, params.toolContext, emit, params.abortSignal);
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
          const summary = await runSpecialistInnerLoop(v.glyph, String(d.task ?? ""), params.toolContext, emit, params.abortSignal);
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
          const summary = await runSpecialistInnerLoop(v.glyph, tsk, params.toolContext, emit, params.abortSignal);
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
            const s = await runSpecialistInnerLoop(vv.glyph, String(d.task ?? ""), params.toolContext, emit, params.abortSignal);
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
