"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Glyph = {
  id: string;
  name: string;
  systemInstruction: string;
  provider: "gemini" | "openai" | "anthropic";
  model: string;
  temperature: number;
  maxOutputTokens: number;
};

export default function GlyphsPage() {
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const [editing, setEditing] = useState<Glyph | null>(null);
  const [availableProviders, setAvailableProviders] = useState<string[]>(["gemini"]);

  useEffect(() => {
    fetch("/api/glyphs").then((r) => r.json()).then(setGlyphs).catch(() => {});
    fetch("/api/providers").then((r) => r.json()).then((d) => setAvailableProviders(d.providers ?? ["gemini"])).catch(() => {});
  }, []);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get("name") as string,
      systemInstruction: fd.get("systemInstruction") as string,
      provider: fd.get("provider") as string || "gemini",
      model: fd.get("model") as string,
      temperature: parseFloat(fd.get("temperature") as string) || 0.7,
      maxOutputTokens: parseInt(fd.get("maxOutputTokens") as string, 10) || 2048,
    };

    if (editing) {
      const res = await fetch(`/api/glyphs/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = await res.json();
        setGlyphs((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
        setEditing(null);
      }
    } else {
      const res = await fetch("/api/glyphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const created = await res.json();
        setGlyphs((prev) => [created, ...prev]);
      }
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this Glyph?")) return;
    const res = await fetch(`/api/glyphs/${id}`, { method: "DELETE" });
    if (res.ok) {
      setGlyphs((prev) => prev.filter((g) => g.id !== id));
      if (editing?.id === id) setEditing(null);
    }
  }

  return (
    <div className="flex h-screen w-full flex-col font-sans text-violet-300">
      {/* Top Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-violet-500/60 bg-[#020005] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400 shadow-[0_0_15px_rgba(139,92,246,0.15)] relative z-10">
        <div className="flex items-center gap-6 z-10">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-violet-500 animate-pulse"></span>
            <span className="font-heading text-lg tracking-[0.3em] text-violet-200 [text-shadow:0_0_10px_rgba(167,139,250,0.8)]">
              RHYOLITE_OS
            </span>
          </div>
          <div className="hidden sm:flex flex-col border-l border-violet-800/60 pl-4">
            <span className="text-[8px] text-violet-600 tracking-[0.3em]">SYS.MODULE</span>
            <span className="text-violet-300 font-mono tracking-widest text-[11px]">GLYPH_CONFIG</span>
          </div>
        </div>
        <div className="flex items-center gap-6 z-10">
          <Link
            href="/workspace"
            className="border border-violet-500/60 bg-violet-950/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-200 hover:border-violet-400 hover:bg-violet-900/60 transition-colors"
          >
            [ ← RETURN_TO_WORKSPACE ]
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-[#050308] relative">
        <div className="mx-auto max-w-4xl border-x border-violet-500/50 px-4 py-6 md:px-6 min-h-full">
          <div className="mb-6 flex flex-col gap-1 border-b border-violet-600/50 pb-4">
            <h1 className="font-heading text-2xl font-bold tracking-[0.2em] text-violet-100 [text-shadow:0_0_14px_rgba(167,139,250,0.8)] uppercase">
              Glyph_Registry
            </h1>
            <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-violet-500 font-mono">
              Persona & model profiles
            </p>
          </div>

          <div className="grid gap-0 border border-violet-500/50 md:grid-cols-2 md:divide-x md:divide-violet-500/50 font-mono">
            <div className="border-b border-violet-500/50 p-4 md:border-b-0 md:p-5">
              <h2 className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500 font-mono">
                {editing ? "[ EDIT_GLYPH ]" : "[ NEW_GLYPH ]"}
              </h2>
          <form onSubmit={handleSave} className="flex flex-col gap-4 font-mono">
            <div className="relative border border-violet-700/50 bg-[#020005] p-3">
              <div className="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l border-violet-500"></div>
              <div className="absolute top-0 right-0 w-1.5 h-1.5 border-t border-r border-violet-500"></div>
              <div className="absolute bottom-0 left-0 w-1.5 h-1.5 border-b border-l border-violet-500"></div>
              <div className="absolute bottom-0 right-0 w-1.5 h-1.5 border-b border-r border-violet-500"></div>
              
              <div className="flex flex-col gap-4">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-violet-600">
                    &gt; Name
                  </label>
                  <input
                    key={`name-${editing?.id || "new"}`}
                    name="name"
                    defaultValue={editing?.name}
                    required
                    className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400 focus:shadow-uv-glow"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-violet-600">
                    &gt; Provider
                  </label>
                  <select
                    key={`provider-${editing?.id || "new"}`}
                    name="provider"
                    defaultValue={editing?.provider || "gemini"}
                    className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400 focus:shadow-uv-glow"
                  >
                    {availableProviders.map((p) => (
                      <option key={p} value={p} className="bg-black">{p.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-violet-600">
                    &gt; Model
                  </label>
                  <input
                    key={`model-${editing?.id || "new"}`}
                    name="model"
                    defaultValue={editing?.model || "gemini-3.1-pro-preview"}
                    required
                    className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400 focus:shadow-uv-glow"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-violet-600">
                      &gt; Temp
                    </label>
                    <input
                      key={`temp-${editing?.id || "new"}`}
                      name="temperature"
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      defaultValue={editing?.temperature ?? 0.7}
                      className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400 focus:shadow-uv-glow"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-violet-600">
                      &gt; Max tok
                    </label>
                    <input
                      key={`tokens-${editing?.id || "new"}`}
                      name="maxOutputTokens"
                      type="number"
                      defaultValue={editing?.maxOutputTokens ?? 2048}
                      className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400 focus:shadow-uv-glow"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-violet-600">
                    &gt; System instruction
                  </label>
                  <textarea
                    key={`instructions-${editing?.id || "new"}`}
                    name="systemInstruction"
                    defaultValue={editing?.systemInstruction}
                    rows={5}
                    className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400 focus:shadow-uv-glow"
                  />
                </div>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="submit"
                className="border border-violet-500/70 bg-violet-950/80 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-violet-100 hover:border-violet-400 hover:bg-violet-900/60 transition-colors"
              >
                [ {editing ? "UPDATE_GLYPH" : "CREATE_GLYPH"} ]
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="border border-violet-800/80 bg-black px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500 hover:border-violet-600 hover:bg-violet-950/30 transition-colors"
                >
                  [ CANCEL ]
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="flex flex-col">
          {glyphs.map((g) => (
            <div
              key={g.id}
              className="group flex flex-col gap-2 border-b border-violet-500/50 p-4 last:border-b-0 hover:bg-violet-950/20 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-violet-500 opacity-50 font-bold">&gt;</span>
                  <h3 className="font-heading text-base font-bold text-violet-100 uppercase tracking-wider">{g.name}</h3>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setEditing(g)}
                    className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400 hover:text-violet-200"
                  >
                    [EDIT]
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(g.id)}
                    className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-500/90 hover:text-red-400"
                  >
                    [DEL]
                  </button>
                </div>
              </div>
              <div className="text-[10px] uppercase tracking-widest text-violet-600 pl-4 border-l border-violet-800/50 ml-1">
                {(g.provider || "gemini").toUpperCase()}:{g.model} · TEMP:{g.temperature}
              </div>
              <div className="line-clamp-2 text-xs text-violet-500/80 pl-4 border-l border-violet-800/50 ml-1 mt-1">
                {g.systemInstruction || "—"}
              </div>
            </div>
          ))}
          {glyphs.length === 0 && (
            <div className="p-4 text-xs font-bold uppercase tracking-[0.2em] text-violet-800 animate-pulse">
              [ NO_GLYPHS_FOUND ]
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
      
  {/* Footer System Bar */}
      <footer className="shrink-0 flex items-center justify-between border-t border-violet-500/60 bg-[#020005] px-4 py-1.5 text-[10px] uppercase tracking-widest text-violet-600 font-mono shadow-[0_0_15px_rgba(139,92,246,0.15)] relative z-10">
        <div className="flex gap-4">
          <span>SYS_MEM: <span className="text-violet-400">ALLOCATED</span></span>
          <span className="hidden sm:inline">REGISTRY: <span className="text-violet-400">{glyphs.length} ACTIVE</span></span>
        </div>
        <div className="flex gap-4 items-center">
          <span className="hidden sm:inline opacity-50">NODE_LOCAL</span>
          <span className="text-violet-400 font-bold animate-pulse">■</span>
        </div>
      </footer>
    </div>
  );
}