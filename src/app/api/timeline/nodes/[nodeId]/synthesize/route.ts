import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { buildTimelineDagRagFragment } from "@/lib/timelineDagContext";
import { findNodeScope } from "../../scope";
import { saveTimelineScope } from "../../../resolveScope";
import { readWikiEntry } from "@/lib/fs-db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  try {
    const { nodeId } = await params;
    
    const scope = await findNodeScope(nodeId);
    if (!scope) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    const node = scope.node;

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

    const systemInstruction = `You are a logical synthesis engine for a Directed Acyclic Graph (DAG) system.
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

    const promptText = `
${ragContext}

Please synthesize the content and summary for the Active Node: [${node.nodeType || "Event"}] "${node.title}".
`;

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
