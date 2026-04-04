import { z } from "zod";
import { streamGeminiText } from "@/lib/gemini";
import { HarmBlockThreshold, HarmCategory } from "@google/genai";
import { readProject, listWikiEntries } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const InfillRequestSchema = z.object({
  projectId: z.string(),
  selectedText: z.string(),
  fullContent: z.string(),
  instruction: z.string(), // e.g. "expand this", "rewrite more descriptively"
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = InfillRequestSchema.safeParse(json);

  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400 });
  }

  const { projectId, selectedText, fullContent, instruction } = parsed.data;

  const project = await readProject(projectId);
  if (!project) return new Response("Project not found", { status: 404 });

  const wikiEntries = await listWikiEntries(projectId);

  let systemInstruction = `You are an AI co-writer. The user has selected a portion of text in their chapter. You will rewrite or infill the selected text based on the user's instruction.
Return ONLY the replacement text. Do not include introductory phrases. Ensure the prose blends perfectly into the surrounding text.`;

  if(project.storyOutline){
    systemInstruction+= `\n\n---\nCHAPTER OUTLINE:\n${project.storyOutline}`;
  }
  if (project.loreBible) {
    systemInstruction += `\n\n---\nLORE BIBLE:\n${project.loreBible}`;
  }
  if (wikiEntries.length > 0) {
    systemInstruction += `\n\n---\nWIKI ENTRIES:\n`;
    for (const w of wikiEntries) {
      systemInstruction += `### ${w.title}\n${w.content}\n\n`;
    }
  }

  const contents = [
    {
      role: "user" as const,
      parts: [
        {
          text: `Here is the current chapter draft for context:\n\n${fullContent}\n\n---\nThe selected text is:\n"${selectedText}"\n\nInstruction: ${instruction}\n\nReturn ONLY the replacement text.`
        }
      ]
    }
  ];

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  const deltas = await streamGeminiText({
    model: "gemini-3.1-pro-preview",
    systemInstruction,
    contents,
    safetySettings,
    temperature: 0.8,
  });

  let fullText = "";
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of deltas) {
          if (!chunk?.text || chunk.channel !== "content") continue;
          fullText += chunk.text;
          controller.enqueue(encoder.encode(chunk.text));
        }
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}