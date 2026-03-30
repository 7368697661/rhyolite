import { streamGeminiText, getSafetySettings, type SafetyPreset } from "./gemini";

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
}

function getEnv(key: string): string | undefined {
  return process.env[key];
}

// OpenAI-compatible streaming (works with OpenAI, Ollama, LM Studio, etc.)
async function* streamOpenAI(params: StreamModelParams): AsyncGenerator<string> {
  const apiKey = getEnv("OPENAI_API_KEY") ?? "";
  const baseUrl = getEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";

  const messages: Array<{ role: string; content: string }> = [];
  if (params.systemInstruction) {
    messages.push({ role: "system", content: params.systemInstruction });
  }
  for (const m of params.messages) {
    messages.push({ role: m.role === "model" ? "assistant" : "user", content: m.content });
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: params.model,
      messages,
      stream: true,
      temperature: params.temperature,
      max_tokens: params.maxOutputTokens,
    }),
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
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* skip malformed */ }
    }
  }
}

// Anthropic Messages API streaming
async function* streamAnthropic(params: StreamModelParams): AsyncGenerator<string> {
  const apiKey = getEnv("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const messages: Array<{ role: string; content: string }> = [];
  for (const m of params.messages) {
    messages.push({ role: m.role === "model" ? "assistant" : "user", content: m.content });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxOutputTokens ?? 4096,
      system: params.systemInstruction ?? undefined,
      messages,
      stream: true,
      temperature: params.temperature,
    }),
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
        const parsed = JSON.parse(trimmed.slice(6));
        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
          yield parsed.delta.text;
        }
      } catch { /* skip */ }
    }
  }
}

/**
 * Unified streaming interface across all providers.
 * Returns an async generator of text deltas.
 */
export async function streamModel(params: StreamModelParams): Promise<AsyncGenerator<string>> {
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
      });
    }
  }
}

/** Returns providers that have their API keys configured. */
export function getAvailableProviders(): Provider[] {
  const available: Provider[] = ["gemini"];
  if (getEnv("OPENAI_API_KEY") || getEnv("OPENAI_BASE_URL")) available.push("openai");
  if (getEnv("ANTHROPIC_API_KEY")) available.push("anthropic");
  return available;
}
