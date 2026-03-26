import {
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  type SafetySetting,
} from "@google/genai";

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

/**
 * Streams generated text deltas (not the full accumulated string).
 *
 * Note: `@google/genai` streaming provides `GenerateContentResponse.text` as the
 * concatenation of text parts. We compute deltas by comparing against the
 * previously accumulated output.
 */
export async function streamGeminiText(params: {
  model: string;
  systemInstruction?: string;
  contents: GeminiContent[];
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  safetySettings?: SafetySetting[];
}): Promise<AsyncGenerator<string>> {
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
    }
  });

  async function* deltas() {
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
        // Fallback: treat the entire chunk as new text.
        delta = chunkText;
      }

      accumulated += delta;
      if (delta) yield delta;
    }
  }

  return deltas();
}

