import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import { getProjectDir, listDocuments, listWikiEntries } from "./fs-db";

const EMBEDDING_MODEL = "text-embedding-004";

interface EmbeddingEntry {
  id: string;
  type: "document" | "wiki";
  title: string;
  vector: number[];
  contentHash: string;
}

interface EmbeddingIndex {
  version: 1;
  entries: Record<string, EmbeddingEntry>;
}

function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

async function getEmbeddingIndexPath(projectId: string): Promise<string> {
  const pDir = await getProjectDir(projectId);
  return path.join(pDir, "embeddings.json");
}

async function loadIndex(projectId: string): Promise<EmbeddingIndex> {
  try {
    const text = await fs.readFile(await getEmbeddingIndexPath(projectId), "utf8");
    return JSON.parse(text) as EmbeddingIndex;
  } catch {
    return { version: 1, entries: {} };
  }
}

async function saveIndex(projectId: string, index: EmbeddingIndex): Promise<void> {
  await fs.writeFile(await getEmbeddingIndexPath(projectId), JSON.stringify(index));
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  return new GoogleGenAI({ apiKey });
}

async function embedText(text: string): Promise<number[]> {
  const ai = getClient();
  const truncated = text.slice(0, 8000);
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [{ role: "user", parts: [{ text: truncated }] }],
  });
  return (result as any).embeddings?.[0]?.values
    ?? (result as any).embedding?.values
    ?? [];
}

/**
 * Re-embeds all documents and wiki entries for a project.
 * Skips entries whose content hasn't changed (by hash).
 */
export async function updateProjectEmbeddings(projectId: string): Promise<{ updated: number; total: number }> {
  const [documents, wikiEntries] = await Promise.all([
    listDocuments(projectId),
    listWikiEntries(projectId),
  ]);

  const index = await loadIndex(projectId);
  let updated = 0;

  const items: Array<{ key: string; id: string; type: "document" | "wiki"; title: string; content: string }> = [
    ...documents.map((d) => ({ key: `doc:${d.id}`, id: d.id, type: "document" as const, title: d.title, content: d.content })),
    ...wikiEntries.map((w) => ({ key: `wiki:${w.id}`, id: w.id, type: "wiki" as const, title: w.title, content: w.content })),
  ];

  const validKeys = new Set(items.map((i) => i.key));
  for (const k of Object.keys(index.entries)) {
    if (!validKeys.has(k)) delete index.entries[k];
  }

  for (const item of items) {
    const textToEmbed = `${item.title}\n${item.content}`;
    const hash = simpleHash(textToEmbed);
    const existing = index.entries[item.key];
    if (existing && existing.contentHash === hash && existing.vector.length > 0) continue;

    try {
      const vector = await embedText(textToEmbed);
      index.entries[item.key] = {
        id: item.id,
        type: item.type,
        title: item.title,
        vector,
        contentHash: hash,
      };
      updated++;
    } catch {
      // Skip entries that fail to embed
    }
  }

  await saveIndex(projectId, index);
  return { updated, total: items.length };
}

/**
 * Embeds a single entry and updates the index. Called on save of a document or wiki entry.
 */
export async function embedSingleEntry(
  projectId: string,
  entryId: string,
  type: "document" | "wiki",
  title: string,
  content: string
): Promise<void> {
  const key = type === "document" ? `doc:${entryId}` : `wiki:${entryId}`;
  const textToEmbed = `${title}\n${content}`;
  const hash = simpleHash(textToEmbed);

  const index = await loadIndex(projectId);
  const existing = index.entries[key];
  if (existing && existing.contentHash === hash && existing.vector.length > 0) return;

  try {
    const vector = await embedText(textToEmbed);
    index.entries[key] = { id: entryId, type, title, vector, contentHash: hash };
    await saveIndex(projectId, index);
  } catch {
    // Silently skip — keyword fallback still works
  }
}

export interface RetrievalResult {
  id: string;
  type: "document" | "wiki";
  title: string;
  score: number;
}

/**
 * Retrieves the top-K most similar entries for a given query.
 * Falls back to empty array if embeddings aren't available.
 */
export async function retrieveSimilar(
  projectId: string,
  query: string,
  topK: number = 8
): Promise<RetrievalResult[]> {
  const index = await loadIndex(projectId);
  const entries = Object.values(index.entries);
  if (entries.length === 0) return [];

  let queryVector: number[];
  try {
    queryVector = await embedText(query);
  } catch {
    return [];
  }

  if (queryVector.length === 0) return [];

  const scored = entries
    .filter((e) => e.vector.length > 0)
    .map((e) => ({ ...e, score: cosineSimilarity(queryVector, e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter((e) => e.score > 0.3);

  return scored.map((e) => ({ id: e.id, type: e.type, title: e.title, score: e.score }));
}
