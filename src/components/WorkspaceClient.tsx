"use client";

import { useState, useEffect, useMemo } from "react";
import ProjectSidebar from "./ProjectSidebar";
import DocumentEditorPane from "./DocumentEditorPane";
import ChatPane from "./ChatPane";

export type Project = {
  id: string;
  name: string;
  storyOutline: string;
  loreBible: string;
  updatedAt?: string;
};
export type Folder = { id: string; name: string; type: "document" | "wiki"; projectId: string; };
export type Document = { id: string; title: string; content: string; projectId: string; folderId?: string | null; };
export type WikiEntry = { id: string; title: string; content: string; aliases: string; projectId: string; folderId?: string | null; };

export type ActiveItem = {
  type: "document" | "wiki" | "project_settings";
  id: string;
};

export default function WorkspaceClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const [documents, setDocuments] = useState<Document[]>([]);
  const [wikiEntries, setWikiEntries] = useState<WikiEntry[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  // Navigation History Stack
  const [history, setHistory] = useState<ActiveItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

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
    const [docsRes, wikiRes, foldersRes] = await Promise.all([
      fetch(`/api/documents?projectId=${projectId}`),
      fetch(`/api/wiki?projectId=${projectId}`),
      fetch(`/api/folders?projectId=${projectId}`),
    ]);
    if (docsRes.ok) setDocuments(await docsRes.json());
    if (wikiRes.ok) setWikiEntries(await wikiRes.json());
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
      setFolders([]);
      setHistory([]);
      setHistoryIndex(-1);
    }
  }, [activeProjectId]);

  const navigateTo = (item: ActiveItem) => {
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(item);
      return newHistory;
    });
    setHistoryIndex((prev) => prev + 1);
  };

  const goBack = () => {
    if (historyIndex > 0) setHistoryIndex((prev) => prev - 1);
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) setHistoryIndex((prev) => prev + 1);
  };

  const [statusClock, setStatusClock] = useState("");
  useEffect(() => {
    const tick = () =>
      setStatusClock(
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

  const activeProjectName =
    projects.find((p) => p.id === activeProjectId)?.name ?? null;

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-violet-600/40 bg-black px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400 [text-shadow:0_0_12px_rgba(167,139,250,0.5)]">
        <div className="flex min-w-0 items-center gap-3 relative">
          <div className="absolute inset-0 bg-violet-500/10 blur-xl opacity-50 pointer-events-none animate-pulse-fast"></div>
          <span className="font-heading tracking-wide text-violet-200">
            RHYOLITE_OS //
          </span>
          <span className="hidden text-violet-700 sm:inline">//</span>
          <span className="hidden truncate text-violet-500/90 sm:inline">
            {activeProjectName ? activeProjectName : "No project"}
          </span>
        </div>
        <time className="tabular-nums text-violet-500">{statusClock}</time>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          className="flex w-60 shrink-0 flex-col border-r border-violet-600/40 bg-black"
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
              folders={folders}
              onReloadProjectData={() =>
                activeProjectId && reloadProjectData(activeProjectId)
              }
              activeItem={activeItem}
              onNavigate={navigateTo}
            />
          </div>
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-violet-600/40 bg-black">
          <DocumentEditorPane
            activeItem={activeItem}
            documents={documents}
            wikiEntries={wikiEntries}
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
          />
        </main>

        <aside className="flex w-[min(24rem,100%)] min-w-0 shrink-0 flex-col bg-black sm:w-96">
          <ChatPane
            activeItem={activeItem}
            activeProjectId={activeProjectId}
            onAppendToDocument={async (text) => {
              if (activeItem?.type !== "document") return;
              const doc = documents.find((d) => d.id === activeItem.id);
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
    </div>
  );
}