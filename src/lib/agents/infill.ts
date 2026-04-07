import { readProject, listWikiEntries } from "./fs-db";
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