"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Glyph = {
  id: string;
  name: string;
  systemInstruction: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
};

export default function GlyphsPage() {
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const [editing, setEditing] = useState<Glyph | null>(null);

  useEffect(() => {
    fetch("/api/glyphs")
      .then((r) => r.json())
      .then(setGlyphs)
      .catch(() => {});
  }, []);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get("name") as string,
      systemInstruction: fd.get("systemInstruction") as string,
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
    <div className="mx-auto max-w-4xl border-x border-violet-800/40 px-4 py-6 md:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-violet-600/40 pb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-violet-100 [text-shadow:0_0_14px_rgba(167,139,250,0.15)]">
            Glyphs
          </h1>
          <p className="mt-1 text-xs uppercase tracking-wider text-violet-700">
            Persona & model profiles
          </p>
        </div>
        <Link
          href="/workspace"
          className="border border-violet-700/60 bg-black px-3 py-2 text-xs font-semibold uppercase tracking-wide text-violet-300 hover:border-violet-500"
        >
          ← Workspace
        </Link>
      </div>

      <div className="grid gap-0 border border-violet-800/50 md:grid-cols-2 md:divide-x md:divide-violet-800/50">
        <div className="border-b border-violet-800/50 p-4 md:border-b-0 md:p-5">
          <h2 className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500">
            {editing ? "Edit glyph" : "New glyph"}
          </h2>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-violet-600">
                Name
              </label>
              <input
                key={`name-${editing?.id || "new"}`}
                name="name"
                defaultValue={editing?.name}
                required
                className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-violet-600">
                Model
              </label>
              <input
                key={`model-${editing?.id || "new"}`}
                name="model"
                defaultValue={editing?.model || "gemini-3.1-pro-preview"}
                required
                className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-violet-600">
                  Temp
                </label>
                <input
                  key={`temp-${editing?.id || "new"}`}
                  name="temperature"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  defaultValue={editing?.temperature ?? 0.7}
                  className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-violet-600">
                  Max tok
                </label>
                <input
                  key={`tokens-${editing?.id || "new"}`}
                  name="maxOutputTokens"
                  type="number"
                  defaultValue={editing?.maxOutputTokens ?? 2048}
                  className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-violet-600">
                System instruction
              </label>
              <textarea
                key={`instructions-${editing?.id || "new"}`}
                name="systemInstruction"
                defaultValue={editing?.systemInstruction}
                rows={5}
                className="w-full border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none focus:border-violet-400"
              />
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="submit"
                className="border border-violet-500/70 bg-violet-950/80 px-4 py-2 text-xs font-bold uppercase tracking-wider text-violet-100 hover:border-violet-400"
              >
                {editing ? "Update" : "Create"}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="border border-violet-800/80 bg-black px-4 py-2 text-xs font-semibold uppercase tracking-wide text-violet-500 hover:border-violet-600"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="flex flex-col">
          {glyphs.map((g) => (
            <div
              key={g.id}
              className="flex flex-col gap-2 border-b border-violet-900/50 p-4 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-heading text-base font-semibold text-violet-100">{g.name}</h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(g)}
                    className="text-[10px] font-semibold uppercase tracking-wide text-violet-400 hover:text-violet-300"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(g.id)}
                    className="text-[10px] font-semibold uppercase tracking-wide text-red-500/90 hover:text-red-400"
                  >
                    Del
                  </button>
                </div>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-violet-700">
                {g.model} · temp {g.temperature}
              </div>
              <div className="line-clamp-2 text-sm text-violet-600">
                {g.systemInstruction || "—"}
              </div>
            </div>
          ))}
          {glyphs.length === 0 && (
            <div className="p-4 text-sm text-violet-800">No glyphs.</div>
          )}
        </div>
      </div>
    </div>
  );
}