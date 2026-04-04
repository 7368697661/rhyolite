"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  Project,
  Document,
  WikiEntry,
  ActiveItem,
  Timeline,
} from "./WorkspaceClient";
import type { EntitySuggestion } from "@/lib/entityExtractor";
import { WikiMarkdown } from "./WikiMarkdown";
import ProjectSettingsPane from "./ProjectSettingsPane";
import TimelineCanvas from "./TimelineCanvas";
import GlobalMapCanvas from "./GlobalMapCanvas";
import TerminalPrompt from "./TerminalPrompt";

export default function DocumentEditorPane({
  activeItem,
  documents,
  wikiEntries,
  timelines,
  projects,
  onReloadProjectData,
  onReloadProjects,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigate,
  activeTimelineEventId,
  onTimelineEventSelect,
  onCursorChange,
}: {
  activeItem: ActiveItem | null;
  documents: Document[];
  wikiEntries: WikiEntry[];
  timelines: Timeline[];
  projects: Project[];
  onReloadProjectData: () => void;
  onReloadProjects: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (item: ActiveItem) => void;
  activeTimelineEventId: string | null;
  onTimelineEventSelect: (id: string | null) => void;
  onCursorChange?: (pos: number) => void;
}) {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  
  // Diff-highlight state for AI-appended content
  const [highlightRange, setHighlightRange] = useState<{ start: number; end: number } | null>(null);
  const prevContentLenRef = useRef<number>(0);

  // Infill state
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  const [isInfillOpen, setIsInfillOpen] = useState(false);
  const [infillInstruction, setInfillInstruction] = useState("");
  const [isInfilling, setIsInfilling] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Extract-to-artifact inline prompt
  const [extractPromptOpen, setExtractPromptOpen] = useState(false);

  // Entity link suggestions
  const [entitySuggestions, setEntitySuggestions] = useState<EntitySuggestion[]>([]);
  
  // Resolve dead links state
  const [isResolvingLinks, setIsResolvingLinks] = useState(false);
  const [resolveResult, setResolveResult] = useState<{ message: string; created: string[] } | null>(null);
  const [resolveProgress, setResolveProgress] = useState<{ message: string; current?: number; total?: number } | null>(null);

  const activeDoc =
    activeItem?.type === "document"
      ? documents.find((d) => d.id === activeItem.id)
      : null;
  const activeWiki =
    activeItem?.type === "wiki"
      ? wikiEntries.find((w) => w.id === activeItem.id)
      : null;
  const activeTimeline =
    activeItem?.type === "timeline"
      ? timelines.find((t) => t.id === activeItem.id) ?? null
      : null;
  const settingsProject =
    activeItem?.type === "project_settings"
      ? projects.find((p) => p.id === activeItem.id) ?? null
      : null;
  const itemData = activeDoc || activeWiki;

  useEffect(() => {
    if (itemData) {
      setContent(itemData.content || "");
      setTitle(itemData.title || "");
      setPreviewContent(itemData.content || "");
      prevContentLenRef.current = (itemData.content || "").length;
    } else {
      setContent("");
      setTitle("");
      setPreviewContent("");
      prevContentLenRef.current = 0;
    }
  }, [itemData]);

  // Debounce markdown parsing so typing in large documents stays responsive.
  useEffect(() => {
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const delay = words > 1000 ? 350 : 120;
    const t = window.setTimeout(() => setPreviewContent(content), delay);
    return () => window.clearTimeout(t);
  }, [content]);

  // Detect large content appends (AI-generated) and briefly highlight
  useEffect(() => {
    const prevLen = prevContentLenRef.current;
    const newLen = content.length;
    if (newLen > prevLen && newLen - prevLen > 50) {
      setHighlightRange({ start: prevLen, end: newLen });
      const timer = window.setTimeout(() => setHighlightRange(null), 4000);
      prevContentLenRef.current = newLen;
      return () => window.clearTimeout(timer);
    }
    prevContentLenRef.current = newLen;
  }, [content]);

  const fetchEntitySuggestions = useCallback(async () => {
    if (!activeItem || (activeItem.type !== "document" && activeItem.type !== "wiki")) return;
    if (!itemData?.projectId || !content.trim()) {
      setEntitySuggestions([]);
      return;
    }
    try {
      const res = await fetch("/api/entities/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: itemData.projectId,
          content,
          selfId: activeItem.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setEntitySuggestions(data.suggestions ?? []);
      }
    } catch {
      // silently ignore suggestion fetch failures
    }
  }, [activeItem, itemData?.projectId, content]);

  useEffect(() => {
    if (!activeItem || (activeItem.type !== "document" && activeItem.type !== "wiki")) {
      setEntitySuggestions([]);
      return;
    }
    const t = window.setTimeout(fetchEntitySuggestions, 2000);
    return () => window.clearTimeout(t);
  }, [fetchEntitySuggestions]);

  const applyEntityLink = (suggestion: EntitySuggestion) => {
    const before = content.substring(0, suggestion.startIndex);
    const after = content.substring(suggestion.endIndex);
    const linked = `[${suggestion.matchText}]`;
    const newContent = before + linked + after;
    setContent(newContent);
    handleSave(newContent);
  };

  const handleResolveLinks = async () => {
    if (!itemData || (activeItem?.type !== "document" && activeItem?.type !== "wiki")) return;
    setIsResolvingLinks(true);
    setResolveResult(null);
    setResolveProgress({ message: "Checking for dead links..." });
    
    try {
      // 1. Dry run to get count
      const dryRes = await fetch("/api/documents/resolve-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: itemData.id,
          project_id: itemData.projectId,
          dry_run: true,
        }),
      });
      
      const dryData = await dryRes.json();
      if (!dryData.ok) {
        throw new Error(dryData.error || "Failed to check links");
      }
      
      const count = dryData.data?.dead_links?.length || 0;
      if (count === 0) {
        setResolveResult({ message: "No dead links found", created: [] });
        setIsResolvingLinks(false);
        setResolveProgress(null);
        return;
      }
      
      // Warning for large number of links
      if (!confirm(`Found ${count} dead link(s). Generating articles takes time (about 20-40 seconds per link).\n\nProceed with generation?`)) {
        setIsResolvingLinks(false);
        setResolveProgress(null);
        return;
      }

      setResolveProgress({ message: "Starting generation...", current: 0, total: count });

      // 2. Real run with stream parsing
      const res = await fetch("/api/documents/resolve-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: itemData.id,
          project_id: itemData.projectId,
          dry_run: false,
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      
      let finalMessage = "Resolve complete";
      let finalCreated: string[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep the last incomplete line in buffer
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "progress") {
              setResolveProgress({
                message: event.data.message || event.data.step,
                current: event.data.current,
                total: event.data.total,
              });
            } else if (event.type === "result") {
              if (event.data.ok && event.data.data) {
                finalMessage = event.data.data.message || finalMessage;
                finalCreated = event.data.data.created || [];
              } else {
                finalMessage = event.data.error || "Failed to resolve";
              }
            } else if (event.type === "error") {
              finalMessage = event.error || "Error during resolution";
            }
          } catch (e) {
            console.error("Failed to parse ndjson line", e);
          }
        }
      }

      setResolveResult({ message: finalMessage, created: finalCreated });
      if (finalCreated.length > 0) {
        onReloadProjectData();
      }
    } catch (err: any) {
      setResolveResult({ message: err.message || "Network error", created: [] });
    } finally {
      setIsResolvingLinks(false);
      setResolveProgress(null);
    }
  };

  const resolveEntityPreview = useCallback((entityTitle: string) => {
    const lowerTitle = entityTitle.toLowerCase();
    const wiki = wikiEntries.find((w) => {
      const aliases = w.aliases
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return w.title.toLowerCase() === lowerTitle || aliases.includes(lowerTitle);
    });
    if (wiki) {
      return { title: wiki.title, snippet: (wiki.content || "").slice(0, 200) };
    }
    const doc = documents.find((d) => d.title.toLowerCase() === lowerTitle);
    if (doc) {
      return { title: doc.title, snippet: (doc.content || "").slice(0, 200) };
    }
    return null;
  }, [wikiEntries, documents]);

  if (activeItem?.type === "network") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <GlobalMapCanvas
          projectId={activeItem.id}
          onNavigate={onNavigate}
          onTimelineNodeSelect={onTimelineEventSelect}
        />
      </div>
    );
  }

  if (activeItem?.type === "timeline") {
    if (!activeTimeline) {
      return (
        <div className="flex h-full items-center justify-center border-b border-violet-900/50 px-4 text-sm text-violet-700">
          <p>Timeline not found.</p>
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-violet-600/40 px-5 py-3 bg-[#020005] z-10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex shrink-0 items-center gap-0.5 text-violet-600">
              <button
                type="button"
                onClick={onBack}
                disabled={!canGoBack}
                className={`p-1 transition-colors ${
                  canGoBack
                    ? "text-violet-400 hover:text-violet-200"
                    : "cursor-not-allowed opacity-25"
                }`}
                aria-label="Back"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={onForward}
                disabled={!canGoForward}
                className={`p-1 transition-colors ${
                  canGoForward
                    ? "text-violet-400 hover:text-violet-200"
                    : "cursor-not-allowed opacity-25"
                }`}
                aria-label="Forward"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500">
              [TIMELINE]
            </span>
            <h2 className="min-w-0 truncate font-heading text-base font-semibold text-violet-100 [text-shadow:0_0_14px_rgba(167,139,250,0.2)]">
              {activeTimeline.title}
            </h2>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 border-t border-violet-800/40">
          <TimelineCanvas
            timelineId={activeTimeline.id}
            projectId={activeTimeline.projectId}
            activeNodeId={activeTimelineEventId}
            onNodeSelect={onTimelineEventSelect}
            onReloadProjectData={onReloadProjectData}
          />
        </div>
      </div>
    );
  }

  if (activeItem?.type === "project_settings") {
    if (!settingsProject) {
      return (
        <div className="flex h-full items-center justify-center border-b border-violet-900/50 px-4 text-sm text-violet-700">
          <p>Project not found. Select a project in the sidebar.</p>
        </div>
      );
    }
    return (
      <ProjectSettingsPane
        project={settingsProject}
        onReloadProjects={onReloadProjects}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={onBack}
        onForward={onForward}
      />
    );
  }

  const handleSave = async (newContent: string) => {
    if (!activeItem) return;
    setIsSaving(true);

    try {
      const endpoint = activeItem.type === "document" ? `/api/documents/${activeItem.id}` : `/api/wiki/${activeItem.id}`;
      await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      onReloadProjectData();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelect = () => {
    if (!textareaRef.current) return;
    const t = textareaRef.current;
    onCursorChange?.(t.selectionStart);
    if (t.selectionStart !== t.selectionEnd) {
      setSelection({
        start: t.selectionStart,
        end: t.selectionEnd,
        text: content.substring(t.selectionStart, t.selectionEnd),
      });
    } else {
      setSelection(null);
    }
  };

  const handleInfillSubmit = async () => {
    if (!selection || !activeItem || !itemData?.projectId) return;
    setIsInfilling(true);

    try {
      const res = await fetch("/api/infill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: itemData.projectId,
          selectedText: selection.text,
          fullContent: content,
          instruction: infillInstruction || "Rewrite",
        }),
      });

      if (!res.ok) throw new Error("Infill failed");
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      
      let replacement = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          replacement += decoder.decode(value, { stream: true });
          
          const newContent = content.substring(0, selection.start) + replacement + content.substring(selection.end);
          setContent(newContent);
        }
      }
      handleSave(content.substring(0, selection.start) + replacement + content.substring(selection.end));
    } catch (e) {
      console.error(e);
      alert("Failed to infill text.");
    } finally {
      setIsInfilling(false);
      setIsInfillOpen(false);
      setSelection(null);
      setInfillInstruction("");
    }
  };

  const onEntityLinkClick = (entityTitle: string) => {
    const lowerTitle = entityTitle.toLowerCase();

    // Prefer wiki entries (Artifacts) since they support aliases.
    const wiki = wikiEntries.find((w) => {
      const aliases = w.aliases
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return w.title.toLowerCase() === lowerTitle || aliases.includes(lowerTitle);
    });

    if (wiki) {
      onNavigate({ type: "wiki", id: wiki.id });
      return;
    }

    // Then fall back to documents (Crystals).
    const doc = documents.find((d) => d.title.toLowerCase() === lowerTitle);
    if (doc) {
      onNavigate({ type: "document", id: doc.id });
      return;
    }

    alert(`Entity "${entityTitle}" not found (crystal or artifact) in this project.`);
  };

  const wordCount = previewContent.trim()
    ? previewContent.trim().split(/\s+/).length
    : 0;

  const previewTooBig = wordCount > 1200 && previewContent.length > 9000;
  const previewForRender = previewTooBig
    ? `${previewContent.slice(0, 9000)}\n\n[...preview truncated for performance]`
    : previewContent;

  if (!activeItem || !itemData) {
    return (
      <div className="flex h-full flex-col items-center justify-center border-b border-violet-900/50 px-6 text-center">
        <div className="text-violet-700 text-lg mb-2">◇</div>
        <p className="text-sm text-violet-600 font-bold uppercase tracking-wider mb-2">No item selected</p>
        <p className="text-[10px] text-violet-700 max-w-sm leading-relaxed">
          Select a <strong className="text-violet-500">crystal</strong> (document/chapter) or <strong className="text-violet-500">artifact</strong> (wiki entry) from the sidebar to begin writing. Crystals are your narrative drafts; artifacts are your world encyclopedia.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-violet-600/40 px-5 py-3 bg-[#020005] z-10">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex shrink-0 items-center gap-0.5 text-violet-600">
            <button
              type="button"
              onClick={onBack}
              disabled={!canGoBack}
              className={`p-1 transition-colors ${
                canGoBack
                  ? "text-violet-400 hover:text-violet-200"
                  : "cursor-not-allowed opacity-25"
              }`}
              aria-label="Back"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onForward}
              disabled={!canGoForward}
              className={`p-1 transition-colors ${
                canGoForward
                  ? "text-violet-400 hover:text-violet-200"
                  : "cursor-not-allowed opacity-25"
              }`}
              aria-label="Forward"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500">
              [{activeItem.type === "document" ? "Crystal" : "Artifact"}]
            </span>
          <h2 className="min-w-0 truncate font-heading text-base font-semibold text-violet-100 [text-shadow:0_0_14px_rgba(167,139,250,0.2)]">
            {title}
          </h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-violet-500">
          {(activeItem?.type === "document" || activeItem?.type === "wiki") && !isResolvingLinks && (
            <button
              type="button"
              onClick={() => handleResolveLinks()}
              className="border border-violet-700/60 bg-black px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-300 hover:border-violet-500 hover:text-violet-100"
              title="Find dead [[wikilinks]] and create stub artifacts for them"
            >
              Resolve [[links]]
            </button>
          )}
          {isResolvingLinks && (
            <div className="flex flex-col items-start gap-1">
              <span className="animate-pulse text-[10px] text-violet-400 uppercase tracking-wide">
                {resolveProgress?.message || "Resolving..."}
              </span>
              {resolveProgress?.total && resolveProgress.total > 0 && (
                <div className="flex items-center gap-2">
                  <div className="h-1 w-24 bg-violet-950 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-violet-500 transition-all duration-300" 
                      style={{ width: `${Math.min(100, Math.max(0, ((resolveProgress.current || 0) / resolveProgress.total) * 100))}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-violet-500 font-mono">
                    {resolveProgress.current || 0}/{resolveProgress.total}
                  </span>
                </div>
              )}
            </div>
          )}
          {selection && !isInfilling && !extractPromptOpen && (
            <>
              <button
                type="button"
                onClick={() => setExtractPromptOpen(true)}
                className="border border-violet-700/60 bg-black px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200 hover:border-violet-500"
              >
                Extract → Artifact
              </button>
              <button
                type="button"
                onClick={() => setIsInfillOpen(true)}
                className="border border-violet-500/70 bg-violet-950/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-100 hover:border-violet-400"
              >
                Infill
              </button>
            </>
          )}
          {isSaving && (
            <span className="animate-pulse text-violet-400">Saving…</span>
          )}
        </div>
      </div>

      {resolveResult && (
        <div className="border-b border-violet-600/40 px-5 py-2 flex items-center justify-between text-[10px] font-mono">
          <span className={resolveResult.created.length > 0 ? "text-emerald-400" : "text-violet-400"}>
            {resolveResult.message}
          </span>
          <button
            type="button"
            onClick={() => setResolveResult(null)}
            className="text-violet-600 hover:text-violet-300 ml-4"
          >
            dismiss
          </button>
        </div>
      )}

      {extractPromptOpen && selection && (
        <div className="border-b border-violet-600/40 px-5 py-2">
          <TerminalPrompt
            label="New Artifact Name"
            onSubmit={async (artifactTitle) => {
              if (itemData?.projectId) {
                const res = await fetch("/api/wiki", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    title: artifactTitle,
                    content: selection.text,
                    projectId: itemData.projectId,
                  }),
                });
                if (res.ok) {
                  const newWiki = await res.json();
                  onReloadProjectData();
                  onNavigate({ type: "wiki", id: newWiki.id });
                  setSelection(null);
                }
              }
              setExtractPromptOpen(false);
            }}
            onCancel={() => setExtractPromptOpen(false)}
          />
        </div>
      )}

      {isInfillOpen && selection && (
        <div className="absolute left-3 right-3 top-14 z-10 flex items-center gap-2 border border-violet-500/50 bg-black p-2 shadow-uv-glow">
          <input
            autoFocus
            type="text"
            className="min-w-0 flex-1 border border-violet-700/60 bg-black px-2 py-1.5 text-sm text-violet-100 outline-none focus:border-violet-400"
            placeholder="Instruction (e.g. expand, tighten POV)"
            value={infillInstruction}
            onChange={(e) => setInfillInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInfillSubmit()}
            disabled={isInfilling}
          />
          <button
            type="button"
            onClick={handleInfillSubmit}
            disabled={isInfilling}
            className="shrink-0 border border-violet-500/70 bg-violet-950/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-violet-100 disabled:opacity-50"
          >
            {isInfilling ? "…" : "Run"}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsInfillOpen(false);
              setSelection(null);
            }}
            disabled={isInfilling}
            className="shrink-0 px-2 py-1.5 text-violet-600 hover:text-violet-300"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}

      {/* Editor Area — full width of pane */}
      <div className="relative min-h-0 flex-1 px-6 py-4 md:px-8 md:py-6 selection:bg-violet-500 selection:text-black">
        {/* 4 Corner Crosshairs for Document View */}
        {activeItem?.type === "document" && (
          <>
            <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-violet-500 z-50 pointer-events-none opacity-40"></div>
            <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-violet-500 z-50 pointer-events-none opacity-40"></div>
            <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-violet-500 z-50 pointer-events-none opacity-40"></div>
            <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-violet-500 z-50 pointer-events-none opacity-40"></div>
          </>
        )}

        <div className="flex h-full w-full flex-col">
          <div className="flex min-h-0 flex-1 gap-6">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                onCursorChange?.(e.target.selectionStart);
              }}
              onSelect={handleSelect}
              onBlur={() => handleSave(content)}
              onMouseUp={handleSelect}
              onKeyUp={handleSelect}
              placeholder="[ Start typing... ]"
              className="caret-violet-500 box-border h-full flex-1 min-w-0 resize-none overflow-y-auto bg-transparent font-body text-sm leading-relaxed text-violet-200 outline-none placeholder:text-violet-900 pb-4"
              spellCheck={false}
            />
              <div className="flex-1 min-w-0 h-full overflow-y-auto hidden lg:block text-violet-100/95 font-body text-sm leading-relaxed pb-4 border-l border-violet-900/30 pl-6">
                {previewTooBig && (
                  <div className="mb-2 text-[10px] font-mono text-violet-600/90 uppercase tracking-widest border border-violet-700/50 bg-black/30 px-2 py-1 w-fit">
                    [ PREVIEW TRUNCATED ]
                  </div>
                )}
                <WikiMarkdown content={previewForRender} onEntityLinkClick={onEntityLinkClick} resolveEntityPreview={resolveEntityPreview} />
              </div>
          </div>
          {highlightRange && (
            <button
              type="button"
              onClick={() => {
                if (textareaRef.current) {
                  textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
                }
              }}
              className="shrink-0 mt-1 text-[10px] uppercase tracking-wider text-emerald-400/80 border border-emerald-800/40 bg-emerald-950/20 px-2 py-1 text-left transition-opacity hover:bg-emerald-950/40 cursor-pointer"
            >
              NEW CONTENT APPENDED: +{highlightRange.end - highlightRange.start} chars
            </button>
          )}
        </div>
      </div>

      {/* Entity Link Suggestions Strip */}
      {entitySuggestions.length > 0 && (
        <div className="shrink-0 border-t border-violet-700/40 bg-black px-4 py-1.5 flex items-center gap-2 overflow-x-auto font-mono z-10">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-violet-500">
            LINKABLE: {entitySuggestions.length}
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {entitySuggestions.map((s) => (
              <span key={s.entityId} className="shrink-0 flex items-center border border-violet-700/60 bg-black">
                <button
                  type="button"
                  onClick={() => onEntityLinkClick(s.entityTitle)}
                  className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300 hover:text-violet-100 transition-colors"
                  title={`Open ${s.entityTitle}`}
                >
                  {s.matchText}
                </button>
                <button
                  type="button"
                  onClick={() => applyEntityLink(s)}
                  className="border-l border-violet-700/60 px-1.5 py-0.5 text-[10px] font-bold text-violet-500 hover:text-violet-300 transition-colors"
                  title="Insert link brackets"
                >
                  +
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer Status Bar */}
      <div className="shrink-0 border-t border-violet-800/40 bg-[#020005] px-4 py-1.5 flex justify-between items-center text-[10px] uppercase tracking-widest text-violet-600 font-mono z-10">
        <div className="flex gap-4">
          <span>{"INSERT_MODE"}</span>
          <span className="opacity-50">UTF-8</span>
        </div>
        <div className="flex gap-4">
          <span>{wordCount} WORDS</span>
          <span className={isSaving ? "text-violet-400 animate-pulse" : ""}>
            {isSaving ? "WRITING..." : "SAVED"}
          </span>
        </div>
      </div>
    </div>
  );
}