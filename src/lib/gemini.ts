import {
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  type SafetySetting,
} from "@google/genai";
import type { StreamChunk } from "./streamTypes";

type GeminiRole = "user" | "model";
type GeminiInlineData = { data: string; mimeType: string };
type GeminiPart = { text?: string; inlineData?: GeminiInlineData };
type GeminiContent = { role: GeminiRole; parts: GeminiPart[] };

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GEMINI_API_KEY. Add it to your environment (see .env.example)."
    );
  }
  return new GoogleGenAI({ apiKey });
}

export function toGeminiContents(messages: Array<{ role: GeminiRole; content: string }>): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
}

export type SafetyPreset = "none" | "low" | "medium" | "high";

function buildSafetySettings(threshold: HarmBlockThreshold): SafetySetting[] {
  return [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold,
    },
  ];
}

const DEFAULT_SAFETY_SETTINGS: SafetySetting[] = buildSafetySettings(
  HarmBlockThreshold.BLOCK_NONE
);

export function getSafetySettings(preset: SafetyPreset): SafetySetting[] {
  switch (preset) {
    case "high":
      return buildSafetySettings(HarmBlockThreshold.BLOCK_LOW_AND_ABOVE);
    case "medium":
      return buildSafetySettings(HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE);
    case "low":
      return buildSafetySettings(HarmBlockThreshold.BLOCK_ONLY_HIGH);
    case "none":
    default:
      return DEFAULT_SAFETY_SETTINGS;
  }
}

export type { StreamChunk } from "./streamTypes";

/** Simple non-streaming text generation for short tasks like stub creation. */
export async function generateGeminiText(params: {
  model?: string;
  systemInstruction?: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<string> {
  const ai = getGeminiClient();
  const model = params.model || process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: "user" as GeminiRole, parts: [{ text: params.prompt }] }],
    config: {
      systemInstruction: params.systemInstruction,
      temperature: params.temperature ?? 0.7,
      maxOutputTokens: params.maxOutputTokens ?? 1024,
      safetySettings: DEFAULT_SAFETY_SETTINGS,
    },
  });
  return res.text ?? "";
}

/**
 * Streams generated text as content-channel chunks, or reasoning + content when
 * `enableReasoning` is true (thinking-capable Gemini models).
 *
 * Without thinking: `GenerateContentResponse.text` is treated as cumulative text;
 * we yield content-channel deltas by comparing to the previous aggregate.
 */
export async function streamGeminiText(params: {
  model: string;
  systemInstruction?: string;
  contents: GeminiContent[];
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  safetySettings?: SafetySetting[];
  enableReasoning?: boolean;
}): Promise<AsyncGenerator<StreamChunk>> {
  const ai = getGeminiClient();

  const stream = await ai.models.generateContentStream({
    model: params.model,
    contents: params.contents,
    config: {
      systemInstruction: params.systemInstruction,
      temperature: params.temperature,
      maxOutputTokens: params.maxOutputTokens,
      abortSignal: params.abortSignal,
      safetySettings: params.safetySettings ?? DEFAULT_SAFETY_SETTINGS,
      ...(params.enableReasoning
        ? { thinkingConfig: { includeThoughts: true } }
        : {}),
    },
  });

  async function* deltas(): AsyncGenerator<StreamChunk> {
    if (!params.enableReasoning) {
      let accumulated = "";
      for await (const chunk of stream) {
        const chunkText = chunk.text ?? "";
        if (!chunkText) continue;

        let delta: string;
        if (accumulated && chunkText.startsWith(accumulated)) {
          delta = chunkText.slice(accumulated.length);
        } else if (!accumulated) {
          delta = chunkText;
        } else if (chunkText.includes(accumulated)) {
          delta = chunkText.slice(accumulated.length);
        } else {
          delta = chunkText;
        }

        accumulated += delta;
        if (delta) yield { channel: "content", text: delta };
      }
      return;
    }

    // Thinking models: branch on `part.thought` per streamed parts.
    let thoughtAcc = "";
    let contentAcc = "";

    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      if (parts.length > 0) {
        for (const part of parts) {
          const raw = part.text ?? "";
          if (!raw) continue;
          const channel = part.thought ? ("reasoning" as const) : ("content" as const);
          const prev = channel === "reasoning" ? thoughtAcc : contentAcc;
          let delta: string;
          if (prev && raw.startsWith(prev)) {
            delta = raw.slice(prev.length);
          } else if (!prev) {
            delta = raw;
          } else if (raw.includes(prev)) {
            delta = raw.slice(prev.length);
          } else {
            delta = raw;
          }
          if (channel === "reasoning") {
            thoughtAcc = prev + delta;
          } else {
            contentAcc = prev + delta;
          }
          if (delta) yield { channel, text: delta };
        }
        continue;
      }

      const chunkText = chunk.text ?? "";
      if (!chunkText) continue;
      let delta: string;
      if (contentAcc && chunkText.startsWith(contentAcc)) {
        delta = chunkText.slice(contentAcc.length);
      } else if (!contentAcc) {
        delta = chunkText;
      } else if (chunkText.includes(contentAcc)) {
        delta = chunkText.slice(contentAcc.length);
      } else {
        delta = chunkText;
      }
      contentAcc += delta;
      if (delta) yield { channel: "content", text: delta };
    }
  }

  return deltas();
}

