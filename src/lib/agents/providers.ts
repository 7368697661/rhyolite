import { streamGeminiText, getSafetySettings, type SafetyPreset } from "./gemini";
import type { StreamChunk } from "./streamTypes";

export type { StreamChunk, StreamChannel } from "./streamTypes";

export type Provider = "gemini" | "openai" | "anthropic";

export interface StreamModelParams {
  provider: Provider;
  model: string;
  systemInstruction?: string;
  messages: Array<{ role: "user" | "model"; content: string }>;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  safetyPreset?: SafetyPreset;
  /** When true, request provider-native reasoning where supported (extra cost/latency). */
  enableReasoning?: boolean;
}

function getEnv(key: string): string | undefined {
  return process.env[key];
}

function extractOpenRouterReasoningDelta(
  delta: Record<string, unknown> | undefined
): string {
  if (!delta) return "";
  if (typeof delta.reasoning === "string" && delta.reasoning) {
    return delta.reasoning;
  }
  if (
    typeof delta.reasoning_content === "string" &&
    delta.reasoning_content
  ) {
    return delta.reasoning_content;
  }
  const details = delta.reasoning_details;
  if (!Array.isArray(details)) return "";
  let out = "";
  for (const item of details) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.type === "reasoning.text" && typeof o.text === "string") {
      out += o.text;
    } else if (o.type === "reasoning.summary" && typeof o.summary === "string") {
      out += o.summary;
    }
  }
  return out;
}

// OpenAI-compatible streaming (works with OpenAI, Ollama, LM Studio, OpenRouter, etc.)
async function* streamOpenAI(
  params: StreamModelParams
): AsyncGenerator<StreamChunk> {
  const apiKey = getEnv("OPENAI_API_KEY") ?? "";
  const baseUrl = getEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";

  const messages: Array<{ role: string; content: string }> = [];
  if (params.systemInstruction) {
    messages.push({ role: "system", content: params.systemInstruction });
  }
  for (const m of params.messages) {
    messages.push({
      role: m.role === "model" ? "assistant" : "user",
      content: m.content,
    });
  }

  const useOpenRouterReasoning =
    !!params.enableReasoning &&
    (baseUrl.includes("openrouter.ai") ||
      getEnv("OPENROUTER_REASONING") === "true");

  const body: Record<string, unknown> = {
    model: params.model,
    messages,
    stream: true,
    temperature: params.temperature,
    max_tokens: params.maxOutputTokens,
  };
  if (useOpenRouterReasoning) {
    body.reasoning = { effort: "high" };
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: params.abortSignal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: Record<string, unknown> }>;
        };
        const delta = parsed.choices?.[0]?.delta;
        if (useOpenRouterReasoning) {
          const r = extractOpenRouterReasoningDelta(delta);
          if (r) yield { channel: "reasoning", text: r };
        }
        const content = delta?.content;
        if (typeof content === "string" && content) {
          yield { channel: "content", text: content };
        }
      } catch {
        /* skip malformed */
      }
    }
  }
}

// Anthropic Messages API streaming
async function* streamAnthropic(
  params: StreamModelParams
): AsyncGenerator<StreamChunk> {
  const apiKey = getEnv("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const messages: Array<{ role: string; content: string }> = [];
  for (const m of params.messages) {
    messages.push({
      role: m.role === "model" ? "assistant" : "user",
      content: m.content,
    });
  }

  const maxOut = params.maxOutputTokens ?? 4096;
  const budget =
    params.enableReasoning
      ? Math.min(16000, Math.max(1024, Math.floor(maxOut * 0.45)))
      : undefined;
  const max_tokens =
    params.enableReasoning && budget != null
      ? Math.max(maxOut + budget + 2048, budget + 2048)
      : maxOut;

  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens,
    system: params.systemInstruction ?? undefined,
    messages,
    stream: true,
    temperature: params.temperature,
  };
  if (params.enableReasoning && budget != null) {
    body.thinking = { type: "enabled", budget_tokens: budget };
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: params.abortSignal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const parsed = JSON.parse(trimmed.slice(6)) as {
          type?: string;
          delta?: {
            type?: string;
            thinking?: string;
            text?: string;
          };
        };
        if (parsed.type !== "content_block_delta" || !parsed.delta) continue;
        const d = parsed.delta;
        if (d.type === "thinking_delta" && typeof d.thinking === "string") {
          yield { channel: "reasoning", text: d.thinking };
        } else if (d.type === "text_delta" && typeof d.text === "string") {
          yield { channel: "content", text: d.text };
        } else if (typeof d.text === "string" && d.text) {
          // Legacy / flat delta shape
          yield { channel: "content", text: d.text };
        }
      } catch {
        /* skip */
      }
    }
  }
}

/**
 * Unified streaming interface across all providers.
 * Yields discriminated chunks for reasoning vs visible answer.
 */
export async function streamModel(
  params: StreamModelParams
): Promise<AsyncGenerator<StreamChunk>> {
  switch (params.provider) {
    case "openai":
      return streamOpenAI(params);
    case "anthropic":
      return streamAnthropic(params);
    case "gemini":
    default: {
      const contents = params.messages.map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      }));
      return streamGeminiText({
        model: params.model,
        systemInstruction: params.systemInstruction,
        contents,
        temperature: params.temperature,
        maxOutputTokens: params.maxOutputTokens,
        abortSignal: params.abortSignal,
        safetySettings: getSafetySettings(params.safetyPreset ?? "none"),
        enableReasoning: params.enableReasoning,
      });
    }
  }
}

/** Returns providers that have their API keys configured. */
export function getAvailableProviders(): Provider[] {
  const available: Provider[] = ["gemini"];
  if (getEnv("OPENAI_API_KEY") || getEnv("OPENAI_BASE_URL")) {
    available.push("openai");
  }
  if (getEnv("ANTHROPIC_API_KEY")) available.push("anthropic");
  return available;
}
