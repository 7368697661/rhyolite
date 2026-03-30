import {
  lookupEntity,
  indexEntity,
  readDocument,
  readWikiEntry,
  readChat,
  readTimeline,
  listProjects,
  listDocuments,
  listWikiEntries,
  listChats,
  listTimelines,
  type FsDocument,
  type FsWikiEntry,
  type FsChat,
  type FsTimeline,
  type EntityType,
} from "@/lib/fs-db";

/**
 * Tries an indexed O(1) lookup first; on miss, falls back to a full scan
 * and self-heals the index for future calls.
 */
async function resolveWithFallback<T>(
  entityId: string,
  expectedType: EntityType,
  directRead: (projectId: string, id: string) => Promise<T | null>,
  scanAll: () => Promise<{ projectId: string; entity: T } | null>,
): Promise<{ projectId: string; entity: T } | null> {
  const entry = await lookupEntity(entityId);

  if (entry) {
    const entity = await directRead(entry.projectId, entityId);
    if (entity) return { projectId: entry.projectId, entity };
    // Index was stale — fall through to scan
  }

  const result = await scanAll();
  if (result) {
    await indexEntity(entityId, result.projectId, expectedType);
  }
  return result;
}

export async function resolveDocumentScope(
  docId: string,
): Promise<{ projectId: string; doc: FsDocument } | null> {
  const result = await resolveWithFallback<FsDocument>(
    docId,
    "document",
    readDocument,
    async () => {
      const projects = await listProjects();
      for (const p of projects) {
        const docs = await listDocuments(p.id);
        const doc = docs.find((d) => d.id === docId);
        if (doc) return { projectId: p.id, entity: doc };
      }
      return null;
    },
  );
  return result ? { projectId: result.projectId, doc: result.entity } : null;
}

export async function resolveWikiScope(
  wikiId: string,
): Promise<{ projectId: string; wiki: FsWikiEntry } | null> {
  const result = await resolveWithFallback<FsWikiEntry>(
    wikiId,
    "wiki",
    readWikiEntry,
    async () => {
      const projects = await listProjects();
      for (const p of projects) {
        const entries = await listWikiEntries(p.id);
        const wiki = entries.find((w) => w.id === wikiId);
        if (wiki) return { projectId: p.id, entity: wiki };
      }
      return null;
    },
  );
  return result ? { projectId: result.projectId, wiki: result.entity } : null;
}

export async function resolveChatScope(
  chatId: string,
): Promise<{ projectId: string; chat: FsChat } | null> {
  const result = await resolveWithFallback<FsChat>(
    chatId,
    "chat",
    readChat,
    async () => {
      const projects = await listProjects();
      for (const p of projects) {
        const chats = await listChats(p.id);
        const chat = chats.find((c) => c.id === chatId);
        if (chat) return { projectId: p.id, entity: chat };
      }
      return null;
    },
  );
  return result ? { projectId: result.projectId, chat: result.entity } : null;
}

export async function resolveTimelineScope(
  timelineId: string,
): Promise<{ projectId: string; timeline: FsTimeline } | null> {
  const result = await resolveWithFallback<FsTimeline>(
    timelineId,
    "timeline",
    readTimeline,
    async () => {
      const projects = await listProjects();
      for (const p of projects) {
        const timelines = await listTimelines(p.id);
        const timeline = timelines.find((t) => t.id === timelineId);
        if (timeline) return { projectId: p.id, entity: timeline };
      }
      return null;
    },
  );
  return result ? { projectId: result.projectId, timeline: result.entity } : null;
}
