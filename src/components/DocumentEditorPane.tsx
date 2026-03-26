"use client";

import { useState, useEffect, useRef } from "react";
import type { Project, Document, WikiEntry, ActiveItem } from "./WorkspaceClient";
import { WikiMarkdown } from "./WikiMarkdown";
import ProjectSettingsPane from "./ProjectSettingsPane";

export default function DocumentEditorPane({
  activeItem,
  documents,
  wikiEntries,
  projects,
  onReloadProjectData,
  onReloadProjects,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigate,
}: {
  activeItem: ActiveItem | null;
  documents: Document[];
  wikiEntries: WikiEntry[];
  projects: Project[];
  onReloadProjectData: () => void;
  onReloadProjects: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (item: ActiveItem) => void;
}) {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  
  // Infill state
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  const [isInfillOpen, setIsInfillOpen] = useState(false);
  const [infillInstruction, setInfillInstruction] = useState("");
  const [isInfilling, setIsInfilling] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeDoc = activeItem?.type === "document" ? documents.find((d) => d.id === activeItem.id) : null;
  const activeWiki = activeItem?.type === "wiki" ? wikiEntries.find((w) => w.id === activeItem.id) : null;
  const settingsProject =
    activeItem?.type === "project_settings"
      ? projects.find((p) => p.id === activeItem.id) ?? null
      : null;
  const itemData = activeDoc || activeWiki;

  useEffect(() => {
    if (itemData) {
      setContent(itemData.content || "");
      setTitle(itemData.title || "");
    } else {
      setContent("");
      setTitle("");
    }
  }, [itemData]);

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

    const endpoint = activeItem.type === "document" ? `/api/documents/${activeItem.id}` : `/api/wiki/${activeItem.id}`;
    await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent }),
    });
    setIsSaving(false);
    onReloadProjectData();
  };

  const handleSelect = () => {
    if (!textareaRef.current) return;
    const t = textareaRef.current;
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

  const onWikiLinkClick = (wikiTitle: string) => {
    // Find wiki entry by title or alias
    const lowerTitle = wikiTitle.toLowerCase();
    const entry = wikiEntries.find(
      (w) => w.title.toLowerCase() === lowerTitle || w.aliases.toLowerCase().split(",").map(s => s.trim()).includes(lowerTitle)
    );
    if (entry) {
      onNavigate({ type: "wiki", id: entry.id });
    } else {
      alert(`Wiki entry "${wikiTitle}" not found in this project.`);
    }
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  if (!activeItem || !itemData) {
    return (
      <div className="flex h-full items-center justify-center border-b border-violet-900/50 px-4 text-sm text-violet-700">
        <p>Select a chapter or wiki entry to start writing.</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-violet-600/40 px-3 py-2">
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
            [{activeItem.type === "document" ? "Chapter" : "Wiki"}]
          </span>
          <h2 className="min-w-0 truncate font-heading text-base font-semibold text-violet-100 [text-shadow:0_0_14px_rgba(167,139,250,0.2)]">
            {title}
          </h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-violet-500">
          {selection && !isInfilling && (
            <>
              <button
                type="button"
                onClick={async () => {
                  const wikiTitle = prompt("New Wiki Entry Name:");
                  if (wikiTitle && itemData?.projectId) {
                    const res = await fetch("/api/wiki", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        title: wikiTitle,
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
                }}
                className="border border-violet-700/60 bg-black px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200 hover:border-violet-500"
              >
                Extract → Wiki
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
          <button
            type="button"
            onClick={() => setIsPreview(!isPreview)}
            className="border border-violet-800/80 bg-black px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-300 hover:border-violet-600"
          >
            {isPreview ? "Edit" : "Preview"}
          </button>
          <span className="tabular-nums text-violet-600">{wordCount} w</span>
          {isSaving && (
            <span className="animate-pulse text-violet-400">Saving…</span>
          )}
        </div>
      </div>

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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-6 md:py-4">
        {isPreview ? (
          <div className="w-full text-violet-100/95 font-body text-lg leading-relaxed">
            <WikiMarkdown content={content} onWikiLinkClick={onWikiLinkClick} />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              handleSelect();
            }}
            onSelect={handleSelect}
            onBlur={() => handleSave(content)}
            onMouseUp={handleSelect}
            onKeyUp={handleSelect}
            placeholder="Start writing…"
            className="box-border min-h-[calc(100vh-8rem)] w-full resize-none bg-transparent font-body text-lg leading-relaxed text-violet-100/90 outline-none placeholder:text-violet-900"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}