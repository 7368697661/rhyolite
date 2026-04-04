import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { buildTimelineDagRagFragment } from "@/lib/timelineDagContext";
import { findNodeScope } from "../../scope";
import { saveTimelineScope } from "../../../resolveScope";
import { readWikiEntry, readTemplate } from "@/lib/fs-db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  try {
    const { nodeId } = await params;
    const body = await request.json().catch(() => ({}));
    const templateFilename = body?.templateFilename as string | undefined;

    const scope = await findNodeScope(nodeId);
    if (!scope) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    const node = scope.node;

    // Load template if specified
    let templateContent: string | null = null;
    if (templateFilename) {
      const tmpl = await readTemplate(scope.projectId, templateFilename);
      if (tmpl) {
        const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13) + "Z";
        templateContent = tmpl.content
          .replace(/\{\{title\}\}/g, node.title)
          .replace(/\{\{date:[^}]+\}\}/g, now)
          .replace(/\{\{author\}\}/g, "Rhyolite");
      }
    }

    // Build the DAG RAG Fragment
    const ragContext = await buildTimelineDagRagFragment(nodeId);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not set" },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    let systemInstruction: string;
    if (templateContent) {
      systemInstruction = `You are a worldbuilding lorekeeper and synthesis engine for a DAG system.
You will be given upstream DAG context and a template to follow.
Your job is to:
1. Analyze the upstream nodes and their relationships.
2. Fill in the provided template with rich, specific content derived from the upstream context.
3. Replace all HTML comments (<!-- ... -->) with actual content.
4. Keep all relevant sections; remove sections that don't apply.
5. Use [[Entity Name]] wikilinks when referencing other entities.

Provide your response strictly as a JSON object with two keys:
{
  "content": "The fully filled-in template content in markdown.",
  "summary": "A concise 1-3 sentence summary."
}
Do NOT wrap the JSON in markdown code blocks. Just return the raw JSON string.`;
    } else {
      systemInstruction = `You are a logical synthesis engine for a Directed Acyclic Graph (DAG) system.
Your job is to read the upstream DAG logic, analyze the relationship chains, and synthesize the content and summary for the target node.
You will be provided with:
1. The Target Node's Title and Node Type.
2. Upstream Context (details of nodes leading to this one).
3. Logical Relationships (how upstream nodes connect).

Based *only* on the upstream logic provided, auto-synthesize the content for this node.
Provide your response strictly as a JSON object with two keys:
{
  "content": "Detailed, full-length prose, logic derivation, or code block resolving the upstream chains into this node's purpose.",
  "summary": "A concise 1-3 sentence summary of the content."
}
Do NOT wrap the JSON in markdown code blocks. Just return the raw JSON string.`;
    }

    let promptText: string;
    if (templateContent) {
      promptText = `
${ragContext}

Use the following template to structure the content for the Active Node: [${node.nodeType || "Event"}] "${node.title}".

--- TEMPLATE ---
${templateContent}
--- END TEMPLATE ---

Fill in every section of the template with content derived from the upstream DAG context. Be specific, creative, and consistent with the established lore.
`;
    } else {
      promptText = `
${ragContext}

Please synthesize the content and summary for the Active Node: [${node.nodeType || "Event"}] "${node.title}".
`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
      }
    });

    const responseText = response.text;
    if (!responseText) {
      return NextResponse.json({ error: "Empty LLM response" }, { status: 500 });
    }

    let parsed: { content: string; summary: string };
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      return NextResponse.json({ error: "Failed to parse LLM response as JSON", text: responseText }, { status: 500 });
    }

    node.content = parsed.content;
    node.summary = parsed.summary;

    await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);

    const tags = [];
    for (const tagId of node.tags || []) {
      const w = await readWikiEntry(scope.projectId, tagId);
      if (w) tags.push({ id: w.id, title: w.title });
    }

    return NextResponse.json({ ...node, tags });
  } catch (error: any) {
    console.error("Auto-synthesize error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
