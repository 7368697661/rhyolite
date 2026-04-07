import { invoke } from '@tauri-apps/api/core';

export interface RetrievalResult {
  id: string;
  type: "document" | "wiki" | "timeline_event";
  title: string;
  score: number;
}

export async function retrieveSimilar(
  projectId: string,
  query: string,
  topK: number = 8
): Promise<RetrievalResult[]> {
  try {
    return await invoke('retrieve_similar', { projectId, query, topK });
  } catch (e) {
    console.error("Failed to retrieve similar", e);
    return [];
  }
}

export async function updateProjectEmbeddings(projectId: string): Promise<{ updated: number; total: number }> {
    try {
        return await invoke('update_project_embeddings', { projectId });
    } catch (e) {
        console.error(e);
        return { updated: 0, total: 0 };
    }
}

export async function embedSingleEntry(
  projectId: string,
  entryId: string,
  type: "document" | "wiki" | "timeline_event",
  title: string,
  content: string
): Promise<void> {
  try {
      await invoke('embed_single_entry', { projectId, entryId, type, title, content });
  } catch (e) {
      console.error(e);
  }
}
