import { useState } from "react";
import Link from "next/link";
import type { Project, Document, WikiEntry, ActiveItem, Folder } from "./WorkspaceClient";

export default function ProjectSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onReloadProjects,
  documents,
  wikiEntries,
  folders,
  onReloadProjectData,
  activeItem,
  onNavigate,
}: {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onReloadProjects: () => void;
  documents: Document[];
  wikiEntries: WikiEntry[];
  folders: Folder[];
  onReloadProjectData: () => void;
  activeItem: ActiveItem | null;
  onNavigate: (item: ActiveItem) => void;
}) {
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjectName }),
    });
    if (res.ok) {
      setNewProjectName("");
      setIsCreatingProject(false);
      onReloadProjects();
    }
  };

  const handleCreateDocument = async () => {
    if (!activeProjectId) return;
    const title = prompt("Document title:");
    if (!title) return;
    await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, projectId: activeProjectId }),
    });
    onReloadProjectData();
  };

  const handleCreateWiki = async () => {
    if (!activeProjectId) return;
    const title = prompt("Wiki entry title:");
    if (!title) return;
    await fetch("/api/wiki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, projectId: activeProjectId }),
    });
    onReloadProjectData();
  };

  const handleCreateFolder = async (type: "document" | "wiki") => {
    if (!activeProjectId) return;
    const name = prompt("Folder name:");
    if (!name) return;
    await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, projectId: activeProjectId }),
    });
    onReloadProjectData();
  };

  const handleMoveItem = async (itemType: "document" | "wiki", itemId: string, targetFolderId: string | null) => {
    const endpoint = itemType === "document" ? `/api/documents/${itemId}` : `/api/wiki/${itemId}`;
    await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: targetFolderId }),
    });
    onReloadProjectData();
  };

  const onDragStart = (e: React.DragEvent, type: "document" | "wiki", id: string) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ type, id }));
    // A little cyberpunk visual trick on drag
    if (e.target instanceof HTMLElement) {
      e.target.style.opacity = "0.5";
    }
  };

  const onDragEnd = (e: React.DragEvent) => {
    if (e.target instanceof HTMLElement) {
      e.target.style.opacity = "1";
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = async (e: React.DragEvent, targetType: "document" | "wiki", targetFolderId: string | null) => {
    e.preventDefault();
    const dataStr = e.dataTransfer.getData("application/json");
    if (!dataStr) return;
    try {
      const data = JSON.parse(dataStr);
      if (data.type === targetType) {
         await handleMoveItem(data.type, data.id, targetFolderId);
      }
    } catch (err) {}
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const renderDocumentItem = (doc: Document, depth: number = 0) => {
    const isActive = activeItem?.type === "document" && activeItem.id === doc.id;
    return (
      <div
        key={doc.id}
        draggable
        onDragStart={(e) => onDragStart(e, "document", doc.id)}
        onDragEnd={onDragEnd}
        className={`group/item relative border-b border-violet-900/40 ${depth > 0 ? "pl-4" : ""}`}
      >
        <button
          onClick={() => onNavigate({ type: "document", id: doc.id })}
          className={`flex w-full items-center gap-2 px-2 py-2 pr-8 text-left transition-colors ${
            isActive
              ? "border-l-2 border-violet-400 bg-violet-950/50 text-violet-100 [text-shadow:0_0_10px_rgba(167,139,250,0.2)]"
              : "border-l-2 border-transparent text-violet-300/80 hover:bg-violet-950/30 hover:text-violet-100"
          }`}
        >
          <svg className="h-4 w-4 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <span className="truncate">{doc.title}</span>
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            const newTitle = prompt("Rename document:", doc.title);
            if (newTitle && newTitle !== doc.title) {
              await fetch(`/api/documents/${doc.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: newTitle }),
              });
              onReloadProjectData();
            }
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 hover:text-violet-300 transition-opacity p-1"
          title="Rename"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      </div>
    );
  };

  const renderWikiItem = (wiki: WikiEntry, depth: number = 0) => {
    const isActive = activeItem?.type === "wiki" && activeItem.id === wiki.id;
    return (
      <div
        key={wiki.id}
        draggable
        onDragStart={(e) => onDragStart(e, "wiki", wiki.id)}
        onDragEnd={onDragEnd}
        className={`group/item relative border-b border-violet-900/40 ${depth > 0 ? "pl-4" : ""}`}
      >
        <button
          onClick={() => onNavigate({ type: "wiki", id: wiki.id })}
          className={`flex w-full items-center gap-2 px-2 py-2 pr-8 text-left transition-colors ${
            isActive
              ? "border-l-2 border-violet-400 bg-violet-950/50 text-violet-100 [text-shadow:0_0_10px_rgba(167,139,250,0.2)]"
              : "border-l-2 border-transparent text-violet-300/80 hover:bg-violet-950/30 hover:text-violet-100"
          }`}
        >
          <svg className="h-4 w-4 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
          <span className="truncate">{wiki.title}</span>
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            const newTitle = prompt("Rename wiki entry:", wiki.title);
            if (newTitle && newTitle !== wiki.title) {
              await fetch(`/api/wiki/${wiki.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: newTitle }),
              });
              onReloadProjectData();
            }
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 hover:text-violet-300 transition-opacity p-1"
          title="Rename"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col gap-0 overflow-y-auto text-sm text-violet-100/90">
      <div className="flex flex-col gap-2 border-b border-violet-600/30 px-3 py-3">
        <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-500">
          Project
        </label>
        {isCreatingProject ? (
          <form onSubmit={handleCreateProject} className="flex gap-2">
            <input
              type="text"
              autoFocus
              className="flex-1 border border-violet-600/50 bg-black px-2 py-1.5 text-violet-100 placeholder-violet-800 outline-none focus:border-violet-400 focus:shadow-uv-glow"
              placeholder="Name..."
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            <button
              type="submit"
              className="border border-violet-500/60 bg-violet-950/80 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-200 hover:border-violet-400 hover:bg-violet-900/60"
            >
              Save
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <select
              className="flex-1 truncate border border-violet-600/50 bg-black py-1.5 pl-2 pr-8 text-sm text-violet-100 outline-none hover:border-violet-500/70 focus:border-violet-400 focus:shadow-uv-glow"
              value={activeProjectId || ""}
              onChange={(e) => {
                if (e.target.value === "__NEW__") {
                  setIsCreatingProject(true);
                } else {
                  onSelectProject(e.target.value);
                }
              }}
            >
              <option value="" disabled>Select a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="__NEW__">+ New Project</option>
            </select>
          </div>
        )}
      </div>

      {activeProjectId && (
        <>
          <div 
            className="flex flex-col gap-1 border-b border-violet-600/30 px-3 py-3 min-h-[100px]"
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, "document", null)}
          >
            <div className="group flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-500">
                Story
              </span>
              <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => handleCreateFolder("document")}
                  className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 hover:text-violet-300"
                  title="New Folder"
                >
                  + Fld
                </button>
                <button
                  type="button"
                  onClick={handleCreateDocument}
                  className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 hover:text-violet-300"
                  title="New Document"
                >
                  + Doc
                </button>
              </div>
            </div>
            <div className="flex flex-col">
              {folders.filter(f => f.type === "document").map(folder => (
                <div key={folder.id} className="flex flex-col border-b border-violet-900/40">
                  <div 
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-violet-400 hover:bg-violet-950/30 hover:text-violet-200 cursor-pointer"
                    onClick={() => toggleFolder(folder.id)}
                    onDragOver={onDragOver}
                    onDrop={(e) => { e.stopPropagation(); onDrop(e, "document", folder.id); }}
                  >
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={expandedFolders.has(folder.id) ? "M19.5 8.25l-7.5 7.5-7.5-7.5" : "M8.25 4.5l7.5 7.5-7.5 7.5"} />
                    </svg>
                    <svg className="h-4 w-4 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                    </svg>
                    <span className="truncate font-semibold text-xs uppercase tracking-wider">{folder.name}</span>
                  </div>
                  {expandedFolders.has(folder.id) && (
                    <div className="flex flex-col border-l-2 border-violet-900/30 ml-2">
                      {documents.filter(d => d.folderId === folder.id).map(d => renderDocumentItem(d, 1))}
                    </div>
                  )}
                </div>
              ))}
              {documents.filter(d => !d.folderId).map(d => renderDocumentItem(d, 0))}
              {documents.length === 0 && folders.filter(f => f.type === "document").length === 0 && (
                <span className="px-2 py-2 text-xs text-violet-800">No documents yet</span>
              )}
            </div>
          </div>

          <div 
            className="flex flex-col gap-1 border-b border-violet-600/30 px-3 py-3 min-h-[100px]"
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, "wiki", null)}
          >
            <div className="group flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-500">
                Lore Wiki
              </span>
              <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => handleCreateFolder("wiki")}
                  className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 hover:text-violet-300"
                  title="New Folder"
                >
                  + Fld
                </button>
                <button
                  type="button"
                  onClick={handleCreateWiki}
                  className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 hover:text-violet-300"
                  title="New Wiki"
                >
                  + Wiki
                </button>
              </div>
            </div>
            <div className="flex flex-col">
              {folders.filter(f => f.type === "wiki").map(folder => (
                <div key={folder.id} className="flex flex-col border-b border-violet-900/40">
                  <div 
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-violet-400 hover:bg-violet-950/30 hover:text-violet-200 cursor-pointer"
                    onClick={() => toggleFolder(folder.id)}
                    onDragOver={onDragOver}
                    onDrop={(e) => { e.stopPropagation(); onDrop(e, "wiki", folder.id); }}
                  >
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={expandedFolders.has(folder.id) ? "M19.5 8.25l-7.5 7.5-7.5-7.5" : "M8.25 4.5l7.5 7.5-7.5 7.5"} />
                    </svg>
                    <svg className="h-4 w-4 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                    </svg>
                    <span className="truncate font-semibold text-xs uppercase tracking-wider">{folder.name}</span>
                  </div>
                  {expandedFolders.has(folder.id) && (
                    <div className="flex flex-col border-l-2 border-violet-900/30 ml-2">
                      {wikiEntries.filter(w => w.folderId === folder.id).map(w => renderWikiItem(w, 1))}
                    </div>
                  )}
                </div>
              ))}
              {wikiEntries.filter(w => !w.folderId).map(w => renderWikiItem(w, 0))}
              {wikiEntries.length === 0 && folders.filter(f => f.type === "wiki").length === 0 && (
                <span className="px-2 py-2 text-xs text-violet-800">No entries yet</span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 px-3 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-500">
                System
              </span>
            </div>
            <div className="mt-1 flex flex-col border border-violet-800/50">
              <button
                type="button"
                onClick={() => {
                  if (!activeProjectId) return;
                  onNavigate({ type: "project_settings", id: activeProjectId });
                }}
                className={`flex items-center gap-2 border-b border-violet-900/40 px-2 py-2 text-left transition-colors last:border-b-0 ${
                  activeItem?.type === "project_settings" &&
                  activeItem.id === activeProjectId
                    ? "border-l-2 border-violet-400 bg-violet-950/50 text-violet-100"
                    : "border-l-2 border-transparent text-violet-300/80 hover:bg-violet-950/30 hover:text-violet-100"
                }`}
              >
                <svg className="h-4 w-4 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="truncate">Project Settings</span>
              </button>

              <Link
                href="/glyphs"
                className="flex items-center gap-2 border-l-2 border-transparent px-2 py-2 text-left text-violet-300/80 transition-colors hover:bg-violet-950/30 hover:text-violet-100"
              >
                <svg className="h-4 w-4 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                </svg>
                <span className="truncate">Manage Glyphs</span>
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}