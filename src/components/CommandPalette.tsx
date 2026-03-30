"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type SearchResultItem = {
  id: string;
  type: "document" | "wiki" | "timeline" | "event";
  title: string;
  snippet: string;
  score: number;
};

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  onNavigate: (item: { type: "document" | "wiki" | "timeline"; id: string }) => void;
};

const TYPE_BADGES: Record<SearchResultItem["type"], { label: string; color: string }> = {
  document: { label: "DOC", color: "text-cyan-400 border-cyan-500/60" },
  wiki:     { label: "ART", color: "text-fuchsia-400 border-fuchsia-500/60" },
  timeline: { label: "TLN", color: "text-amber-400 border-amber-500/60" },
  event:    { label: "EVT", color: "text-emerald-400 border-emerald-500/60" },
};

const NAV_TYPE_MAP: Record<SearchResultItem["type"], "document" | "wiki" | "timeline"> = {
  document: "document",
  wiki: "wiki",
  timeline: "timeline",
  event: "timeline",
};

export default function CommandPalette({ open, onClose, projectId, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const fetchResults = useCallback(
    async (q: string) => {
      if (!q.trim() || !projectId) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&projectId=${encodeURIComponent(projectId)}`
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data.results ?? []);
        }
      } catch {
        /* network error — silently ignore */
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => fetchResults(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchResults]);

  const selectResult = useCallback(
    (item: SearchResultItem) => {
      onNavigate({ type: NAV_TYPE_MAP[item.type], id: item.id });
      onClose();
    },
    [onNavigate, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        selectResult(results[selectedIndex]);
      }
    },
    [onClose, results, selectedIndex, selectResult]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* palette */}
      <div
        className="relative z-10 flex w-full max-w-xl flex-col border border-violet-500/60 bg-[#020005] shadow-[0_0_40px_rgba(139,92,246,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header bar */}
        <div className="flex items-center gap-2 border-b border-violet-500/40 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.25em] text-violet-600 font-mono">
          <span className="text-violet-400">&gt;_</span>
          COMMAND_SEARCH
          <span className="ml-auto text-[8px] text-violet-700 tracking-widest">ESC TO CLOSE</span>
        </div>

        {/* input */}
        <div className="border-b border-violet-500/40 px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={projectId ? "Search documents, articles, timelines..." : "No project selected"}
            disabled={!projectId}
            className="w-full bg-transparent font-mono text-sm text-violet-100 placeholder:text-violet-700 outline-none caret-violet-400 disabled:opacity-40"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {!projectId && (
            <div className="px-4 py-6 text-center font-mono text-xs text-violet-700 uppercase tracking-widest">
              [ NO PROJECT SELECTED ]
            </div>
          )}

          {projectId && loading && (
            <div className="px-4 py-4 text-center font-mono text-xs text-violet-600 uppercase tracking-widest animate-pulse">
              SCANNING...
            </div>
          )}

          {projectId && !loading && query.trim() && results.length === 0 && (
            <div className="px-4 py-6 text-center font-mono text-xs text-violet-700 uppercase tracking-widest">
              NO MATCHES FOUND
            </div>
          )}

          {results.map((item, idx) => {
            const badge = TYPE_BADGES[item.type];
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={`${item.type}-${item.id}-${idx}`}
                type="button"
                className={`flex w-full items-start gap-3 px-3 py-2 text-left font-mono transition-colors ${
                  isSelected
                    ? "bg-violet-950/60 border-l-2 border-violet-400"
                    : "border-l-2 border-transparent hover:bg-violet-950/30"
                }`}
                onClick={() => selectResult(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span
                  className={`mt-0.5 shrink-0 border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${badge.color}`}
                >
                  {badge.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-violet-200">{item.title}</div>
                  <div className="mt-0.5 truncate text-[10px] text-violet-600">{item.snippet}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* footer */}
        {results.length > 0 && (
          <div className="border-t border-violet-500/40 px-3 py-1.5 text-[8px] font-bold uppercase tracking-[0.2em] text-violet-700 font-mono">
            {results.length} RESULT{results.length !== 1 ? "S" : ""} — ↑↓ NAVIGATE — ENTER TO SELECT
          </div>
        )}
      </div>
    </div>
  );
}
