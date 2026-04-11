import { invoke } from '@tauri-apps/api/core';

export type FsFolder = { id: string; name: string; type: "document" | "wiki" | "timeline"; projectId: string; };
export type FsDocument = { id: string; title: string; content: string; projectId: string; folderId?: string | null; createdAt?: string; updatedAt?: string; };
export type FsWikiEntry = { id: string; title: string; content: string; aliases: string; projectId: string; folderId?: string | null; createdAt?: string; updatedAt?: string; };
export type FsTimelineEvent = { id: string; title: string; description: string; date: string; content?: string; summary?: string; nodeType?: string; tags?: string[]; passFullContent?: boolean; referenceId?: string; referenceType?: string; positionX: number; positionY: number; color?: string | null; };
export type FsEventEdge = { id: string; source: string; target: string; label: string; };
export type FsTimeline = { id: string; title: string; projectId: string; events: FsTimelineEvent[]; edges: FsEventEdge[]; createdAt?: string; updatedAt?: string; };
export type FsGlyph = { id: string; name: string; provider?: string; model: string; temperature: number; outputLength: number; maxOutputTokens?: number; isSculpter: boolean; specialistRole?: string; systemInstruction?: string; role?: string; isCompletionModel?: boolean; isPolisherEngine?: boolean; pipeline?: string[]; };

export type FsChatMessage = {
    id: string;
    role: "user" | "model" | "assistant";
    content: string;
    reasoningContent?: string;
    toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: unknown; ok: boolean; confirmed?: boolean; expanded?: boolean; }>;
    errors?: Array<{ code: string; message: string; detail?: string }>;
    createdAt: string;
    parentMessageId?: string | null;
};

export type FsChat = {
    id: string;
    projectId: string;
    title: string;
    glyphId?: string;
    documentId?: string;
    timelineId?: string;
    activeTipMessageId?: string;
    messages: FsChatMessage[];
    updatedAt: string;
};

export type FsProject = { id: string; name: string; storyOutline: string; loreBible: string; };

export async function listProjects(): Promise<FsProject[]> {
    return invoke('list_projects');
}

export async function readProject(projectId: string): Promise<FsProject> {
    return invoke('read_project', { projectId });
}

export async function updateProject(project: FsProject): Promise<void> {
    await invoke('update_project', { project });
}

export async function readDocuments(projectId: string): Promise<FsDocument[]> {
    return invoke('list_documents', { projectId });
}

export async function listDocuments(projectId: string): Promise<FsDocument[]> {
    return invoke('list_documents', { projectId });
}

export async function readDocument(projectId: string, id: string): Promise<FsDocument | null> {
    const docs = await listDocuments(projectId);
    return docs.find(d => d.id === id || d.title === id) || null;
}

export async function writeDocument(projectId: string, doc: Partial<FsDocument>): Promise<FsDocument> {
    await invoke('update_document', { projectId, id: doc.id || doc.title, title: doc.title, content: doc.content || "" });
    return doc as FsDocument;
}

export async function listWikiEntries(projectId: string): Promise<FsWikiEntry[]> {
    return invoke('list_wiki_entries', { projectId });
}

export async function readWikiEntry(projectId: string, id: string): Promise<FsWikiEntry | null> {
    const wikis = await listWikiEntries(projectId);
    return wikis.find(w => w.id === id || w.title === id) || null;
}

export async function writeWikiEntry(projectId: string, wiki: Partial<FsWikiEntry>): Promise<FsWikiEntry> {
    await invoke('update_wiki_entry', { projectId, id: wiki.id || wiki.title, title: wiki.title, content: wiki.content || "" });
    return wiki as FsWikiEntry;
}

export async function deleteWikiEntry(projectId: string, id: string): Promise<void> {
    await invoke('delete_file', { projectId, id, type: 'wiki' });
}

export async function deleteDocument(projectId: string, id: string): Promise<void> {
    await invoke('delete_file', { projectId, id, type: 'document' });
}

export async function listChats(projectId: string): Promise<FsChat[]> {
    return invoke('list_chats', { projectId });
}

export async function readChat(projectId: string, id: string): Promise<FsChat | null> {
    return invoke('read_chat', { projectId, id });
}

export async function writeChat(projectId: string, chat: FsChat): Promise<void> {
    await invoke('write_chat', { projectId, chat });
}

export async function listTimelines(projectId: string): Promise<FsTimeline[]> {
    return invoke('list_timelines', { projectId });
}

export async function readTimeline(projectId: string, id: string): Promise<FsTimeline | null> {
    return invoke('read_timeline', { projectId, id });
}

export async function writeTimeline(projectId: string, timeline: FsTimeline): Promise<void> {
    await invoke('write_timeline', { projectId, timeline });
}

export async function readGlyphs(): Promise<FsGlyph[]> {
    return invoke('list_glyphs');
}

export async function getGlyph(id: string): Promise<FsGlyph | null> {
    const glyphs = await readGlyphs();
    return glyphs.find(g => g.id === id) || null;
}

export function generateId(): string {
    return Math.random().toString(36).substring(2, 9);
}

export async function listTemplates(projectId: string): Promise<{ name: string; filename: string; content: string; frontmatter: Record<string, unknown> }[]> {
    try {
        return await invoke('list_templates', { projectId });
    } catch {
        return [];
    }
}

