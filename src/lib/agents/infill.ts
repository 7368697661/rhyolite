import { readProject, listWikiEntries, readGlyphs, type FsGlyph } from "./fs-db";
import { streamModel } from "./providers";

export interface InfillParams {
  projectId: string;
  selectedText: string;
  fullContent: string;
  instruction: string;
  abortSignal?: AbortSignal;
  onDelta?: (text: string) => void;
}

export async function executeInfill(params: InfillParams): Promise<string> {
  const { projectId, selectedText, fullContent, instruction, abortSignal, onDelta } = params;

  const project = await readProject(projectId).catch(() => null);
  const wikiEntries = await listWikiEntries(projectId).catch(() => []);

  let systemInstruction = `You are an AI co-writer. The user has selected a portion of text in their chapter. You will rewrite or infill the selected text based on the user's instruction.
Return ONLY the replacement text. Do not include introductory phrases. Ensure the prose blends perfectly into the surrounding text.`;

  if (project?.storyOutline) {
    systemInstruction += `\n\n---\nCHAPTER OUTLINE:\n${project.storyOutline}`;
  }
  if (project?.loreBible) {
    systemInstruction += `\n\n---\nLORE BIBLE:\n${project.loreBible}`;
  }
  if (wikiEntries.length > 0) {
    systemInstruction += `\n\n---\nWIKI ENTRIES:\n`;
    for (const w of wikiEntries) {
      systemInstruction += `### ${w.title}\n${w.content}\n\n`;
    }
  }

  const prompt = `Here is the current chapter draft for context:\n\n${fullContent}\n\n---\nThe selected text is:\n"${selectedText}"\n\nInstruction: ${instruction}\n\nReturn ONLY the replacement text.`;

  const stream = await streamModel({
    provider: "gemini",
    model: "gemini-2.0-flash",
    systemInstruction,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.8,
    abortSignal,
  });

  let fullText = "";
  for await (const chunk of stream) {
    if (abortSignal?.aborted) break;
    if (chunk?.text && chunk.channel !== "reasoning") {
      fullText += chunk.text;
      if (onDelta) onDelta(chunk.text);
    }
  }

  return fullText;
}

// ---------------------------------------------------------------------------
// The Polisher — multi-generation refining
// ---------------------------------------------------------------------------

export interface PolisherParams {
  projectId: string;
  /** Text currently selected in the editor (empty string = forward-generation). */
  selectedText: string;
  /** Full document content for context. */
  fullContent: string;
  /** Cursor position within fullContent (used for forward-gen context windowing). */
  cursorPos: number;
  abortSignal?: AbortSignal;
  /** Called per-generation with (index, delta) so UI can stream each card. */
  onDelta?: (index: number, text: string) => void;
  /** Number of parallel generations to produce. */
  count?: number;
}

export interface PolisherResult {
  generations: string[];
}

/**
 * Runs multiple parallel generations using the Glyph marked isPolisherEngine.
 * Supports both rewrite (text selected) and forward-generation (cursor-only) modes.
 */
export async function executePolisherGeneration(params: PolisherParams): Promise<PolisherResult> {
  const {
    projectId,
    selectedText,
    fullContent,
    cursorPos,
    abortSignal,
    onDelta,
    count = 3,
  } = params;

  // Find the Polisher glyph
  const allGlyphs = await readGlyphs();
  const polisherGlyph = allGlyphs.find((g: FsGlyph) => g.isPolisherEngine);
  if (!polisherGlyph) {
    throw new Error("No Glyph is marked as a Polisher Engine. Enable the toggle on a Glyph in the registry.");
  }

  // Build context
  const project = await readProject(projectId).catch(() => null);
  const wikiEntries = await listWikiEntries(projectId).catch(() => []);

  let systemInstruction = `You are an expert prose polisher. Generate high-quality creative writing that blends naturally with the surrounding text. Return ONLY the generated text with no commentary, preamble, or meta-discussion.`;

  if (project?.loreBible) {
    systemInstruction += `\n\n---\nLORE BIBLE:\n${project.loreBible}`;
  }
  if (project?.storyOutline) {
    systemInstruction += `\n\n---\nSTORY OUTLINE:\n${project.storyOutline}`;
  }
  if (wikiEntries.length > 0) {
    const wikiContext = wikiEntries.slice(0, 20).map(w => `### ${w.title}\n${w.content}`).join("\n\n");
    systemInstruction += `\n\n---\nWIKI ENTRIES:\n${wikiContext}`;
  }

  const isRewrite = selectedText.length > 0;

  let prompt: string;
  if (isRewrite) {
    // Rewrite mode — provide surrounding context and the selected text to rewrite
    const before = fullContent.substring(Math.max(0, cursorPos - selectedText.length - 2000), cursorPos - selectedText.length);
    const after = fullContent.substring(cursorPos, cursorPos + 2000);
    prompt = `Here is the surrounding context:\n\n---BEFORE---\n${before}\n---SELECTED TEXT---\n${selectedText}\n---AFTER---\n${after}\n\nRewrite the SELECTED TEXT. Produce a polished variation that fits seamlessly between the BEFORE and AFTER sections. Return ONLY the replacement text.`;
  } else {
    // Forward-generation mode — continue from cursor position
    const trailing = fullContent.substring(Math.max(0, cursorPos - 4000), cursorPos);
    const leadingContext = fullContent.substring(cursorPos, Math.min(fullContent.length, cursorPos + 1000));
    prompt = `Here is the text so far:\n\n${trailing}\n\n---\n\nContinue writing from where the text left off.${leadingContext ? ` The text that currently follows (for tone/context only, do not repeat it):\n${leadingContext}` : ""}\n\nReturn ONLY the continuation text.`;
  }

  const provider = (polisherGlyph.provider || "openai") as "gemini" | "openai" | "anthropic";

  // Launch N parallel generations
  const promises = Array.from({ length: count }, (_, i) => {
    return (async () => {
      let text = "";
      const stream = await streamModel({
        provider,
        model: polisherGlyph.model,
        systemInstruction,
        messages: [{ role: "user", content: prompt }],
        temperature: polisherGlyph.temperature ?? 0.9,
        maxOutputTokens: polisherGlyph.outputLength ?? 2048,
        abortSignal,
        isCompletionModel: polisherGlyph.isCompletionModel,
      });
      for await (const chunk of stream) {
        if (abortSignal?.aborted) break;
        if (chunk?.text && chunk.channel !== "reasoning") {
          text += chunk.text;
          if (onDelta) onDelta(i, chunk.text);
        }
      }
      return text;
    })();
  });

  const generations = await Promise.all(promises);
  return { generations };
}