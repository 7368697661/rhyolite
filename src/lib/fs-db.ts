import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { init } from "@paralleldrive/cuid2";

const createId = init({ length: 24 });

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.cwd(), ".workspace");
const PROJECT_DIR = process.env.PROJECT_DIR || "";

export async function ensureDir(dirPath: string) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
  }
}

export async function getWorkspaceDir() {
  if (PROJECT_DIR) {
    await ensureDir(PROJECT_DIR);
    return PROJECT_DIR;
  }
  await ensureDir(WORKSPACE_DIR);
  return WORKSPACE_DIR;
}

// ---------------------------------------------------------------------------
// External project registry (known-projects.json)
// Maps project IDs to external directory paths for the "Open Folder" feature.
// ---------------------------------------------------------------------------

type ProjectRegistry = Record<string, string>; // projectId → absolute path

async function loadProjectRegistry(): Promise<ProjectRegistry> {
  try {
    const wDir = PROJECT_DIR || WORKSPACE_DIR;
    await ensureDir(wDir);
    const text = await fs.readFile(path.join(wDir, "known-projects.json"), "utf8");
    return JSON.parse(text) as ProjectRegistry;
  } catch {
    return {};
  }
}

async function saveProjectRegistry(registry: ProjectRegistry): Promise<void> {
  const wDir = PROJECT_DIR || WORKSPACE_DIR;
  await ensureDir(wDir);
  await fs.writeFile(path.join(wDir, "known-projects.json"), JSON.stringify(registry, null, 2));
}

/** Register an external folder as a known project so getProjectDir can find it. */
export async function registerExternalProject(projectId: string, folderPath: string): Promise<void> {
  const registry = await loadProjectRegistry();
  registry[projectId] = folderPath;
  await saveProjectRegistry(registry);
}

/** Look up an external project path from the registry (or null if not registered). */
export async function getExternalProjectPath(projectId: string): Promise<string | null> {
  const registry = await loadProjectRegistry();
  return registry[projectId] ?? null;
}

/** Get all registered external project paths. */
export async function listExternalProjects(): Promise<Array<{ id: string; path: string }>> {
  const registry = await loadProjectRegistry();
  return Object.entries(registry).map(([id, p]) => ({ id, path: p }));
}

async function ensureProjectSubdirs(dir: string): Promise<void> {
  await ensureDir(path.join(dir, "crystals"));
  await ensureDir(path.join(dir, "artifacts"));
  await ensureDir(path.join(dir, "timelines"));
  await ensureDir(path.join(dir, "chats"));
  await ensureDir(path.join(dir, ".rhyolite"));
}

export async function getProjectDir(projectId: string) {
  // Single-project mode: PROJECT_DIR is the project
  if (PROJECT_DIR) {
    await ensureDir(PROJECT_DIR);
    await ensureProjectSubdirs(PROJECT_DIR);
    return PROJECT_DIR;
  }

  // Check if this project is an external folder registered via "Open Folder"
  const externalPath = await getExternalProjectPath(projectId);
  if (externalPath) {
    try {
      const stat = await fs.stat(externalPath);
      if (stat.isDirectory()) {
        await ensureProjectSubdirs(externalPath);
        return externalPath;
      }
    } catch {
      // External path no longer exists — fall through to default
    }
  }

  // Default: nested under WORKSPACE_DIR
  const dir = path.join(await getWorkspaceDir(), projectId);
  await ensureDir(dir);
  await ensureProjectSubdirs(dir);
  return dir;
}

export const generateId = () => createId();

// ---------------------------------------------------------------------------
// Title-based filename helpers
// ---------------------------------------------------------------------------

const INVALID_FILENAME_CHARS = /[\/\\:*?"<>|]/g;

/** Sanitize a title for use as a filename (without extension). */
export function slugifyTitle(title: string): string {
  let slug = title
    .replace(INVALID_FILENAME_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!slug) slug = "untitled";
  if (slug.length > 200) slug = slug.slice(0, 200).trim();
  return slug;
}

// ---------------------------------------------------------------------------
// ID-to-filename cache
// ---------------------------------------------------------------------------

type CacheKey = string; // "projectId:subdir"
const idToFileCache = new Map<CacheKey, Map<string, string>>(); // entityId → filename (no ext)

function cacheKey(projectId: string, subdir: string): CacheKey {
  return `${projectId}:${subdir}`;
}

function getCachedFilename(projectId: string, subdir: string, entityId: string): string | undefined {
  return idToFileCache.get(cacheKey(projectId, subdir))?.get(entityId);
}

function setCachedFilename(projectId: string, subdir: string, entityId: string, filename: string): void {
  const key = cacheKey(projectId, subdir);
  if (!idToFileCache.has(key)) idToFileCache.set(key, new Map());
  idToFileCache.get(key)!.set(entityId, filename);
}

function removeCachedFilename(projectId: string, subdir: string, entityId: string): void {
  idToFileCache.get(cacheKey(projectId, subdir))?.delete(entityId);
}

function invalidateCache(projectId: string, subdir: string): void {
  idToFileCache.delete(cacheKey(projectId, subdir));
}

/**
 * Recursively collect all .md files under a directory.
 * Returns paths relative to `baseDir` (without .md extension) paired with absolute paths.
 */
async function collectMdFiles(baseDir: string, rel: string = ""): Promise<Array<{ relStem: string; absPath: string }>> {
  const results: Array<{ relStem: string; absPath: string }> = [];
  const currentDir = rel ? path.join(baseDir, rel) : baseDir;
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...await collectMdFiles(baseDir, entryRel));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push({ relStem: entryRel.replace(/\.md$/, ""), absPath: path.join(currentDir, entry.name) });
    }
  }
  return results;
}

/**
 * Derive a deterministic folder ID from a file's relative path and its parent subdir.
 * E.g. relStem "03_Locai/Ur" in subdir "artifacts" → "artifacts:03_Locai"
 */
function dirFolderIdFromRelStem(relStem: string, subdir: string): string | null {
  const slashIdx = relStem.lastIndexOf("/");
  if (slashIdx < 0) return null;
  const dirPart = relStem.substring(0, slashIdx);
  return `${subdir}:${dirPart}`;
}

/** Scan a directory (recursively) of .md files and build the id→filename cache. Returns all parsed entries. */
async function scanMdDirectory<T>(
  dirPath: string,
  projectId: string,
  subdir: string,
  parser: (id: string, projectId: string, data: Record<string, any>, content: string) => T | null
): Promise<T[]> {
  const key = cacheKey(projectId, subdir);
  const cache = new Map<string, string>();
  const results: T[] = [];

  const mdFiles = await collectMdFiles(dirPath);

  for (const { relStem, absPath } of mdFiles) {
    try {
      const text = await fs.readFile(absPath, "utf8");
      const { data, content } = matter(text);
      // Use frontmatter id if present, otherwise fall back to relative path stem (legacy/Obsidian compat)
      const id = data.id || relStem;
      cache.set(id, relStem);
      // Auto-derive folderId from directory structure if not already set
      if (!data.folderId) {
        const dirFolder = dirFolderIdFromRelStem(relStem, subdir);
        if (dirFolder) data.folderId = dirFolder;
      }
      const parsed = parser(id, projectId, data, content);
      if (parsed) results.push(parsed);
    } catch {
      continue;
    }
  }

  idToFileCache.set(key, cache);
  return results;
}

/**
 * Resolve an entity ID to a relative path (without .md) in the given directory.
 * Uses cache if available, otherwise does a recursive scan.
 */
async function resolveFilename(projectId: string, subdir: string, entityId: string): Promise<string | null> {
  const cached = getCachedFilename(projectId, subdir, entityId);
  if (cached !== undefined) return cached;

  const pDir = await getProjectDir(projectId);
  const dirPath = path.join(pDir, subdir);
  const mdFiles = await collectMdFiles(dirPath);

  for (const { relStem, absPath } of mdFiles) {
    try {
      const text = await fs.readFile(absPath, "utf8");
      const { data } = matter(text);
      const effectiveId = data.id || relStem;
      if (effectiveId === entityId) {
        setCachedFilename(projectId, subdir, entityId, relStem);
        return relStem;
      }
    } catch {
      continue;
    }
  }
  return null;
}

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

export interface FsTemplate {
  name: string;
  filename: string;
  content: string;
  frontmatter: Record<string, any>;
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
  /** Persisted model reasoning / thinking trace when the client requested it. */
  reasoningContent?: string;
  /** Tool calls executed during this model turn (agent/plan mode). */
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    ok: boolean;
    confirmed?: boolean;
  }>;
  /** Errors that occurred during this agent turn (persisted for history). */
  errors?: Array<{ code: string; message: string }>;
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

// Global project store reads — supports .rhyolite/project.json and legacy project.json

function projectJsonPaths(pDir: string): string[] {
  return [
    path.join(pDir, ".rhyolite", "project.json"),
    path.join(pDir, "project.json"), // legacy fallback
  ];
}

export async function readProject(projectId: string): Promise<FsProject | null> {
  const pDir = await getProjectDir(projectId);
  for (const p of projectJsonPaths(pDir)) {
    try {
      const text = await fs.readFile(p, "utf8");
      return JSON.parse(text) as FsProject;
    } catch (err: any) {
      if (err.code === "ENOENT") continue;
      throw err;
    }
  }
  return null;
}

export async function writeProject(project: FsProject): Promise<void> {
  const pDir = await getProjectDir(project.id);
  const rhyoliteDir = path.join(pDir, ".rhyolite");
  await ensureDir(rhyoliteDir);
  await fs.writeFile(path.join(rhyoliteDir, "project.json"), JSON.stringify(project, null, 2));
  // Clean up legacy location if it exists
  try { await fs.unlink(path.join(pDir, "project.json")); } catch { /* fine */ }
}

export async function listProjects(): Promise<FsProject[]> {
  if (PROJECT_DIR) {
    const p = await readProject("__single__");
    return p ? [p] : [];
  }
  const seenIds = new Set<string>();
  const projects: FsProject[] = [];

  // 1. Scan WORKSPACE_DIR for inline projects
  const wDir = await getWorkspaceDir();
  const entries = await fs.readdir(wDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const p = await readProject(entry.name);
      if (p) {
        seenIds.add(p.id);
        projects.push(p);
      }
    }
  }

  // 2. Include registered external projects
  const externals = await listExternalProjects();
  for (const ext of externals) {
    if (seenIds.has(ext.id)) continue;
    try {
      const stat = await fs.stat(ext.path);
      if (!stat.isDirectory()) continue;
    } catch { continue; }
    const p = await readProject(ext.id);
    if (p) {
      seenIds.add(p.id);
      projects.push(p);
    }
  }

  return projects;
}

/** Recursively collect subdirectory relative paths under baseDir. */
async function collectSubdirs(baseDir: string, rel: string = ""): Promise<string[]> {
  const results: string[] = [];
  const currentDir = rel ? path.join(baseDir, rel) : baseDir;
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      results.push(entryRel);
      results.push(...await collectSubdirs(baseDir, entryRel));
    }
  }
  return results;
}

/**
 * Derive folders from the actual filesystem subdirectories inside crystals/ and artifacts/.
 * Each subdirectory becomes an FsFolder with a deterministic ID like "artifacts:03_Locai".
 */
export async function readFolders(projectId: string): Promise<FsFolder[]> {
  const pDir = await getProjectDir(projectId);
  const folders: FsFolder[] = [];
  const now = new Date().toISOString();

  const subdirConfigs: Array<{ dir: string; prefix: string; type: "document" | "wiki" }> = [
    { dir: "crystals", prefix: "crystals", type: "document" },
    { dir: "artifacts", prefix: "artifacts", type: "wiki" },
  ];

  for (const cfg of subdirConfigs) {
    const baseDir = path.join(pDir, cfg.dir);
    const subdirs = await collectSubdirs(baseDir);
    for (const rel of subdirs) {
      const folderId = `${cfg.prefix}:${rel}`;
      const slashIdx = rel.lastIndexOf("/");
      const parentRel = slashIdx >= 0 ? rel.substring(0, slashIdx) : null;
      const parentId = parentRel ? `${cfg.prefix}:${parentRel}` : null;
      const dirName = slashIdx >= 0 ? rel.substring(slashIdx + 1) : rel;
      folders.push({
        id: folderId,
        projectId,
        title: dirName,
        parentId,
        type: cfg.type,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return folders;
}

/** Create a filesystem-backed folder by creating the actual directory. */
export async function createFsFolder(
  projectId: string,
  name: string,
  type: "document" | "wiki",
  parentId?: string | null,
): Promise<FsFolder> {
  const pDir = await getProjectDir(projectId);
  const subdir = type === "document" ? "crystals" : "artifacts";
  let relDir: string;

  if (parentId && parentId.startsWith(`${subdir}:`)) {
    const parentRel = parentId.substring(subdir.length + 1);
    relDir = `${parentRel}/${name}`;
  } else {
    relDir = name;
  }

  await ensureDir(path.join(pDir, subdir, relDir));
  const now = new Date().toISOString();
  return {
    id: `${subdir}:${relDir}`,
    projectId,
    title: name,
    parentId: parentId || null,
    type,
    createdAt: now,
    updatedAt: now,
  };
}

/** Rename a filesystem-backed folder by renaming the actual directory. */
export async function renameFsFolder(projectId: string, folderId: string, newName: string): Promise<FsFolder | null> {
  const colonIdx = folderId.indexOf(":");
  if (colonIdx < 0) return null;
  const subdir = folderId.substring(0, colonIdx);
  const relDir = folderId.substring(colonIdx + 1);

  const pDir = await getProjectDir(projectId);
  const baseDir = path.join(pDir, subdir);
  const oldPath = path.join(baseDir, relDir);

  const parentRel = relDir.includes("/") ? relDir.substring(0, relDir.lastIndexOf("/")) : "";
  const newRelDir = parentRel ? `${parentRel}/${newName}` : newName;
  const newPath = path.join(baseDir, newRelDir);

  try {
    await fs.rename(oldPath, newPath);
  } catch {
    return null;
  }

  // Invalidate caches since paths changed
  const cacheSubdir = subdir === "crystals" ? "crystals" : "artifacts";
  idToFileCache.delete(cacheKey(projectId, cacheSubdir));

  const now = new Date().toISOString();
  return {
    id: `${subdir}:${newRelDir}`,
    projectId,
    title: newName,
    parentId: parentRel ? `${subdir}:${parentRel}` : null,
    type: subdir === "crystals" ? "document" : "wiki",
    createdAt: now,
    updatedAt: now,
  };
}

/** Delete a filesystem-backed folder (must be empty or files get moved to parent). */
export async function deleteFsFolder(projectId: string, folderId: string): Promise<boolean> {
  const colonIdx = folderId.indexOf(":");
  if (colonIdx < 0) return false;
  const subdir = folderId.substring(0, colonIdx);
  const relDir = folderId.substring(colonIdx + 1);

  const pDir = await getProjectDir(projectId);
  const dirPath = path.join(pDir, subdir, relDir);

  try {
    const entries = await fs.readdir(dirPath);
    const mdFiles = entries.filter(e => e.endsWith(".md"));
    if (mdFiles.length > 0) {
      // Move files to parent directory
      const parentDir = path.dirname(dirPath);
      for (const f of mdFiles) {
        await fs.rename(path.join(dirPath, f), path.join(parentDir, f));
      }
    }
    // Remove remaining subdirs recursively
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    return false;
  }

  const cacheSubdir = subdir === "crystals" ? "crystals" : "artifacts";
  idToFileCache.delete(cacheKey(projectId, cacheSubdir));
  return true;
}

/** Move a file to a different folder on disk. */
export async function moveFileToFolder(
  projectId: string,
  entityType: "document" | "wiki",
  entityId: string,
  targetFolderId: string | null,
): Promise<boolean> {
  const subdir = entityType === "document" ? "crystals" : "artifacts";
  const resolved = await resolveFilename(projectId, subdir, entityId);
  if (!resolved) return false;

  const pDir = await getProjectDir(projectId);
  const baseDir = path.join(pDir, subdir);
  const oldAbsPath = path.join(baseDir, `${resolved}.md`);
  const filename = resolved.includes("/") ? resolved.substring(resolved.lastIndexOf("/") + 1) : resolved;

  let newRelDir: string;
  if (!targetFolderId) {
    newRelDir = "";
  } else {
    const colonIdx = targetFolderId.indexOf(":");
    if (colonIdx < 0) return false;
    newRelDir = targetFolderId.substring(colonIdx + 1);
  }

  const newAbsPath = path.join(baseDir, newRelDir, `${filename}.md`);
  if (oldAbsPath === newAbsPath) return true;

  try {
    await ensureDir(path.join(baseDir, newRelDir));
    await fs.rename(oldAbsPath, newAbsPath);
  } catch {
    return false;
  }

  // Update cache
  const newRelStem = newRelDir ? `${newRelDir}/${filename}` : filename;
  setCachedFilename(projectId, subdir, entityId, newRelStem);
  return true;
}

/** @deprecated Kept for backward compat — prefer filesystem folders. */
export async function writeFolders(projectId: string, folders: FsFolder[]): Promise<void> {
  const pDir = await getProjectDir(projectId);
  await fs.writeFile(path.join(pDir, "folders.json"), JSON.stringify(folders, null, 2));
}

// Templates — read from _templates/ directory in the project folder

export async function listTemplates(projectId: string): Promise<FsTemplate[]> {
  const pDir = await getProjectDir(projectId);
  const templatesDir = path.join(pDir, "_templates");
  const results: FsTemplate[] = [];

  let files: string[];
  try {
    files = (await fs.readdir(templatesDir)).filter(f => f.endsWith(".md") && !f.startsWith("."));
  } catch {
    return results;
  }

  for (const file of files) {
    try {
      const text = await fs.readFile(path.join(templatesDir, file), "utf8");
      const { data, content } = matter(text);
      const name = file.replace(/\.md$/, "").replace(/_/g, " ");
      results.push({ name, filename: file, content, frontmatter: data });
    } catch {
      continue;
    }
  }
  return results;
}

export async function readTemplate(projectId: string, filename: string): Promise<FsTemplate | null> {
  const pDir = await getProjectDir(projectId);
  const filePath = path.join(pDir, "_templates", filename);
  try {
    const text = await fs.readFile(filePath, "utf8");
    const { data, content } = matter(text);
    const name = filename.replace(/\.md$/, "").replace(/_/g, " ");
    return { name, filename, content, frontmatter: data };
  } catch {
    return null;
  }
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

// Documents (Crystals) — title-based filenames, ID in YAML frontmatter

function titleFromId(id: string): string {
  const last = id.includes("/") ? id.split("/").pop()! : id;
  return last.replace(/[-_]/g, " ");
}

function parseDocument(id: string, projectId: string, data: Record<string, any>, content: string): FsDocument {
  return {
    id,
    projectId,
    content,
    title: data.title || titleFromId(id),
    folderId: data.folderId || null,
    orderIndex: data.orderIndex || 0,
    createdAt: data.createdAt || data.created || new Date().toISOString(),
    updatedAt: data.updatedAt || data.modified || new Date().toISOString(),
  };
}

export async function readDocument(projectId: string, docId: string): Promise<FsDocument | null> {
  try {
    const pDir = await getProjectDir(projectId);
    const crystalsDir = path.join(pDir, "crystals");

    // Try cache-resolved filename first
    const cached = getCachedFilename(projectId, "crystals", docId);
    if (cached !== undefined) {
      try {
        const text = await fs.readFile(path.join(crystalsDir, `${cached}.md`), "utf8");
        const { data, content } = matter(text);
        const effectiveId = data.id || cached;
        if (effectiveId === docId) return parseDocument(docId, projectId, data, content);
      } catch { /* cache stale, fall through */ }
    }

    // Legacy fallback: try {id}.md for backward compat
    try {
      const text = await fs.readFile(path.join(crystalsDir, `${docId}.md`), "utf8");
      const { data, content } = matter(text);
      const effectiveId = data.id || docId;
      if (effectiveId === docId) {
        setCachedFilename(projectId, "crystals", docId, docId);
        return parseDocument(docId, projectId, data, content);
      }
    } catch { /* not found by id-filename either */ }

    // Full recursive scan
    const resolved = await resolveFilename(projectId, "crystals", docId);
    if (!resolved) return null;

    const text = await fs.readFile(path.join(crystalsDir, `${resolved}.md`), "utf8");
    const { data, content } = matter(text);
    return parseDocument(docId, projectId, data, content);
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeDocument(doc: FsDocument): Promise<void> {
  const pDir = await getProjectDir(doc.projectId);
  const crystalsDir = path.join(pDir, "crystals");
  const newSlug = slugifyTitle(doc.title);

  // Resolve existing file — may include subdirectory prefix (e.g. "03_Locai/Ur")
  const oldStem = await resolveFilename(doc.projectId, "crystals", doc.id);
  const dirPrefix = oldStem?.includes("/") ? oldStem.substring(0, oldStem.lastIndexOf("/") + 1) : "";
  const targetSlug = `${dirPrefix}${newSlug}`;
  const newFilePath = path.join(crystalsDir, `${targetSlug}.md`);

  if (oldStem && oldStem !== targetSlug) {
    const oldPath = path.join(crystalsDir, `${oldStem}.md`);
    try { await saveSnapshot(oldPath, path.join(crystalsDir, ".history"), doc.id); } catch { /* non-critical */ }
    try { await fs.unlink(oldPath); } catch { /* non-critical */ }
  } else {
    try { await saveSnapshot(newFilePath, path.join(crystalsDir, ".history"), doc.id); } catch { /* non-critical */ }
  }

  let finalSlug = targetSlug;
  try {
    const existing = await fs.readFile(newFilePath, "utf8");
    const { data } = matter(existing);
    if (data.id && data.id !== doc.id) {
      finalSlug = `${dirPrefix}${newSlug}_${doc.id.slice(0, 6)}`;
    }
  } catch { /* file doesn't exist, no collision */ }

  const finalPath = path.join(crystalsDir, `${finalSlug}.md`);
  await ensureDir(path.dirname(finalPath));
  const fmData = {
    id: doc.id,
    title: doc.title,
    folderId: doc.folderId,
    orderIndex: doc.orderIndex,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  const fileContent = matter.stringify(doc.content, fmData);
  await fs.writeFile(finalPath, fileContent);

  setCachedFilename(doc.projectId, "crystals", doc.id, finalSlug);
  try { await indexEntity(doc.id, doc.projectId, "document"); } catch { /* non-critical */ }
}

export async function deleteDocument(projectId: string, docId: string): Promise<void> {
  const pDir = await getProjectDir(projectId);
  const resolved = await resolveFilename(projectId, "crystals", docId);
  if (resolved) {
    try { await fs.unlink(path.join(pDir, "crystals", `${resolved}.md`)); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  } else {
    // Legacy fallback
    try { await fs.unlink(path.join(pDir, "crystals", `${docId}.md`)); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  }
  removeCachedFilename(projectId, "crystals", docId);
  try { await unindexEntity(docId); } catch { /* non-critical */ }
}

export async function listDocuments(projectId: string): Promise<FsDocument[]> {
  const pDir = await getProjectDir(projectId);
  return scanMdDirectory<FsDocument>(
    path.join(pDir, "crystals"),
    projectId,
    "crystals",
    parseDocument,
  );
}

// WikiEntries (Artifacts) — title-based filenames, ID in YAML frontmatter

function parseWikiEntry(id: string, projectId: string, data: Record<string, any>, content: string): FsWikiEntry {
  const rawAliases = data.aliases;
  const aliases = Array.isArray(rawAliases) ? rawAliases.join(", ") : (rawAliases || "");
  return {
    id,
    projectId,
    content,
    title: data.title || titleFromId(id),
    folderId: data.folderId || null,
    aliases,
    createdAt: data.createdAt || data.created || new Date().toISOString(),
    updatedAt: data.updatedAt || data.modified || new Date().toISOString(),
  };
}

export async function readWikiEntry(projectId: string, wikiId: string): Promise<FsWikiEntry | null> {
  try {
    const pDir = await getProjectDir(projectId);
    const artifactsDir = path.join(pDir, "artifacts");

    const cached = getCachedFilename(projectId, "artifacts", wikiId);
    if (cached !== undefined) {
      try {
        const text = await fs.readFile(path.join(artifactsDir, `${cached}.md`), "utf8");
        const { data, content } = matter(text);
        const effectiveId = data.id || cached;
        if (effectiveId === wikiId) return parseWikiEntry(wikiId, projectId, data, content);
      } catch { /* cache stale, fall through */ }
    }

    // Legacy fallback: try {id}.md
    try {
      const text = await fs.readFile(path.join(artifactsDir, `${wikiId}.md`), "utf8");
      const { data, content } = matter(text);
      const effectiveId = data.id || wikiId;
      if (effectiveId === wikiId) {
        setCachedFilename(projectId, "artifacts", wikiId, wikiId);
        return parseWikiEntry(wikiId, projectId, data, content);
      }
    } catch { /* not found by id-filename either */ }

    // Full recursive scan
    const resolved = await resolveFilename(projectId, "artifacts", wikiId);
    if (!resolved) return null;

    const text = await fs.readFile(path.join(artifactsDir, `${resolved}.md`), "utf8");
    const { data, content } = matter(text);
    return parseWikiEntry(wikiId, projectId, data, content);
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeWikiEntry(wiki: FsWikiEntry): Promise<void> {
  const pDir = await getProjectDir(wiki.projectId);
  const artifactsDir = path.join(pDir, "artifacts");
  const newSlug = slugifyTitle(wiki.title);

  const oldStem = await resolveFilename(wiki.projectId, "artifacts", wiki.id);
  const dirPrefix = oldStem?.includes("/") ? oldStem.substring(0, oldStem.lastIndexOf("/") + 1) : "";
  const targetSlug = `${dirPrefix}${newSlug}`;
  const newFilePath = path.join(artifactsDir, `${targetSlug}.md`);

  if (oldStem && oldStem !== targetSlug) {
    const oldPath = path.join(artifactsDir, `${oldStem}.md`);
    try { await saveSnapshot(oldPath, path.join(artifactsDir, ".history"), wiki.id); } catch { /* non-critical */ }
    try { await fs.unlink(oldPath); } catch { /* non-critical */ }
  } else {
    try { await saveSnapshot(newFilePath, path.join(artifactsDir, ".history"), wiki.id); } catch { /* non-critical */ }
  }

  let finalSlug = targetSlug;
  try {
    const existing = await fs.readFile(newFilePath, "utf8");
    const { data } = matter(existing);
    if (data.id && data.id !== wiki.id) {
      finalSlug = `${dirPrefix}${newSlug}_${wiki.id.slice(0, 6)}`;
    }
  } catch { /* no collision */ }

  const finalPath = path.join(artifactsDir, `${finalSlug}.md`);
  await ensureDir(path.dirname(finalPath));
  const fmData = {
    id: wiki.id,
    title: wiki.title,
    folderId: wiki.folderId,
    aliases: wiki.aliases,
    createdAt: wiki.createdAt,
    updatedAt: wiki.updatedAt,
  };
  const fileContent = matter.stringify(wiki.content, fmData);
  await fs.writeFile(finalPath, fileContent);

  setCachedFilename(wiki.projectId, "artifacts", wiki.id, finalSlug);
  try { await indexEntity(wiki.id, wiki.projectId, "wiki"); } catch { /* non-critical */ }
}

export async function deleteWikiEntry(projectId: string, wikiId: string): Promise<void> {
  const pDir = await getProjectDir(projectId);
  const resolved = await resolveFilename(projectId, "artifacts", wikiId);
  if (resolved) {
    try { await fs.unlink(path.join(pDir, "artifacts", `${resolved}.md`)); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  } else {
    try { await fs.unlink(path.join(pDir, "artifacts", `${wikiId}.md`)); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  }
  removeCachedFilename(projectId, "artifacts", wikiId);
  try { await unindexEntity(wikiId); } catch { /* non-critical */ }
}

export async function listWikiEntries(projectId: string): Promise<FsWikiEntry[]> {
  const pDir = await getProjectDir(projectId);
  return scanMdDirectory<FsWikiEntry>(
    path.join(pDir, "artifacts"),
    projectId,
    "artifacts",
    parseWikiEntry,
  );
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
  /** When false, this glyph is a specialist (sub-agent template) not shown in the comms picker. Default true for backward compat. */
  isSculpter?: boolean;
  /** Optional role label for specialist glyphs (e.g. "researcher", "continuity"). */
  specialistRole?: string;
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
