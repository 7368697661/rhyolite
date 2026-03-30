"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import ProjectSidebar from "./ProjectSidebar";
import DocumentEditorPane from "./DocumentEditorPane";
import ChatPane from "./ChatPane";
import CommandPalette from "./CommandPalette";
import { useHotkeys } from "@/lib/useHotkeys";

export type Project = {
  id: string;
  name: string;
  storyOutline: string;
  loreBible: string;
  updatedAt?: string;
};
export type Folder = { id: string; name: string; type: "document" | "wiki" | "timeline"; projectId: string; };
export type Document = { id: string; title: string; content: string; projectId: string; folderId?: string | null; };
export type WikiEntry = { id: string; title: string; content: string; aliases: string; projectId: string; folderId?: string | null; };
export type Timeline = { id: string; title: string; projectId: string; };

export type ActiveItem = {
  type: "document" | "wiki" | "timeline" | "project_settings" | "network";
  id: string;
};

function StatusClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <time className="tabular-nums font-mono text-[11px] text-violet-300">{time}</time>;
}

export default function WorkspaceClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const [documents, setDocuments] = useState<Document[]>([]);
  const [wikiEntries, setWikiEntries] = useState<WikiEntry[]>([]);
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  const [activeTimelineEventId, setActiveTimelineEventId] = useState<string | null>(null);
  const [editorCursorPos, setEditorCursorPos] = useState<number>(0);

  // Navigation History Stack
  const [history, setHistory] = useState<ActiveItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyIndexRef = useRef(historyIndex);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  const activeItem = history[historyIndex] ?? null;

  const reloadProjects = async () => {
    const res = await fetch("/api/projects");
    if (res.ok) {
      const data = await res.json();
      const normalized = (data as Project[]).map((p) => ({
        ...p,
        loreBible: p.loreBible ?? "",
        storyOutline: p.storyOutline ?? "",
      }));
      setProjects(normalized);
      if (normalized.length > 0 && !activeProjectId) {
        setActiveProjectId(normalized[0].id);
      }
    }
  };

  useEffect(() => {
    reloadProjects();
  }, []);

  const reloadProjectData = async (projectId: string) => {
    const [docsRes, wikiRes, timelinesRes, foldersRes] = await Promise.all([
      fetch(`/api/documents?projectId=${projectId}`),
      fetch(`/api/wiki?projectId=${projectId}`),
      fetch(`/api/timelines?projectId=${projectId}`),
      fetch(`/api/folders?projectId=${projectId}`),
    ]);
    if (docsRes.ok) setDocuments(await docsRes.json());
    if (wikiRes.ok) setWikiEntries(await wikiRes.json());
    if (timelinesRes.ok) setTimelines(await timelinesRes.json());
    if (foldersRes.ok) setFolders(await foldersRes.json());
  };

  useEffect(() => {
    if (activeProjectId) {
      reloadProjectData(activeProjectId);
      // Reset navigation history when changing projects
      setHistory([]);
      setHistoryIndex(-1);
    } else {
      setDocuments([]);
      setWikiEntries([]);
      setTimelines([]);
      setFolders([]);
      setHistory([]);
      setHistoryIndex(-1);
    }
  }, [activeProjectId]);

  const navigateTo = (item: ActiveItem) => {
    const idx = historyIndexRef.current;
    setHistory((prev) => {
      const newHistory = prev.slice(0, idx + 1);
      newHistory.push(item);
      return newHistory;
    });
    setHistoryIndex(idx + 1);
  };

  const goBack = () => {
    if (historyIndex > 0) setHistoryIndex((prev) => prev - 1);
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) setHistoryIndex((prev) => prev + 1);
  };

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const activeProjectName =
    projects.find((p) => p.id === activeProjectId)?.name ?? null;

  useHotkeys(
    useMemo(
      () => ({
        "mod+1": () => {
          if (activeItem) {
            const mainEl = document.querySelector("main");
            if (mainEl) (mainEl as HTMLElement).focus();
          }
        },
        "mod+2": () => {
          const chatInput = document.getElementById("chat-input");
          if (chatInput) chatInput.focus();
        },
        "mod+shift+n": () => {},
      }),
      [activeItem]
    )
  );

  return (
    <div className="flex h-full w-full flex-col relative font-sans text-violet-300">
      {/* Cyberpunk Top Bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-violet-500/60 bg-[#020005] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400 shadow-[0_0_15px_rgba(139,92,246,0.15)] relative">
        <div className="absolute inset-0 bg-violet-900/10 blur-xl opacity-30 pointer-events-none animate-pulse-fast"></div>
        
        <div className="flex items-center gap-6 z-10">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-violet-400 tracking-widest [text-shadow:0_0_14px_rgba(167,139,250,0.35)]">
              &gt;_
            </span>
            <span className="font-heading text-lg tracking-[0.3em] text-violet-200 [text-shadow:0_0_10px_rgba(167,139,250,0.8)]">
              RHYOLITE//
            </span>
          </div>
          <div className="hidden sm:flex flex-col border-l border-violet-800/60 pl-4">
            <span className="text-[8px] text-violet-600 tracking-[0.3em]">Gateway Route</span>
            <span className="text-violet-300 font-mono tracking-widest text-[11px]">127.0.0.1</span>
          </div>
          <div className="hidden md:flex flex-col border-l border-violet-800/60 pl-4">
            <span className="text-[8px] text-violet-600 tracking-[0.3em]">Active Project</span>
            <span className="text-violet-400 font-mono text-[10px]">
              {activeProjectName ? `sys/${activeProjectName.replace(/\s+/g, "_")}` : "[ NONE ]"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6 z-10">
          <div className="hidden lg:flex flex-col border-r border-violet-800/60 pr-4 text-right">
            <span className="text-[8px] text-violet-600 tracking-[0.3em]">Project_Index</span>
            <span className="text-violet-300 font-mono text-[11px] tracking-widest tabular-nums">
              DOCS:{documents.length} ARTS:{wikiEntries.length} TLNS:{timelines.length}
            </span>
          </div>

          <button
            type="button"
            disabled={!activeProjectId}
            onClick={() => {
              if (!activeProjectId) return;
              navigateTo({ type: "network", id: activeProjectId });
            }}
            className={`hidden sm:flex items-center gap-2 border border-violet-700/60 bg-black px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-violet-300 hover:border-violet-400 hover:bg-violet-950/40 disabled:opacity-40 disabled:cursor-not-allowed`}
            title="Global Network Map"
          >
            <span className="font-mono">&gt;&gt;</span>
            [ GLOBAL_NETWORK ]
          </button>
          <div className="flex flex-col text-right">
            <span className="text-[8px] text-violet-600 tracking-[0.3em]">Local Time</span>
            <StatusClock />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 relative">
        <nav
          className="flex w-60 shrink-0 flex-col border-r border-violet-500/50 bg-[#020005]"
          aria-label="Project navigation"
        >
          <div className="min-h-0 flex-1 overflow-hidden">
            <ProjectSidebar
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
              onReloadProjects={reloadProjects}
              documents={documents}
              wikiEntries={wikiEntries}
              timelines={timelines}
              folders={folders}
              onReloadProjectData={() =>
                activeProjectId && reloadProjectData(activeProjectId)
              }
              activeItem={activeItem}
              onNavigate={navigateTo}
            />
          </div>
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-violet-500/50 bg-[#050308] relative">
          <DocumentEditorPane
            activeItem={activeItem}
            documents={documents}
            wikiEntries={wikiEntries}
            timelines={timelines}
            projects={projects}
            onReloadProjectData={() =>
              activeProjectId && reloadProjectData(activeProjectId)
            }
            onReloadProjects={reloadProjects}
            canGoBack={historyIndex > 0}
            canGoForward={historyIndex < history.length - 1}
            onBack={goBack}
            onForward={goForward}
            onNavigate={navigateTo}
            activeTimelineEventId={activeTimelineEventId}
            onTimelineEventSelect={setActiveTimelineEventId}
            onCursorChange={setEditorCursorPos}
          />
        </main>

        <aside className="flex w-[min(24rem,100%)] min-w-0 shrink-0 flex-col bg-[#020005] sm:w-96">
          <ChatPane
            activeItem={activeItem}
            activeProjectId={activeProjectId}
            activeTimelineEventId={activeTimelineEventId}
            cursorPosition={editorCursorPos}
            onAppendToDocument={async (text) => {
              let targetDocId: string | null = null;
              if (activeTimelineEventId) {
                try {
                  const res = await fetch(
                    `/api/timeline/nodes/${activeTimelineEventId}`
                  );
                  if (res.ok) {
                    const node = await res.json();
                    if (
                      node.referenceType === "document" &&
                      node.referenceId
                    ) {
                      targetDocId = node.referenceId;
                    }
                  }
                } catch {
                  /* ignore */
                }
              }
              if (!targetDocId && activeItem?.type === "document") {
                targetDocId = activeItem.id;
              }
              if (!targetDocId) return;
              const doc = documents.find((d) => d.id === targetDocId);
              if (!doc) return;
              const newContent = doc.content
                ? `${doc.content}\n\n${text}`
                : text;
              await fetch(`/api/documents/${doc.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: newContent }),
              });
              if (activeProjectId) reloadProjectData(activeProjectId);
            }}
          />
        </aside>
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        projectId={activeProjectId}
        onNavigate={(item) => {
          navigateTo(item);
        }}
      />
    </div>
  );
}