"use client";

import { useState, useEffect } from "react";
import ChatThread from "./ChatThread";
import type { ActiveItem } from "./WorkspaceClient";

type ChatPreview = { id: string; title: string; glyphId: string };

export default function ChatPane({
  activeItem,
  activeProjectId,
  activeTimelineEventId,
  onAppendToDocument,
}: {
  activeItem: ActiveItem | null;
  activeProjectId: string | null;
  activeTimelineEventId?: string | null;
  onAppendToDocument: (text: string) => void | Promise<void>;
}) {
  const [chat, setChat] = useState<ChatPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [glyphs, setGlyphs] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/glyphs")
      .then((r) => r.json())
      .then(setGlyphs);
  }, []);

  const loadChat = async (kind: "document" | "timeline", id: string) => {
    setIsLoading(true);
    const q =
      kind === "document" ? `documentId=${id}` : `timelineId=${id}`;
    const res = await fetch(`/api/chats?${q}`);
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
      loadChat("document", activeItem.id);
    } else if (activeItem?.type === "timeline") {
      loadChat("timeline", activeItem.id);
    } else {
      setChat(null);
    }
  }, [activeItem]);

  const handleCreateChat = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeProjectId) return;
    if (activeItem?.type !== "document" && activeItem?.type !== "timeline")
      return;

    const fd = new FormData(e.currentTarget);
    const glyphId = fd.get("glyphId") as string;

    if (!glyphId) {
      alert("Please select a Glyph.");
      return;
    }

    const body =
      activeItem.type === "document"
        ? {
            title: "Document Assistant",
            glyphId,
            documentId: activeItem.id,
          }
        : {
            title: "Timeline Assistant",
            glyphId,
            timelineId: activeItem.id,
          };

    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
      <div className="flex h-full items-center justify-center border-t border-violet-900/50 px-3 text-center text-[10px] uppercase tracking-widest text-violet-800 font-mono">
        <p>[ OFFLINE ]</p>
      </div>
    );
  }

  if (activeItem.type === "wiki" || activeItem.type === "project_settings") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 border-t border-violet-900/50 px-4 py-6 text-center font-mono">
        <span className="text-violet-800 text-2xl animate-pulse">_</span>
        <p className="text-[10px] text-violet-600 uppercase tracking-widest">
          SYS.{activeItem.type === "wiki" ? "LORE_DB" : "CONFIG"}
        </p>
        <p className="text-[9px] uppercase tracking-wider text-violet-800">
          [ COMMLINK UNAVAILABLE ]
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
    const ctxLabel =
      activeItem.type === "timeline" ? "timeline DAG" : "chapter";
    return (
      <div className="flex h-full min-h-0 flex-col border-t border-violet-900/50">
        <div className="border-b border-violet-600/40 px-3 py-2 bg-[#020005]">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500">
            :: Assistant_Initialization
          </h2>
          <p className="mt-1 text-xs text-violet-700 font-mono">
            Attach a glyph session to this {ctxLabel}.
          </p>
        </div>
        <div className="flex flex-1 flex-col justify-center px-4 py-6">
          <form
            onSubmit={handleCreateChat}
            className="mx-auto flex w-full max-w-sm flex-col gap-3 font-mono"
          >
            <div className="relative border border-violet-700/50 bg-[#020005] p-3">
              <div className="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l border-violet-500"></div>
              <div className="absolute top-0 right-0 w-1.5 h-1.5 border-t border-r border-violet-500"></div>
              <div className="absolute bottom-0 left-0 w-1.5 h-1.5 border-b border-l border-violet-500"></div>
              <div className="absolute bottom-0 right-0 w-1.5 h-1.5 border-b border-r border-violet-500"></div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500">
                &gt; Select_Glyph_Module
              </label>
              <select
                name="glyphId"
                className="w-full border border-violet-700/50 bg-black py-2 px-2 text-sm text-violet-100 outline-none focus:border-violet-400 focus:shadow-uv-glow"
                required
              >
                <option value="">[ NONE_SELECTED ]</option>
                {glyphs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="w-full border border-violet-500/70 bg-violet-950/80 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-200 hover:border-violet-400 hover:bg-violet-900/60 transition-colors"
            >
              [ INITIALIZE_UPLINK ]
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
        activeTimelineEventId={activeTimelineEventId}
        onAppendToDocument={onAppendToDocument}
        glyphId={chat.glyphId}
        glyphs={glyphs}
        projectId={activeProjectId}
        onChangeGlyph={async (glyphId) => {
          await fetch(`/api/chats/${chat.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ glyphId }),
          });
          setChat((prev) => (prev ? { ...prev, glyphId } : null));
        }}
      />
    </div>
  );
}
