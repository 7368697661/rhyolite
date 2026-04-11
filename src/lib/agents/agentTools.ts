/**
 * Agent tool definitions for comms.
 *
 * Each tool has a provider-neutral schema (JSON-Schema parameters),
 * a risk classification, and an execute() that calls fs-db directly
 * (no HTTP round-trip).
 */

import {
  generateId,
  listWikiEntries,
  readWikiEntry,
  writeWikiEntry,
  deleteWikiEntry,
  readDocument,
  listDocuments,
  listTimelines,
  readTimeline,
  type FsWikiEntry,
  type FsTimelineEvent,
  type FsEventEdge,
  listTemplates,
  readGlyphs,
  getGlyph,
  type FsGlyph,
} from "./fs-db";
import {
  resolveTimelineScope,
  saveTimelineScope,
  findNodeScope
} from "../timeline/resolveScope";
import { retrieveSimilar } from "./embeddings";
import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "safe" | "normal" | "risky";

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

/** Context passed to every tool execute() call. */
export interface ToolContext {
  projectId: string;
  /** Active timeline ID for DAG tools (may be null). */
  timelineId?: string | null;
  /** Active document ID for document tools (may be null). */
  documentId?: string | null;
  /** Active wiki ID for wiki tools (may be null). */
  wikiId?: string | null;
  /** Optional callback for emitting real-time progress. */
  onProgress?: (data: unknown) => void;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentTool {
  schema: ToolSchema;
  riskLevel: RiskLevel;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tokenize a query into individual words (≥2 chars) for OR-matching. */
function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length >= 2);
}

/** Check if text matches a query — first tries exact substring, then requires all tokens present. */
function textMatchesQuery(text: string, queryLower: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(queryLower)) return true;
  if (tokens.length >= 2) {
    return tokens.every((t) => lower.includes(t));
  }
  return false;
}

async function findWikiByTitle(
  projectId: string,
  titleOrId: string
): Promise<FsWikiEntry | null> {
  const direct = await readWikiEntry(projectId, titleOrId);
  if (direct) return direct;
  const all = await listWikiEntries(projectId);
  const lower = titleOrId.toLowerCase();
  return (
    all.find(
      (w) =>
        w.title.toLowerCase() === lower ||
        w.aliases
          .toLowerCase()
          .split(",")
          .map((a) => a.trim())
          .includes(lower)
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Tool: search_artifacts
// ---------------------------------------------------------------------------

const searchArtifacts: AgentTool = {
  schema: {
    name: "search_artifacts",
    description:
      "Search wiki entries and documents by keyword and semantic similarity. Returns titles, IDs, and short snippets. Uses both token-based keyword matching and embedding-based RAG.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  riskLevel: "safe",
  async execute(args, ctx) {
    const query = String(args.query ?? "");
    if (!query) return { ok: false, error: "query is required" };

    const q = query.toLowerCase();
    const tokens = tokenizeQuery(query);
    const seenIds = new Set<string>();
    const results: Array<{ type: string; id: string; title: string; snippet: string }> = [];

    const wikis = await listWikiEntries(ctx.projectId);
    for (const w of wikis) {
      const haystack = `${w.title} ${w.aliases} ${w.content}`;
      if (textMatchesQuery(haystack, q, tokens)) {
        seenIds.add(w.id);
        results.push({ type: "wiki", id: w.id, title: w.title, snippet: w.content.slice(0, 200) });
      }
    }

    const docs = await listDocuments(ctx.projectId);
    for (const d of docs) {
      const haystack = `${d.title} ${d.content}`;
      if (textMatchesQuery(haystack, q, tokens)) {
        seenIds.add(d.id);
        results.push({ type: "document", id: d.id, title: d.title, snippet: d.content.slice(0, 200) });
      }
    }

    try {
      const similar = await retrieveSimilar(ctx.projectId, query, 8);
      for (const hit of similar) {
        if (seenIds.has(hit.id)) continue;
        seenIds.add(hit.id);
        if (hit.type === "wiki") {
          const entry = await readWikiEntry(ctx.projectId, hit.id);
          if (entry) results.push({ type: "wiki", id: entry.id, title: entry.title, snippet: entry.content.slice(0, 200) });
        } else if (hit.type === "document") {
          const doc = await readDocument(ctx.projectId, hit.id);
          if (doc) results.push({ type: "document", id: doc.id, title: doc.title, snippet: doc.content.slice(0, 200) });
        }
      }
    } catch {
      /* embedding retrieval is best-effort */
    }

    return { ok: true, data: results.slice(0, 20) };
  },
};

// ---------------------------------------------------------------------------
// Tool: read_artifact
// ---------------------------------------------------------------------------

const readArtifact: AgentTool = {
  schema: {
    name: "read_artifact",
    description:
      "Read the full content of a wiki/artifact entry by title or ID.",
    parameters: {
      type: "object",
      properties: {
        title_or_id: {
          type: "string",
          description: "Title or ID of the artifact to read",
        },
      },
      required: ["title_or_id"],
    },
  },
  riskLevel: "safe",
  async execute(args, ctx) {
    const key = String(args.title_or_id ?? "");
    if (!key) return { ok: false, error: "title_or_id is required" };
    const entry = await findWikiByTitle(ctx.projectId, key);
    if (!entry) return { ok: false, error: `Artifact not found: ${key}` };
    return {
      ok: true,
      data: {
        id: entry.id,
        title: entry.title,
        content: entry.content,
        aliases: entry.aliases,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Tool: create_artifact
// ---------------------------------------------------------------------------

const createArtifact: AgentTool = {
  schema: {
    name: "create_artifact",
    description:
      "Create a new wiki/artifact entry with title, content, and optional aliases.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title for the artifact" },
        content: {
          type: "string",
          description: "Markdown content for the artifact",
        },
        aliases: {
          type: "string",
          description: "Comma-separated aliases (optional)",
        },
      },
      required: ["title", "content"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const title = String(args.title ?? "").trim();
    const content = String(args.content ?? "");
    if (!title) return { ok: false, error: "title is required" };

    const entry: FsWikiEntry = {
      id: generateId(),
      projectId: ctx.projectId,
      title,
      content,
      aliases: String(args.aliases ?? ""),
      folderId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeWikiEntry(ctx.projectId, entry);
    return { ok: true, data: { id: entry.id, title: entry.title } };
  },
};

// ---------------------------------------------------------------------------
// Tool: update_artifact
// ---------------------------------------------------------------------------

const updateArtifact: AgentTool = {
  schema: {
    name: "update_artifact",
    description:
      "Update an existing wiki/artifact entry. Provide only the fields to change.",
    parameters: {
      type: "object",
      properties: {
        title_or_id: {
          type: "string",
          description: "Current title or ID of the artifact",
        },
        new_title: { type: "string", description: "New title (optional)" },
        content: {
          type: "string",
          description: "New markdown content (optional)",
        },
        aliases: {
          type: "string",
          description: "New comma-separated aliases (optional)",
        },
      },
      required: ["title_or_id"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const key = String(args.title_or_id ?? "");
    if (!key) return { ok: false, error: "title_or_id is required" };
    const entry = await findWikiByTitle(ctx.projectId, key);
    if (!entry) return { ok: false, error: `Artifact not found: ${key}` };

    if (args.new_title != null) entry.title = String(args.new_title);
    if (args.content != null) entry.content = String(args.content);
    if (args.aliases != null) entry.aliases = String(args.aliases);
    entry.updatedAt = new Date().toISOString();

    await writeWikiEntry(ctx.projectId, entry);
    return { ok: true, data: { id: entry.id, title: entry.title } };
  },
};

// ---------------------------------------------------------------------------
// Tool: delete_artifact
// ---------------------------------------------------------------------------

const deleteArtifactTool: AgentTool = {
  schema: {
    name: "delete_artifact",
    description: "Permanently delete a wiki/artifact entry.",
    parameters: {
      type: "object",
      properties: {
        title_or_id: {
          type: "string",
          description: "Title or ID of the artifact to delete",
        },
      },
      required: ["title_or_id"],
    },
  },
  riskLevel: "risky",
  async execute(args, ctx) {
    const key = String(args.title_or_id ?? "");
    if (!key) return { ok: false, error: "title_or_id is required" };
    const entry = await findWikiByTitle(ctx.projectId, key);
    if (!entry) return { ok: false, error: `Artifact not found: ${key}` };
    await deleteWikiEntry(ctx.projectId, entry.id);
    return { ok: true, data: { deleted: entry.title } };
  },
};

// ---------------------------------------------------------------------------
// Tool: read_timeline
// ---------------------------------------------------------------------------

const readTimelineTool: AgentTool = {
  schema: {
    name: "read_timeline",
    description:
      "Read the full timeline graph (events and edges) for the active timeline.",
    parameters: {
      type: "object",
      properties: {
        timeline_id: {
          type: "string",
          description:
            "Timeline ID to read. Omit to use the active timeline.",
        },
      },
    },
  },
  riskLevel: "safe",
  async execute(args, ctx) {
    const tid = String(args.timeline_id ?? ctx.timelineId ?? "");
    if (!tid) return { ok: false, error: "No timeline ID available" };
    const scope = await resolveTimelineScope(ctx.projectId, null, tid);
    if (!scope)
      return { ok: false, error: `Timeline not found: ${tid}` };

    const nodes = scope.data.events.map((e) => ({
      id: e.id,
      title: e.title,
      summary: e.summary,
      nodeType: e.nodeType,
      tags: e.tags,
    }));
    const edges = scope.data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
    }));
    return { ok: true, data: { nodes, edges } };
  },
};

// ---------------------------------------------------------------------------
// Tool: create_timeline_node
// ---------------------------------------------------------------------------

const createTimelineNode: AgentTool = {
  schema: {
    name: "create_timeline_node",
    description: "Add a new event node to the active timeline.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Node title" },
        summary: { type: "string", description: "Brief summary (optional)" },
        content: { type: "string", description: "Full content (optional)" },
        node_type: {
          type: "string",
          description: "Node type (default: Event)",
        },
      },
      required: ["title"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const tid = ctx.timelineId ?? null;
    const did = ctx.documentId ?? null;
    if (!tid && !did) return { ok: false, error: "No active timeline or document" };
    const scope = await resolveTimelineScope(ctx.projectId, did, tid);
    if (!scope) return { ok: false, error: "Timeline scope not found" };

    const maxX = scope.data.events.reduce(
      (m, e) => Math.max(m, e.positionX),
      0
    );

    const node: FsTimelineEvent = {
      id: generateId(),
      title: String(args.title ?? ""),
      description: "",
      date: new Date().toISOString(),
      summary: args.summary != null ? String(args.summary) : undefined,
      content: args.content != null ? String(args.content) : undefined,
      nodeType: String(args.node_type ?? "Event"),
      color: undefined,
      referenceType: undefined,
      referenceId: undefined,
      positionX: maxX + 250,
      positionY: 100,
      tags: [],
    };

    scope.data.events.push(node);
    await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);
    return { ok: true, data: { id: node.id, title: node.title } };
  },
};

// ---------------------------------------------------------------------------
// Tool: update_timeline_node
// ---------------------------------------------------------------------------

const updateTimelineNode: AgentTool = {
  schema: {
    name: "update_timeline_node",
    description:
      "Update an existing timeline node. Provide only the fields to change.",
    parameters: {
      type: "object",
      properties: {
        node_id: { type: "string", description: "ID of the node" },
        title: { type: "string", description: "New title (optional)" },
        summary: { type: "string", description: "New summary (optional)" },
        content: { type: "string", description: "New content (optional)" },
        tags: {
          type: "array",
          description: "Array of wiki entry IDs to tag (optional)",
          items: { type: "string" },
        },
      },
      required: ["node_id"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const nodeId = String(args.node_id ?? "");
    if (!nodeId) return { ok: false, error: "node_id is required" };
    const scope = await findNodeScope(ctx.projectId, nodeId);
    if (!scope) return { ok: false, error: `Node not found: ${nodeId}` };

    const node = scope.node;
    if (args.title != null) node.title = String(args.title);
    if (args.summary != null) node.summary = String(args.summary);
    if (args.content != null) node.content = String(args.content);
    if (Array.isArray(args.tags)) node.tags = args.tags.map(String);

    await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);
    return { ok: true, data: { id: node.id, title: node.title } };
  },
};

// ---------------------------------------------------------------------------
// Tool: delete_timeline_node
// ---------------------------------------------------------------------------

const deleteTimelineNode: AgentTool = {
  schema: {
    name: "delete_timeline_node",
    description:
      "Permanently delete a timeline node and all edges connected to it.",
    parameters: {
      type: "object",
      properties: {
        node_id: { type: "string", description: "ID of the node to delete" },
      },
      required: ["node_id"],
    },
  },
  riskLevel: "risky",
  async execute(args, ctx) {
    const nodeId = String(args.node_id ?? "");
    if (!nodeId) return { ok: false, error: "node_id is required" };
    const scope = await findNodeScope(ctx.projectId, nodeId);
    if (!scope) return { ok: false, error: `Node not found: ${nodeId}` };

    const title = scope.node.title;
    scope.data.events = scope.data.events.filter((e) => e.id !== nodeId);
    scope.data.edges = scope.data.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId
    );
    await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);
    return { ok: true, data: { deleted: title } };
  },
};

// ---------------------------------------------------------------------------
// Layout helper: layered DAG layout (Sugiyama-style)
// ---------------------------------------------------------------------------

const LAYER_GAP_X = 280;
const SIBLING_GAP_Y = 180;

/**
 * Reposition all nodes in a timeline using a layered DAG layout.
 * - Assigns layers via longest-path from root nodes (BFS)
 * - Spreads siblings vertically within each layer
 * - Lays out left-to-right (layer = X, position within layer = Y)
 */
function layoutDagNodes(
  events: { id: string; positionX: number; positionY: number }[],
  edges: { source: string; target: string }[]
): void {
  if (events.length === 0) return;

  const nodeIds = new Set(events.map((e) => e.id));
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const id of nodeIds) {
    children.set(id, []);
    parents.set(id, []);
  }
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      children.get(edge.source)!.push(edge.target);
      parents.get(edge.target)!.push(edge.source);
    }
  }

  const roots = [...nodeIds].filter((id) => parents.get(id)!.length === 0);
  if (roots.length === 0) roots.push(events[0].id);

  // Assign layers via BFS (longest path from any root)
  const layer = new Map<string, number>();
  const queue: string[] = [...roots];
  for (const r of roots) layer.set(r, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layer.get(current)!;
    for (const child of children.get(current) ?? []) {
      const existing = layer.get(child) ?? -1;
      if (currentLayer + 1 > existing) {
        layer.set(child, currentLayer + 1);
        queue.push(child);
      }
    }
  }

  for (const e of events) {
    if (!layer.has(e.id)) layer.set(e.id, 0);
  }

  // Group by layer and position
  const layers = new Map<number, string[]>();
  for (const [id, l] of layer) {
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(id);
  }

  const maxLayer = Math.max(...layers.keys(), 0);
  const nodeMap = new Map(events.map((e) => [e.id, e]));

  for (let l = 0; l <= maxLayer; l++) {
    const nodesInLayer = layers.get(l) ?? [];
    const totalHeight = nodesInLayer.length * SIBLING_GAP_Y;
    const startY = Math.max(50, 50 + (totalHeight > 0 ? -totalHeight / 2 + SIBLING_GAP_Y / 2 : 0));

    for (let i = 0; i < nodesInLayer.length; i++) {
      const node = nodeMap.get(nodesInLayer[i]);
      if (node) {
        node.positionX = 50 + l * LAYER_GAP_X;
        node.positionY = startY + i * SIBLING_GAP_Y;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tool: create_edge
// ---------------------------------------------------------------------------

const createEdge: AgentTool = {
  schema: {
    name: "create_edge",
    description: "Create a directed edge between two timeline nodes.",
    parameters: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "Source node ID" },
        target_id: { type: "string", description: "Target node ID" },
        label: { type: "string", description: "Edge label (optional)" },
      },
      required: ["source_id", "target_id"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const sourceId = String(args.source_id ?? "");
    const targetId = String(args.target_id ?? "");
    if (!sourceId || !targetId)
      return { ok: false, error: "source_id and target_id are required" };

    const scope = await findNodeScope(ctx.projectId, sourceId);
    if (!scope) return { ok: false, error: `Source node not found: ${sourceId}` };
    if (!scope.data.events.some((e) => e.id === targetId))
      return { ok: false, error: `Target node not in same timeline: ${targetId}` };

    const edge: FsEventEdge = {
      id: generateId(),
      source: sourceId,
      target: targetId,
      label: args.label != null ? String(args.label) : "",
    };
    scope.data.edges.push(edge);
    layoutDagNodes(scope.data.events, scope.data.edges);
    await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);
    return { ok: true, data: { id: edge.id, source: sourceId, target: targetId } };
  },
};

// ---------------------------------------------------------------------------
// Tool: auto_layout_dag
// ---------------------------------------------------------------------------

const autoLayoutDag: AgentTool = {
  schema: {
    name: "auto_layout_dag",
    description:
      "Automatically reposition all nodes in the active timeline using a layered DAG layout. Call after creating many nodes and edges to make the graph readable.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  riskLevel: "safe",
  async execute(_args, ctx) {
    const tid = ctx.timelineId ?? null;
    const did = ctx.documentId ?? null;
    if (!tid && !did) return { ok: false, error: "No active timeline or document" };
    const scope = await resolveTimelineScope(ctx.projectId, did, tid);
    if (!scope) return { ok: false, error: "Timeline scope not found" };

    layoutDagNodes(scope.data.events, scope.data.edges);
    await saveTimelineScope(scope.projectId, scope.scopeType, scope.id, scope.data);
    return {
      ok: true,
      data: {
        nodesRepositioned: scope.data.events.length,
        edgeCount: scope.data.edges.length,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Tool: delete_edge
// ---------------------------------------------------------------------------

const deleteEdge: AgentTool = {
  schema: {
    name: "delete_edge",
    description: "Delete an edge from the timeline graph.",
    parameters: {
      type: "object",
      properties: {
        edge_id: { type: "string", description: "ID of the edge to delete" },
      },
      required: ["edge_id"],
    },
  },
  riskLevel: "risky",
  async execute(args, ctx) {
    const edgeId = String(args.edge_id ?? "");
    if (!edgeId) return { ok: false, error: "edge_id is required" };

    const { listProjects, listTimelines: lt } = await import("./fs-db");
    const projects = await listProjects();
    for (const p of projects) {
      const timelines = await lt(p.id);
      for (const t of timelines) {
        const idx = t.edges.findIndex((e) => e.id === edgeId);
        if (idx !== -1) {
          t.edges.splice(idx, 1);
          await saveTimelineScope(p.id, "timeline", t.id, t);
          return { ok: true, data: { deleted: edgeId } };
        }
      }
    }
    return { ok: false, error: `Edge not found: ${edgeId}` };
  },
};

// ---------------------------------------------------------------------------
// Tool: read_draft
// ---------------------------------------------------------------------------

const readDraft: AgentTool = {
  schema: {
    name: "read_draft",
    description: "Read the current content of the active document/crystal.",
    parameters: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "Document ID. Omit to use the active document.",
        },
      },
    },
  },
  riskLevel: "safe",
  async execute(args, ctx) {
    const docId = String(args.document_id ?? ctx.documentId ?? "");
    if (!docId) return { ok: false, error: "No document ID available" };
    const doc = await readDocument(ctx.projectId, docId);
    if (!doc) return { ok: false, error: `Document not found: ${docId}` };
    return {
      ok: true,
      data: { id: doc.id, title: doc.title, content: doc.content },
    };
  },
};

// ---------------------------------------------------------------------------
// Tool: append_to_draft
// ---------------------------------------------------------------------------

const appendToDraft: AgentTool = {
  schema: {
    name: "append_to_draft",
    description: "Append text to the end of the active document/crystal.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to append" },
      },
      required: ["text"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const text = String(args.text ?? "");
    if (!text) return { ok: false, error: "text is required" };
    const docId = ctx.documentId ?? "";
    if (!docId) return { ok: false, error: "No active document" };
    const doc = await readDocument(ctx.projectId, docId);
    if (!doc) return { ok: false, error: `Document not found: ${docId}` };

    const { writeDocument } = await import("./fs-db");
    doc.content = doc.content + text;
    // doc.updatedAt = new Date().toISOString();
    await writeDocument(ctx.projectId, doc);
    return { ok: true, data: { id: doc.id, appended: text.length } };
  },
};

// ---------------------------------------------------------------------------
// Tool: write_draft
// ---------------------------------------------------------------------------

const writeDraft: AgentTool = {
  schema: {
    name: "write_draft",
    description:
      "Overwrite the entire content of the active document/crystal. Use this to set the full draft content from scratch or to replace all existing content.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The full text to write as the new document content",
        },
      },
      required: ["text"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const text = String(args.text ?? "");
    if (!text) return { ok: false, error: "text is required" };
    const docId = ctx.documentId ?? "";
    if (!docId) return { ok: false, error: "No active document" };
    const doc = await readDocument(ctx.projectId, docId);
    if (!doc) return { ok: false, error: `Document not found: ${docId}` };

    const { writeDocument } = await import("./fs-db");
    const previousLength = doc.content.length;
    doc.content = text;
    await writeDocument(ctx.projectId, doc);
    return {
      ok: true,
      data: { id: doc.id, previousLength, newLength: text.length },
    };
  },
};

// ---------------------------------------------------------------------------
// Tool: replace_in_draft
// ---------------------------------------------------------------------------

const replaceInDraft: AgentTool = {
  schema: {
    name: "replace_in_draft",
    description:
      "Find and replace a section of text in the active document/crystal. Use this for targeted edits without rewriting the entire draft.",
    parameters: {
      type: "object",
      properties: {
        old_text: {
          type: "string",
          description:
            "The exact text to find in the document. Must match exactly (including whitespace).",
        },
        new_text: {
          type: "string",
          description: "The replacement text",
        },
        replace_all: {
          type: "boolean",
          description:
            "If true, replace all occurrences. Default: false (replace first occurrence only).",
        },
      },
      required: ["old_text", "new_text"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const oldText = String(args.old_text ?? "");
    const newText = String(args.new_text ?? "");
    if (!oldText) return { ok: false, error: "old_text is required" };
    const docId = ctx.documentId ?? "";
    if (!docId) return { ok: false, error: "No active document" };
    const doc = await readDocument(ctx.projectId, docId);
    if (!doc) return { ok: false, error: `Document not found: ${docId}` };

    if (!doc.content.includes(oldText)) {
      return { ok: false, error: "old_text not found in document" };
    }

    const { writeDocument } = await import("./fs-db");
    const replaceAll = Boolean(args.replace_all);
    if (replaceAll) {
      doc.content = doc.content.split(oldText).join(newText);
    } else {
      doc.content = doc.content.replace(oldText, newText);
    }
    await writeDocument(ctx.projectId, doc);
    return {
      ok: true,
      data: { id: doc.id, newLength: doc.content.length },
    };
  },
};

// ---------------------------------------------------------------------------
// Tool: search_project
// ---------------------------------------------------------------------------

const searchProject: AgentTool = {
  schema: {
    name: "search_project",
    description:
      "Full-text keyword + semantic search across all entities (documents, artifacts, timelines, events). Uses token-based matching and embedding RAG for high recall.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — use natural language or keywords" },
      },
      required: ["query"],
    },
  },
  riskLevel: "safe",
  async execute(args, ctx) {
    const query = String(args.query ?? "");
    if (!query) return { ok: false, error: "query is required" };

    const q = query.toLowerCase();
    const tokens = tokenizeQuery(query);
    const seenIds = new Set<string>();
    const results: Array<{ type: string; id: string; title: string; snippet: string }> = [];

    const docs = await listDocuments(ctx.projectId);
    for (const d of docs) {
      const haystack = `${d.title} ${d.content}`;
      if (textMatchesQuery(haystack, q, tokens)) {
        seenIds.add(d.id);
        results.push({ type: "document", id: d.id, title: d.title, snippet: d.content.slice(0, 150) });
      }
    }

    const wikis = await listWikiEntries(ctx.projectId);
    for (const w of wikis) {
      const haystack = `${w.title} ${w.aliases} ${w.content}`;
      if (textMatchesQuery(haystack, q, tokens)) {
        seenIds.add(w.id);
        results.push({ type: "wiki", id: w.id, title: w.title, snippet: w.content.slice(0, 150) });
      }
    }

    const timelines = await listTimelines(ctx.projectId);
    for (const t of timelines) {
      for (const ev of t.events) {
        const haystack = `${ev.title} ${ev.content ?? ""} ${ev.summary ?? ""}`;
        if (textMatchesQuery(haystack, q, tokens)) {
          seenIds.add(ev.id);
          results.push({ type: "event", id: ev.id, title: ev.title, snippet: (ev.summary ?? ev.content ?? "").slice(0, 150) });
        }
      }
    }

    // Semantic search via RAG embeddings for anything the keyword pass missed
    try {
      const similar = await retrieveSimilar(ctx.projectId, query, 10);
      for (const hit of similar) {
        if (seenIds.has(hit.id)) continue;
        seenIds.add(hit.id);
        if (hit.type === "wiki") {
          const entry = await readWikiEntry(ctx.projectId, hit.id);
          if (entry) results.push({ type: "wiki", id: entry.id, title: entry.title, snippet: entry.content.slice(0, 150) });
        } else if (hit.type === "document") {
          const doc = await readDocument(ctx.projectId, hit.id);
          if (doc) results.push({ type: "document", id: doc.id, title: doc.title, snippet: doc.content.slice(0, 150) });
        }
      }
    } catch {
      /* embedding retrieval is best-effort */
    }

    return { ok: true, data: results.slice(0, 25) };
  },
};

// ---------------------------------------------------------------------------
// Tool: delegate_to_specialist
// ---------------------------------------------------------------------------

export const delegateToSpecialist: AgentTool = {
  schema: {
    name: "delegate_to_specialist",
    description:
      "Delegate a task to a specialist sub-agent glyph. The specialist runs autonomously with its own model/prompt and returns a summary. Only specialist (non-Sculpter) glyphs may be targeted.",
    parameters: {
      type: "object",
      properties: {
        glyph_id: {
          type: "string",
          description: "ID of the specialist glyph to delegate to",
        },
        task: {
          type: "string",
          description: "Task instructions for the specialist",
        },
      },
      required: ["glyph_id", "task"],
    },
  },
  riskLevel: "normal",
  async execute() {
    // Intercepted by agentLoop — this should never run directly
    return { ok: false, error: "delegate_to_specialist must be handled by the agent loop" };
  },
};

// ---------------------------------------------------------------------------
// Tool: delegate_fan_out
// ---------------------------------------------------------------------------

export const delegateFanOut: AgentTool = {
  schema: {
    name: "delegate_fan_out",
    description:
      "Run multiple specialist sub-agents in parallel. Each delegation targets a specialist glyph with its own task. Results are collected and returned together.",
    parameters: {
      type: "object",
      properties: {
        delegates: {
          type: "array",
          description: "Array of { glyph_id, task } objects to run in parallel",
          items: { type: "object" },
        },
      },
      required: ["delegates"],
    },
  },
  riskLevel: "normal",
  async execute() {
    // Intercepted by agentLoop — this should never run directly
    return { ok: false, error: "delegate_fan_out must be handled by the agent loop" };
  },
};

// ---------------------------------------------------------------------------
// Tool: resolve_dead_links
// ---------------------------------------------------------------------------

const resolveDeadLinks: AgentTool = {
  schema: {
    name: "resolve_dead_links",
    description:
      "Find [[wikilinks]] in a document that don't point to existing artifacts/documents, then create stub artifacts for them using RAG context from embeddings.",
    parameters: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "ID of the document to scan for dead links",
        },
        dry_run: {
          type: "string",
          description: "If 'true', list dead links without creating anything",
        },
      },
      required: ["document_id"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const docId = String(args.document_id ?? ctx.documentId ?? ctx.wikiId ?? "");
    if (!docId) return { ok: false, error: "document_id is required" };
    const isDryRun = String(args.dry_run ?? "false").toLowerCase() === "true";

    const doc = await readDocument(ctx.projectId, docId);
    const wiki = !doc ? await readWikiEntry(ctx.projectId, docId) : null;
    const entity = doc || wiki;
    if (!entity) return { ok: false, error: `Entity not found: ${docId}` };

    // Extract all entity link targets: [[Title]], [[Title|display]], and [display](<Target>)
    const targets = new Set<string>();
    let m: RegExpExecArray | null;
    const wikilinkRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    while ((m = wikilinkRe.exec(entity.content)) !== null) {
      targets.add(m[1].trim());
    }
    const angleBracketRe = /\[([^\]]+)\]\(\s*<([^>]+)>\s*\)/g;
    while ((m = angleBracketRe.exec(entity.content)) !== null) {
      targets.add(m[2].trim());
    }

    if (targets.size === 0) {
      return { ok: true, data: { message: "No entity links found", resolved: [], skipped: [], created: [] } };
    }

    // Check which targets already exist
    const wikis = await listWikiEntries(ctx.projectId);
    const docs = await listDocuments(ctx.projectId);
    const existingTitles = new Set<string>();
    for (const w of wikis) {
      existingTitles.add(w.title.toLowerCase());
      for (const alias of w.aliases.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)) {
        existingTitles.add(alias);
      }
    }
    for (const d of docs) {
      existingTitles.add(d.title.toLowerCase());
    }

    const skipped: string[] = [];
    const deadLinks: string[] = [];
    for (const target of targets) {
      if (existingTitles.has(target.toLowerCase())) {
        skipped.push(target);
      } else {
        deadLinks.push(target);
      }
    }

    if (isDryRun) {
      return { ok: true, data: { dead_links: deadLinks, existing: skipped, created: [] } };
    }

    // Load project templates and specialist glyphs
    const templates = await listTemplates(ctx.projectId);
    const wikiTemplate = templates.find(t => t.filename === "Wiki_Page_Template.md")
      || templates.find(t => t.name.toLowerCase().includes("wiki"))
      || null;

    const allGlyphs = await readGlyphs();
    const findSpecialist = (role: string): FsGlyph | null =>
      allGlyphs.find(g => g.isSculpter === false && g.specialistRole?.toLowerCase() === role.toLowerCase()) || null;

    const researcherGlyph = findSpecialist("researcher");
    const writerGlyph = findSpecialist("writer");
    const auditorGlyph = findSpecialist("auditor");

    const { generateGeminiText } = await import("./gemini");

    async function runAgent(
      glyph: FsGlyph | null,
      fallbackSystemInstruction: string,
      prompt: string,
    ): Promise<string> {
      return generateGeminiText({
        model: glyph?.model || undefined,
        systemInstruction: glyph?.systemInstruction || fallbackSystemInstruction,
        prompt,
        maxOutputTokens: glyph?.maxOutputTokens || 4096,
        temperature: glyph?.temperature ?? 0.7,
      });
    }

    const created: string[] = [];
    const total = deadLinks.length;
    let completedCount = 0;
    
    ctx.onProgress?.({ type: "progress", current: 0, total, message: `Found ${total} dead links to resolve...` });

    const CONCURRENCY_LIMIT = 3;
    for (let i = 0; i < total; i += CONCURRENCY_LIMIT) {
      const batch = deadLinks.slice(i, i + CONCURRENCY_LIMIT);
      
      await Promise.all(batch.map(async (title) => {
        let current = completedCount + 1;
      
      // --- Step 0: Gather raw materials ---
      ctx.onProgress?.({ type: "progress", current, total, title, step: "rag", message: `Gathering context for "${title}"...` });
      let ragResults: string[] = [];
      try {
        const similar = await retrieveSimilar(ctx.projectId, title, 8);
        for (const hit of similar) {
          if (hit.type === "wiki") {
            const e = await readWikiEntry(ctx.projectId, hit.id);
            if (e) ragResults.push(`ENTRY "${e.title}" (wiki):\n${e.content.slice(0, 1000)}`);
          } else if (hit.type === "document") {
            const d = await readDocument(ctx.projectId, hit.id);
            if (d) ragResults.push(`ENTRY "${d.title}" (document):\n${d.content.slice(0, 1000)}`);
          }
        }
      } catch { /* best-effort */ }

      let linkIdx = entity.content.indexOf(`[[${title}]]`);
      if (linkIdx < 0) linkIdx = entity.content.indexOf(`<${title}>`);
      let surroundingContext = "";
      if (linkIdx >= 0) {
        const start = Math.max(0, linkIdx - 800);
        const end = Math.min(entity.content.length, linkIdx + title.length + 4 + 800);
        surroundingContext = entity.content.slice(start, end).trim();
      }

      const now = new Date();
      const dateStr = now.toISOString().replace(/[-:]/g, "").slice(0, 13) + "Z";
      let filledTemplate = "";
      if (wikiTemplate) {
        filledTemplate = wikiTemplate.content
          .replace(/\{\{title\}\}/g, title)
          .replace(/\{\{date:[^}]+\}\}/g, dateStr)
          .replace(/\{\{author\}\}/g, "Rhyolite");
      }

      // --- Step 1: RESEARCHER — analyze context and plan the article ---
      ctx.onProgress?.({ type: "progress", current, total, title, step: "research", message: `Researching "${title}"...` });
      let researchBrief = "";
      try {
        const researchPrompt = [
          `# Research Task: "${title}"`,
          ``,
          `An entity called "${title}" was mentioned in the article "${entity.title}" but has no wiki entry yet. Your job is to analyze all available context and produce a detailed research brief that a writer will use to create the full article.`,
          ``,
          `## Where "${title}" appears`,
          surroundingContext
            ? `In the article "${entity.title}", the passage mentioning "${title}":\n\n${surroundingContext}`
            : `Mentioned in "${entity.title}" but no surrounding passage available.`,
          ``,
          `## Related project entries`,
          ragResults.length > 0 ? ragResults.join("\n\n---\n\n") : "(none found)",
          ``,
          `## Your output`,
          `Produce a structured research brief for "${title}" with:`,
          `1. **What it is**: Based on context clues, what type of entity is this? (person, place, object, event, concept, faction, species, etc.)`,
          `2. **Known facts**: Everything that can be definitively stated based on the source material.`,
          `3. **Inferred details**: Plausible details that are consistent with the established lore but not explicitly stated. Mark these clearly.`,
          `4. **Connections**: Which other entities does "${title}" relate to and how?`,
          `5. **Key sections to include**: Given the entity type, which sections of the wiki template should be emphasized?`,
          `6. **Tone notes**: Based on the existing entries, what voice and style should the article use?`,
        ].join("\n");

        researchBrief = await runAgent(
          researcherGlyph,
          "You are a meticulous worldbuilding researcher. You analyze source material carefully, distinguish between confirmed facts and reasonable inferences, and produce thorough research briefs. You never fabricate lore that contradicts existing material.",
          researchPrompt,
        );
        researchBrief = researchBrief.trim();
      } catch {
        researchBrief = `Entity "${title}" referenced in "${entity.title}". Context: ${surroundingContext.slice(0, 500)}`;
      }

      // --- Step 2: WRITER — produce the full article following the template ---
      ctx.onProgress?.({ type: "progress", current, total, title, step: "write", message: `Writing article for "${title}"...` });
      let draft = "";
      try {
        const writerPrompt = [
          `# Writing Task: Create wiki article for "${title}"`,
          ``,
          `## Research Brief`,
          researchBrief,
          ``,
          filledTemplate
            ? [
                `## Template (MUST FOLLOW THIS STRUCTURE)`,
                ``,
                `Follow this template exactly. Fill in every section with substantive content. Remove sections that clearly don't apply to this entity type. Replace every HTML comment (<!-- ... -->) with real prose.`,
                ``,
                filledTemplate,
              ].join("\n")
            : `## Structure\nWrite a complete wiki article with: a short evocative quote, Summary, relevant detail sections, Historical Touchpoints, a Reference table, and See Also links.`,
          ``,
          `## Writing Rules`,
          `- This article is ABOUT "${title}" — write from that entity's perspective, not from the perspective of whatever article it was referenced in.`,
          `- Write 400-800 words of substantive in-universe content.`,
          `- Use [[Entity Name]] wikilinks for cross-references to other entities.`,
          `- Fill the Reference table with specific, plausible values — never leave cells empty.`,
          `- Do NOT include YAML frontmatter.`,
          `- Do NOT wrap output in code fences.`,
          `- Do NOT include any meta-commentary, disclaimers, or "auto-generated" notes.`,
          `- Do NOT include a "Referenced in..." blockquote — this is an original article.`,
          `- Every section heading from the template should have at least one full paragraph beneath it.`,
        ].join("\n");

        draft = await runAgent(
          writerGlyph,
          "You are an expert worldbuilding wiki author. You write vivid, detailed, in-universe encyclopedia entries. Every article you write is a complete, standalone piece — never a stub. You follow templates precisely, filling every section with rich content. Your prose is authoritative and evocative, blending established facts with plausible invented details.",
          writerPrompt,
        );
        draft = draft.trim();
      } catch {
        draft = "";
      }

      // --- Step 3: AUDITOR — review and finalize ---
      ctx.onProgress?.({ type: "progress", current, total, title, step: "audit", message: `Auditing draft for "${title}"...` });
      let finalBody: string;
      if (draft && draft.length > 200) {
        try {
          const auditorPrompt = [
            `# Audit Task: Review wiki article for "${title}"`,
            ``,
            `## Article Draft`,
            draft,
            ``,
            `## Research Brief (for fact-checking)`,
            researchBrief.slice(0, 2000),
            ``,
            filledTemplate ? `## Expected Template Structure\n${filledTemplate}\n` : "",
            `## Audit Checklist — fix ALL issues and return the corrected article:`,
            `1. STRUCTURE: Does it follow the template? Add any missing sections.`,
            `2. COMPLETENESS: Are there empty sections, placeholder comments (<!-- -->), or cells with no values? Fill them in.`,
            `3. SUBJECT: Is the article about "${title}" specifically? Remove anything that reads like it's about a different entity.`,
            `4. CROSS-REFERENCES: Are [[wikilinks]] used for entity names? Add missing ones.`,
            `5. TONE: Is the writing in-universe and encyclopedic? Remove any out-of-character or meta text.`,
            `6. META-TEXT: Remove any "auto-generated", "needs to be fleshed out", "Referenced in..." or similar disclaimers.`,
            `7. QUALITY: Is every section substantive (not just one sentence)? Expand thin sections.`,
            `8. CONSISTENCY: Do the details align with the research brief? Fix contradictions.`,
            ``,
            `Return ONLY the final corrected article in markdown. No commentary, no code fences, no frontmatter.`,
          ].filter(Boolean).join("\n");

          const audited = await runAgent(
            auditorGlyph,
            "You are a strict wiki editor and continuity auditor. You enforce template compliance, fill gaps, remove meta-text, and ensure every article is complete, consistent, and publication-ready. You return only the corrected article with no commentary.",
            auditorPrompt,
          );
          finalBody = audited.trim() || draft;
        } catch {
          finalBody = draft;
        }
      } else {
        finalBody = `# ${title}\n\n*Could not generate content for this entity. Please write this article manually.*\n`;
      }

      const entry: FsWikiEntry = {
        id: generateId(),
        projectId: ctx.projectId,
        title,
        content: finalBody,
        aliases: "",
        folderId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await writeWikiEntry(ctx.projectId, entry);
      created.push(title);
      completedCount++;
      current = completedCount;
      ctx.onProgress?.({ type: "progress", current: completedCount, total, title, step: "complete", message: `Finished "${title}" (${completedCount}/${total})` });
    }));
    }

    return {
      ok: true,
      data: {
        resolved: [...skipped, ...created],
        skipped,
        created,
        message: `Created ${created.length} stub artifact(s), ${skipped.length} already existed.`,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Tool: create_document
// ---------------------------------------------------------------------------

const createDocumentTool: AgentTool = {
  schema: {
    name: "create_document",
    description: "Create a new document (crystal) in the project.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title for the new document" },
        content: { type: "string", description: "Initial markdown content" },
        folder_id: { type: "string", description: "Optional folder ID to place in" },
      },
      required: ["title"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const title = String(args.title || "Untitled");
    const content = String(args.content || "");
    const folderId = args.folder_id ? String(args.folder_id) : null;
    const newId = await invoke<string>("create_file", {
      projectId: ctx.projectId,
      folderId,
      name: title,
      type: "document",
    });
    if (content) {
      await invoke("update_document", { projectId: ctx.projectId, id: newId, title, content });
    }
    return { ok: true, data: { id: newId, title } };
  },
};

// ---------------------------------------------------------------------------
// Tool: delete_document
// ---------------------------------------------------------------------------

const deleteDocumentTool: AgentTool = {
  schema: {
    name: "delete_document",
    description: "Delete a document (crystal) from the project.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "ID of the document to delete" },
      },
      required: ["document_id"],
    },
  },
  riskLevel: "risky",
  async execute(args, ctx) {
    const docId = String(args.document_id || "");
    if (!docId) return { ok: false, error: "document_id is required" };
    await invoke("delete_file", { projectId: ctx.projectId, id: docId, type: "document" });
    return { ok: true, data: { deleted: docId } };
  },
};

// ---------------------------------------------------------------------------
// Tool: move_file
// ---------------------------------------------------------------------------

const moveFileTool: AgentTool = {
  schema: {
    name: "move_file",
    description: "Move a document or wiki entry to a different folder within the project.",
    parameters: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "ID of the file to move" },
        file_type: { type: "string", description: "Type: 'document' or 'wiki'" },
        new_folder_id: { type: "string", description: "Target folder ID, or null for root" },
      },
      required: ["file_id", "file_type"],
    },
  },
  riskLevel: "normal",
  async execute(args, ctx) {
    const fileId = String(args.file_id || "");
    const fileType = String(args.file_type || "document");
    const newFolderId = args.new_folder_id ? String(args.new_folder_id) : null;
    if (!fileId) return { ok: false, error: "file_id is required" };
    await invoke("move_file", {
      projectId: ctx.projectId,
      id: fileId,
      type: fileType,
      newFolderId,
    });
    return { ok: true, data: { moved: fileId, to: newFolderId || "root" } };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ALL_TOOLS: AgentTool[] = [
  searchArtifacts,
  readArtifact,
  createArtifact,
  updateArtifact,
  deleteArtifactTool,
  createDocumentTool,
  deleteDocumentTool,
  moveFileTool,
  readTimelineTool,
  createTimelineNode,
  updateTimelineNode,
  deleteTimelineNode,
  createEdge,
  autoLayoutDag,
  deleteEdge,
  readDraft,
  appendToDraft,
  writeDraft,
  replaceInDraft,
  searchProject,
  resolveDeadLinks,
  delegateToSpecialist,
  delegateFanOut,
];

export const TOOL_MAP = new Map(ALL_TOOLS.map((t) => [t.schema.name, t]));

// ---------------------------------------------------------------------------
// Provider converters
// ---------------------------------------------------------------------------

/** Gemini FunctionDeclaration format (uses parametersJsonSchema for compatibility) */
export function toGeminiFunctionDeclarations(tools: AgentTool[]) {
  return tools.map((t) => ({
    name: t.schema.name,
    description: t.schema.description,
    parametersJsonSchema: t.schema.parameters,
  }));
}

/** Anthropic tool format */
export function toAnthropicTools(tools: AgentTool[]) {
  return tools.map((t) => ({
    name: t.schema.name,
    description: t.schema.description,
    input_schema: t.schema.parameters,
  }));
}

/** OpenAI / OpenRouter function format */
export function toOpenAIFunctions(tools: AgentTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.schema.name,
      description: t.schema.description,
      parameters: t.schema.parameters,
    },
  }));
}

// ---------------------------------------------------------------------------
// Plan mode meta-tool
// ---------------------------------------------------------------------------

/**
 * Builds a human-readable summary of all tools for system prompt injection.
 * Used in Plan mode so the model knows what tools it can propose.
 */
export function buildToolCatalogSummary(): string {
  const lines = ALL_TOOLS.map(
    (t) => `• ${t.schema.name} [${t.riskLevel}]: ${t.schema.description}`
  );
  return `Available tools:\n${lines.join("\n")}`;
}

export const PROPOSE_PLAN_TOOL: AgentTool = {
  schema: {
    name: "propose_plan",
    description:
      "Propose a structured plan of tool calls for the user to review before execution. Each step has a tool name, arguments, and a rationale.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "Array of planned tool calls",
          items: { type: "object" },
        },
      },
      required: ["steps"],
    },
  },
  riskLevel: "safe",
  async execute(args) {
    return { ok: true, data: args.steps };
  },
};
