"use client";

import { useState, useEffect } from "react";
import type { Project } from "./WorkspaceClient";

export default function ProjectSettingsPane({
  project,
  onReloadProjects,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  project: Project;
  onReloadProjects: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  const [storyOutline, setStoryOutline] = useState(project.storyOutline || "");
  const [loreBible, setLoreBible] = useState(project.loreBible || "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setStoryOutline(project.storyOutline || "");
    setLoreBible(project.loreBible || "");
  }, [project.id]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyOutline, loreBible }),
      });
      onReloadProjects();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
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
            [Settings]
          </span>
          <h2 className="min-w-0 truncate font-heading text-base font-semibold text-violet-100 [text-shadow:0_0_14px_rgba(167,139,250,0.2)]">
            {project.name}
          </h2>
        </div>
        <div className="text-xs text-violet-600">
          {isSaving && <span className="animate-pulse text-violet-400">Saving…</span>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto">
        <div className="flex flex-col gap-2 border-b border-violet-800/40 px-4 py-4 md:px-6">
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-500">
            Story outline (Always-on)
          </label>
          <p className="text-xs text-violet-800">
            High-level sequence and direction. Injected into system memory permanently.
          </p>
          <textarea
            value={storyOutline}
            onChange={(e) => setStoryOutline(e.target.value)}
            onBlur={handleSave}
            placeholder="e.g. Ch.1 — arrival. Ch.2 — the pact…"
            className="min-h-[220px] w-full resize-y border border-violet-700/50 bg-black p-3 text-sm leading-relaxed text-violet-100/90 outline-none focus:border-violet-400 focus:shadow-uv-glow"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-2 px-4 py-4 md:px-6">
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-500">
            Core Canon / Metaphysics (Always-on)
          </label>
          <p className="text-xs text-violet-800">
            Hard invariants, tone, and world rules. For specific characters/locations, use the Lore Wiki (they are retrieved dynamically via RAG).
          </p>
          <textarea
            value={loreBible}
            onChange={(e) => setLoreBible(e.target.value)}
            onBlur={handleSave}
            placeholder="Systems, factions, tone…"
            className="min-h-[280px] w-full flex-1 resize-y border border-violet-700/50 bg-black p-3 text-sm leading-relaxed text-violet-100/90 outline-none focus:border-violet-400 focus:shadow-uv-glow"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}