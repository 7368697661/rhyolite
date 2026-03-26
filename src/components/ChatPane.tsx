"use client";

import { useState, useEffect } from "react";
import ChatThread from "./ChatThread";
import type { ActiveItem } from "./WorkspaceClient";

type ChatPreview = { id: string; title: string };

export default function ChatPane({
  activeItem,
  activeProjectId,
  onAppendToDocument,
}: {
  activeItem: ActiveItem | null;
  activeProjectId: string | null;
  onAppendToDocument: (text: string) => void;
}) {
  const [chat, setChat] = useState<ChatPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [glyphs, setGlyphs] = useState<{ id: string; name: string }[]>([]);

  // Fetch glyphs
  useEffect(() => {
    fetch("/api/glyphs").then((r) => r.json()).then(setGlyphs);
  }, []);

  const loadChat = async (docId: string) => {
    setIsLoading(true);
    const res = await fetch(`/api/chats?documentId=${docId}`);
    if (res.ok) {
      const chats = await res.json();
      if (chats.length > 0) {
        setChat(chats[0]);
      } else {
        setChat(null);
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (activeItem?.type === "document") {
      loadChat(activeItem.id);
    } else {
      setChat(null);
    }
  }, [activeItem]);

  const handleCreateChat = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (activeItem?.type !== "document") return;

    const fd = new FormData(e.currentTarget);
    const glyphId = fd.get("glyphId") as string;

    if (!glyphId) {
      alert("Please select a Glyph.");
      return;
    }

    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Document Assistant",
        glyphId,
        documentId: activeItem.id,
      }),
    });

    if (res.ok) {
      const newChat = await res.json();
      setChat(newChat);
    } else {
      alert("Failed to create chat");
    }
  };

  if (!activeItem) {
    return (
      <div className="flex h-full items-center justify-center border-t border-violet-900/50 px-3 text-center text-xs uppercase tracking-wider text-violet-800">
        <p>No item selected</p>
      </div>
    );
  }

  if (activeItem.type === "wiki" || activeItem.type === "project_settings") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 border-t border-violet-900/50 px-4 py-6 text-center">
        <svg
          className="h-10 w-10 text-violet-800"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
          />
        </svg>
        <p className="text-sm text-violet-600">
          Chat offline —{" "}
          {activeItem.type === "wiki" ? "Lore Wiki" : "Project Settings"}.
        </p>
        <p className="text-[10px] uppercase tracking-wider text-violet-800">
          Open a chapter to link the assistant.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs uppercase tracking-wider text-violet-700">
        Loading…
      </div>
    );
  }

  if (!chat) {
    return (
      <div className="flex h-full min-h-0 flex-col border-t border-violet-900/50">
        <div className="border-b border-violet-600/40 px-3 py-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500">
            Assistant
          </h2>
          <p className="mt-1 text-xs text-violet-700">
            Attach a glyph session to this chapter.
          </p>
        </div>
        <div className="flex flex-1 flex-col justify-center px-4 py-6">
          <form onSubmit={handleCreateChat} className="mx-auto flex w-full max-w-sm flex-col gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.15em] text-violet-500">
                Glyph
              </label>
              <select
                name="glyphId"
                className="w-full border border-violet-700/50 bg-black py-2 px-2 text-sm text-violet-100 outline-none focus:border-violet-400"
                required
              >
                <option value="">— Select —</option>
                {glyphs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="w-full border border-violet-500/70 bg-violet-950/80 py-2 text-xs font-bold uppercase tracking-[0.2em] text-violet-100 hover:border-violet-400"
            >
              Initialize
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 w-full">
      <ChatThread
        chatId={chat.id}
        onAppendToDocument={onAppendToDocument}
      />
    </div>
  );
}