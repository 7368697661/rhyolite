import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { init } from "@paralleldrive/cuid2";

const createId = init({ length: 24 });

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.cwd(), ".workspace");

export async function ensureDir(dirPath: string) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
  }
}

export async function getWorkspaceDir() {
  await ensureDir(WORKSPACE_DIR);
  return WORKSPACE_DIR;
}

export async function getProjectDir(projectId: string) {
  const dir = path.join(await getWorkspaceDir(), projectId);
  await ensureDir(dir);
  await ensureDir(path.join(dir, "crystals"));
  await ensureDir(path.join(dir, "artifacts"));
  await ensureDir(path.join(dir, "timelines"));
  await ensureDir(path.join(dir, "chats"));
  return dir;
}

export const generateId = () => createId();

// Types
export interface FsProject {
  id: string;
  title: string;
  loreBible: string;
  storyOutline: string;
  createdAt: string;
  updatedAt: string;
}

export interface FsFolder {
  id: string;
  projectId: string;
  title: string;
  parentId: string | null;
  /** Sidebar: crystal vs wiki folder */
  type?: "document" | "wiki";
  createdAt: string;
  updatedAt: string;
}

export interface FsDocument {
  id: string;
  title: string;
  content: string;
  projectId: string;
  folderId: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface FsWikiEntry {
  id: string;
  title: string;
  content: string;
  projectId: string;
  folderId: string | null;
  aliases: string;
  createdAt: string;
  updatedAt: string;
}

export interface FsTimelineEvent {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  nodeType: string;
  passFullContent: boolean;
  color: string | null;
  referenceType: string | null;
  referenceId: string | null;
  positionX: number;
  positionY: number;
  timelineId: string | null;
  documentId: string | null; // legacy
  tags: string[]; // array of wikiEntry ids
}

export interface FsEventEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string | null;
}

export interface FsTimeline {
  id: string;
  title: string;
  projectId: string;
  events: FsTimelineEvent[];
  edges: FsEventEdge[];
  createdAt: string;
  updatedAt: string;
}

export interface FsChatMessage {
  id: string;
  chatId: string;
  role: "user" | "model";
  content: string;
  parentMessageId: string | null;
  createdAt: string;
}

export interface FsChat {
  id: string;
  title: string;
  glyphId: string;
  documentId: string | null;
  timelineId: string | null;
  activeTipMessageId: string | null;
  branchChoicesJson: string;
  messages: FsChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// Entity Index — O(1) entity-to-project lookups

export type EntityType = "document" | "wiki" | "folder" | "chat" | "timeline";

interface EntityIndexEntry {
  projectId: string;
  type: EntityType;
}

interface EntityIndex {
  [entityId: string]: EntityIndexEntry;
}

async function loadEntityIndex(): Promise<EntityIndex> {
  try {
    const wDir = await getWorkspaceDir();
    const text = await fs.readFile(path.join(wDir, "entity-index.json"), "utf8");
    return JSON.parse(text) as EntityIndex;
  } catch (err: any) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function saveEntityIndex(index: EntityIndex): Promise<void> {
  const wDir = await getWorkspaceDir();
  await fs.writeFile(path.join(wDir, "entity-index.json"), JSON.stringify(index, null, 2));
}

export async function indexEntity(entityId: string, projectId: string, type: EntityType): Promise<void> {
  const index = await loadEntityIndex();
  index[entityId] = { projectId, type };
  await saveEntityIndex(index);
}

export async function unindexEntity(entityId: string): Promise<void> {
  const index = await loadEntityIndex();
  if (entityId in index) {
    delete index[entityId];
    await saveEntityIndex(index);
  }
}

export async function lookupEntity(entityId: string): Promise<EntityIndexEntry | null> {
  const index = await loadEntityIndex();
  return index[entityId] ?? null;
}

// Global project store reads

export async function readProject(projectId: string): Promise<FsProject | null> {
  try {
    const pDir = await getProjectDir(projectId);
    const text = await fs.readFile(path.join(pDir, "project.json"), "utf8");
    return JSON.parse(text) as FsProject;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeProject(project: FsProject): Promise<void> {
  const pDir = await getProjectDir(project.id);
  await fs.writeFile(path.join(pDir, "project.json"), JSON.stringify(project, null, 2));
}

export async function listProjects(): Promise<FsProject[]> {
  const wDir = await getWorkspaceDir();
  const entries = await fs.readdir(wDir, { withFileTypes: true });
  const projects: FsProject[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const p = await readProject(entry.name);
      if (p) projects.push(p);
    }
  }
  return projects;
}

export async function readFolders(projectId: string): Promise<FsFolder[]> {
  try {
    const pDir = await getProjectDir(projectId);
    const text = await fs.readFile(path.join(pDir, "folders.json"), "utf8");
    return JSON.parse(text) as FsFolder[];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function writeFolders(projectId: string, folders: FsFolder[]): Promise<void> {
  const pDir = await getProjectDir(projectId);
  await fs.writeFile(path.join(pDir, "folders.json"), JSON.stringify(folders, null, 2));
}

// Version History / Snapshots
async function saveSnapshot(
  filePath: string,
  historyDir: string,
  entityId: string,
): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    return;
  }
  const ts = new Date().toISOString().replace(/:/g, "-");
  const destDir = path.join(historyDir, entityId);
  await ensureDir(destDir);
  await fs.copyFile(filePath, path.join(destDir, `${ts}.md`));
}

// Documents (Crystals)
export async function readDocument(projectId: string, docId: string): Promise<FsDocument | null> {
  try {
    const pDir = await getProjectDir(projectId);
    const text = await fs.readFile(path.join(pDir, "crystals", `${docId}.md`), "utf8");
    const { data, content } = matter(text);
    return {
      id: docId,
      projectId,
      content,
      title: data.title || "",
      folderId: data.folderId || null,
      orderIndex: data.orderIndex || 0,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeDocument(doc: FsDocument): Promise<void> {
  const pDir = await getProjectDir(doc.projectId);
  const filePath = path.join(pDir, "crystals", `${doc.id}.md`);
  try { await saveSnapshot(filePath, path.join(pDir, "crystals", ".history"), doc.id); } catch { /* non-critical */ }
  const data = {
    title: doc.title,
    folderId: doc.folderId,
    orderIndex: doc.orderIndex,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  const fileContent = matter.stringify(doc.content, data);
  await fs.writeFile(filePath, fileContent);
  try { await indexEntity(doc.id, doc.projectId, "document"); } catch { /* non-critical */ }
}

export async function deleteDocument(projectId: string, docId: string): Promise<void> {
  const pDir = await getProjectDir(projectId);
  try {
    await fs.unlink(path.join(pDir, "crystals", `${docId}.md`));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  try { await unindexEntity(docId); } catch { /* non-critical */ }
}

export async function listDocuments(projectId: string): Promise<FsDocument[]> {
  const pDir = await getProjectDir(projectId);
  const files = await fs.readdir(path.join(pDir, "crystals"));
  const docs: FsDocument[] = [];
  for (const file of files) {
    if (file.endsWith(".md")) {
      const doc = await readDocument(projectId, file.replace(".md", ""));
      if (doc) docs.push(doc);
    }
  }
  return docs;
}

// WikiEntries (Artifacts)
export async function readWikiEntry(projectId: string, wikiId: string): Promise<FsWikiEntry | null> {
  try {
    const pDir = await getProjectDir(projectId);
    const text = await fs.readFile(path.join(pDir, "artifacts", `${wikiId}.md`), "utf8");
    const { data, content } = matter(text);
    return {
      id: wikiId,
      projectId,
      content,
      title: data.title || "",
      folderId: data.folderId || null,
      aliases: data.aliases || "",
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeWikiEntry(wiki: FsWikiEntry): Promise<void> {
  const pDir = await getProjectDir(wiki.projectId);
  const filePath = path.join(pDir, "artifacts", `${wiki.id}.md`);
  try { await saveSnapshot(filePath, path.join(pDir, "artifacts", ".history"), wiki.id); } catch { /* non-critical */ }
  const data = {
    title: wiki.title,
    folderId: wiki.folderId,
    aliases: wiki.aliases,
    createdAt: wiki.createdAt,
    updatedAt: wiki.updatedAt,
  };
  const fileContent = matter.stringify(wiki.content, data);
  await fs.writeFile(filePath, fileContent);
  try { await indexEntity(wiki.id, wiki.projectId, "wiki"); } catch { /* non-critical */ }
}

export async function deleteWikiEntry(projectId: string, wikiId: string): Promise<void> {
  const pDir = await getProjectDir(projectId);
  try {
    await fs.unlink(path.join(pDir, "artifacts", `${wikiId}.md`));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  try { await unindexEntity(wikiId); } catch { /* non-critical */ }
}

export async function listWikiEntries(projectId: string): Promise<FsWikiEntry[]> {
  const pDir = await getProjectDir(projectId);
  const files = await fs.readdir(path.join(pDir, "artifacts"));
  const entries: FsWikiEntry[] = [];
  for (const file of files) {
    if (file.endsWith(".md")) {
      const entry = await readWikiEntry(projectId, file.replace(".md", ""));
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

// Timelines
export async function readTimeline(projectId: string, timelineId: string): Promise<FsTimeline | null> {
  try {
    const pDir = await getProjectDir(projectId);
    const text = await fs.readFile(path.join(pDir, "timelines", `${timelineId}.json`), "utf8");
    return JSON.parse(text) as FsTimeline;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeTimeline(timeline: FsTimeline): Promise<void> {
  const pDir = await getProjectDir(timeline.projectId);
  await fs.writeFile(path.join(pDir, "timelines", `${timeline.id}.json`), JSON.stringify(timeline, null, 2));
  try { await indexEntity(timeline.id, timeline.projectId, "timeline"); } catch { /* non-critical */ }
}

export async function deleteTimeline(projectId: string, timelineId: string): Promise<void> {
  const pDir = await getProjectDir(projectId);
  try {
    await fs.unlink(path.join(pDir, "timelines", `${timelineId}.json`));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  try { await unindexEntity(timelineId); } catch { /* non-critical */ }
}

export async function listTimelines(projectId: string): Promise<FsTimeline[]> {
  const pDir = await getProjectDir(projectId);
  const files = await fs.readdir(path.join(pDir, "timelines"));
  const timelines: FsTimeline[] = [];
  for (const file of files) {
    if (file.endsWith(".json")) {
      const t = await readTimeline(projectId, file.replace(".json", ""));
      if (t) timelines.push(t);
    }
  }
  return timelines;
}

// Since Document Timelines still exist in legacy (or are deprecated but we need to support scope fetching),
// let's create a "DocumentTimeline" storage for node/edges attached to a document directly.
// We'll store this in `crystals/[docId]_timeline.json`.
export async function readDocumentTimeline(projectId: string, documentId: string): Promise<{ events: FsTimelineEvent[], edges: FsEventEdge[] }> {
  try {
    const pDir = await getProjectDir(projectId);
    const text = await fs.readFile(path.join(pDir, "crystals", `${documentId}_timeline.json`), "utf8");
    return JSON.parse(text);
  } catch (err: any) {
    if (err.code === "ENOENT") return { events: [], edges: [] };
    throw err;
  }
}

export async function writeDocumentTimeline(projectId: string, documentId: string, data: { events: FsTimelineEvent[], edges: FsEventEdge[] }): Promise<void> {
  const pDir = await getProjectDir(projectId);
  await fs.writeFile(path.join(pDir, "crystals", `${documentId}_timeline.json`), JSON.stringify(data, null, 2));
}


// Chats
export async function readChat(projectId: string, chatId: string): Promise<FsChat | null> {
  try {
    const pDir = await getProjectDir(projectId);
    const text = await fs.readFile(path.join(pDir, "chats", `${chatId}.json`), "utf8");
    return JSON.parse(text) as FsChat;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeChat(projectId: string, chat: FsChat): Promise<void> {
  const pDir = await getProjectDir(projectId);
  await fs.writeFile(path.join(pDir, "chats", `${chat.id}.json`), JSON.stringify(chat, null, 2));
  try { await indexEntity(chat.id, projectId, "chat"); } catch { /* non-critical */ }
}

export async function deleteChat(projectId: string, chatId: string): Promise<void> {
  const pDir = await getProjectDir(projectId);
  try {
    await fs.unlink(path.join(pDir, "chats", `${chatId}.json`));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  try { await unindexEntity(chatId); } catch { /* non-critical */ }
}

export async function listChats(projectId: string): Promise<FsChat[]> {
  const pDir = await getProjectDir(projectId);
  const files = await fs.readdir(path.join(pDir, "chats"));
  const chats: FsChat[] = [];
  for (const file of files) {
    if (file.endsWith(".json")) {
      const c = await readChat(projectId, file.replace(".json", ""));
      if (c) chats.push(c);
    }
  }
  return chats;
}

// Prompt Templates
export interface FsPromptTemplate {
  id: string;
  projectId: string;
  name: string;
  template: string;
  createdAt: string;
}

export async function readPromptTemplates(projectId: string): Promise<FsPromptTemplate[]> {
  try {
    const pDir = await getProjectDir(projectId);
    const text = await fs.readFile(path.join(pDir, "prompts.json"), "utf8");
    return JSON.parse(text) as FsPromptTemplate[];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function writePromptTemplates(projectId: string, templates: FsPromptTemplate[]): Promise<void> {
  const pDir = await getProjectDir(projectId);
  await fs.writeFile(path.join(pDir, "prompts.json"), JSON.stringify(templates, null, 2));
}

// In SQLite, Glyph was in the database. In local fs, it might be easiest to keep glyphs in a global `glyphs.json` in the workspace root.
export interface FsGlyph {
  id: string;
  name: string;
  systemInstruction: string;
  provider: "gemini" | "openai" | "anthropic";
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

export async function readGlyphs(): Promise<FsGlyph[]> {
  try {
    const wDir = await getWorkspaceDir();
    const text = await fs.readFile(path.join(wDir, "glyphs.json"), "utf8");
    return JSON.parse(text) as FsGlyph[];
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // Return default glyphs if missing
      const defaults: FsGlyph[] = [
        {
          id: "default-glyph",
          name: "Standard Uplink",
          systemInstruction: "You are a helpful AI assistant running in a cyberpunk terminal environment. Respond concisely.",
          provider: "gemini",
          model: "gemini-2.5-flash",
          temperature: 0.7,
          maxOutputTokens: 2048,
        }
      ];
      await writeGlyphs(defaults);
      return defaults;
    }
    throw err;
  }
}

export async function writeGlyphs(glyphs: FsGlyph[]): Promise<void> {
  const wDir = await getWorkspaceDir();
  await fs.writeFile(path.join(wDir, "glyphs.json"), JSON.stringify(glyphs, null, 2));
}

export async function getGlyph(glyphId: string): Promise<FsGlyph | null> {
  const glyphs = await readGlyphs();
  return glyphs.find((g) => g.id === glyphId) || null;
}
