"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  chainFromTip,
  childrenByParent,
  extendTipFromModel,
  messagesById,
  parseBranchChoices,
  siblingModelsForUser,
} from "@/lib/messageBranch";

type ChatMessage = {
  id: string;
  role: "user" | "model";
  content: string;
  createdAt: string;
  parentMessageId: string | null;
};

type AttachmentDraft = {
  id: string;
  filename: string;
  mimeType: string;
  base64?: string;
  text?: string;
  previewUrl?: string;
};

function SendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 12 3 21l18-9L3 3l3 9Zm0 0h7"
      />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-8.5 8.5a2 2 0 0 1-2.83-2.83l8.49-8.49"
      />
    </svg>
  );
}

function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => (
          <a
            {...props}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 opacity-90 hover:opacity-100"
          >
            {children}
          </a>
        ),
        code: ({ className, children }) => {
          const isInline = !className;
          return isInline ? (
            <code className="border border-violet-800/60 bg-violet-950/40 px-1 py-0.5 text-[0.9em] text-violet-200">
              {children}
            </code>
          ) : (
            <code className="block overflow-x-auto border border-violet-700/40 bg-black p-3 text-[0.9em] text-violet-100/90">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <pre className="my-2">{children}</pre>,
        ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
        p: ({ children }) => <p className="my-1.5">{children}</p>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

const messageBody =
  "w-full whitespace-pre-wrap px-3 py-3 text-sm leading-relaxed text-violet-100/90 md:px-4";

export default function ChatThread({
  chatId,
  onAppendToDocument,
}: {
  chatId: string;
  onAppendToDocument?: (text: string) => void;
}) {
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [activeTipMessageId, setActiveTipMessageId] = useState<string | null>(
    null
  );
  const [branchChoices, setBranchChoices] = useState<Record<string, string>>(
    {}
  );

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamDraft, setStreamDraft] = useState("");
  const [streamRole, setStreamRole] = useState<"chat" | "regen" | null>(null);
  
  const [safetyPreset, setSafetyPreset] = useState<"none" | "low" | "medium" | "high">("none");

  const abortControllerRef = useRef<AbortController | null>(null);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [isReadingAttachments, setIsReadingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadMessages = useCallback(async () => {
    const res = await fetch(`/api/chats/${chatId}/messages`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages: ChatMessage[];
      chat: {
        activeTipMessageId: string | null;
        branchChoicesJson: string;
      };
    };
    setAllMessages(data.messages);
    setActiveTipMessageId(data.chat.activeTipMessageId);
    setBranchChoices(parseBranchChoices(data.chat.branchChoicesJson));
  }, [chatId]);

  useEffect(() => {
    loadMessages().catch(() => {});
  }, [loadMessages]);

  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(a.previewUrl);
        }
      }
    };
  }, [attachments]);

  const childrenMap = useMemo(
    () => childrenByParent(allMessages),
    [allMessages]
  );

  const displayPath = useMemo(() => {
    if (!activeTipMessageId || allMessages.length === 0) return [];
    const byId = messagesById(allMessages);
    return chainFromTip(activeTipMessageId, byId);
  }, [allMessages, activeTipMessageId]);

  const continuedFromModelMessageId = useMemo(() => {
    for (let i = displayPath.length - 1; i >= 0; i--) {
      if (displayPath[i].role === "model") return displayPath[i].id;
    }
    return undefined;
  }, [displayPath]);

  const lastUserOnPath = useMemo(() => {
    for (let i = displayPath.length - 1; i >= 0; i--) {
      if (displayPath[i].role === "user") return displayPath[i];
    }
    return null;
  }, [displayPath]);

  const lastModelOnPath = useMemo(() => {
    for (let i = displayPath.length - 1; i >= 0; i--) {
      if (displayPath[i].role === "model") return displayPath[i];
    }
    return null;
  }, [displayPath]);

  const canSend = useMemo(() => {
    return (
      !isStreaming && !isReadingAttachments && input.trim().length > 0
    );
  }, [input, isStreaming, isReadingAttachments]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [displayPath.length, isStreaming, streamDraft]);

  async function persistBranchSwitch(
    nextChoices: Record<string, string>,
    modelId: string
  ) {
    const kids = childrenByParent(allMessages);
    const newTip = extendTipFromModel(modelId, kids, nextChoices);
    await fetch(`/api/chats/${chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchChoicesJson: JSON.stringify(nextChoices),
        activeTipMessageId: newTip,
      }),
    });
    await loadMessages();
  }

  async function readAttachmentFile(file: File): Promise<AttachmentDraft> {
    const filename = file.name || "pasted-image.png";
    const mimeType = file.type || "application/octet-stream";
    const id = `${filename}-${file.size}-${Date.now()}`;

    const isImage = mimeType.startsWith("image/");
    const isText =
      mimeType.startsWith("text/") ||
      /\.(txt|md|markdown|csv|json)$/i.test(filename);

    if (isImage) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Failed to read file."));
        reader.readAsDataURL(file);
      });

      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      return {
        id,
        filename,
        mimeType,
        base64,
        previewUrl: dataUrl,
      };
    }

    if (isText) {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Failed to read file."));
        reader.readAsText(file);
      });
      return { id, filename, mimeType: "text/plain", text };
    }

    throw new Error("Unsupported file type (use images or text files).");
  }

  async function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsReadingAttachments(true);
    try {
      const max = 5;
      const toRead = Array.from(files).slice(0, max);
      const drafts: AttachmentDraft[] = [];

      for (const f of toRead) {
        drafts.push(await readAttachmentFile(f));
      }

      setAttachments((prev) => [...prev, ...drafts].slice(0, 5));
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Failed to read files."
      );
    } finally {
      setIsReadingAttachments(false);
      if (e.target) e.target.value = "";
    }
  }

  async function addFilesFromClipboard(files: File[]) {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setIsReadingAttachments(true);
    try {
      const drafts: AttachmentDraft[] = [];
      for (const f of imageFiles.slice(0, 5)) {
        drafts.push(await readAttachmentFile(f));
      }
      setAttachments((prev) => [...prev, ...drafts].slice(0, 5));
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Failed to read pasted image."
      );
    } finally {
      setIsReadingAttachments(false);
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.files;
    if (items && items.length > 0) {
      const arr = Array.from(items);
      if (arr.some((f) => f.type.startsWith("image/"))) {
        e.preventDefault();
        addFilesFromClipboard(arr).catch(() => {});
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const found = prev.find((x) => x.id === id);
      if (found?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(found.previewUrl);
      }
      return prev.filter((x) => x.id !== id);
    });
  }

  async function onSend() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || isReadingAttachments) return;

    const snapshotAttachments = attachments;
    const attachmentLabel =
      snapshotAttachments.length > 0
        ? `\n\n[Attachments: ${snapshotAttachments
            .map((a) => a.filename)
            .join(", ")}]`
        : "";

    setInput("");
    setAttachments([]);
    setIsStreaming(true);
    setStreamRole("chat");
    setStreamDraft("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          message: trimmed,
          continuedFromModelMessageId: continuedFromModelMessageId ?? null,
          safetyPreset,
          attachments: snapshotAttachments.map((a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            base64: a.base64,
            text: a.text,
          })),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Chat request failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let modelText = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunkText = decoder.decode(value, { stream: true });
        if (!chunkText) continue;

        modelText += chunkText;
        setStreamDraft(modelText);
      }
    } catch {
      // aborted / network
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamRole(null);
      setStreamDraft("");
      await loadMessages().catch(() => {});
    }
  }

  async function onRegenerate() {
    if (isStreaming || !lastUserOnPath) return;

    setIsStreaming(true);
    setStreamRole("regen");
    setStreamDraft("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/chat/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, safetyPreset }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Regenerate request failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let modelText = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunkText = decoder.decode(value, { stream: true });
        if (!chunkText) continue;

        modelText += chunkText;
        setStreamDraft(modelText);
      }
    } catch {
      // ignore
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamRole(null);
      setStreamDraft("");
      await loadMessages().catch(() => {});
    }
  }

  function onStop() {
    abortControllerRef.current?.abort();
  }

  function renderForkControls(userMsgId: string, currentModelId: string) {
    const siblings = siblingModelsForUser(userMsgId, childrenMap);
    if (siblings.length <= 1) return null;

    const idx = siblings.findIndex((s) => s.id === currentModelId);
    const safeIdx = idx === -1 ? siblings.length - 1 : idx;

    return (
      <div className="flex items-center gap-2 pl-1">
        <button
          type="button"
          onClick={() => {
            if (safeIdx <= 0) return;
            const next = siblings[safeIdx - 1];
            const nextChoices = { ...branchChoices, [userMsgId]: next.id };
            setBranchChoices(nextChoices);
            persistBranchSwitch(nextChoices, next.id).catch(() => {});
          }}
          disabled={safeIdx <= 0}
          className="border border-violet-800/70 bg-black px-2 py-1 text-xs text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous generation"
        >
          ←
        </button>
        <div className="text-[10px] tabular-nums text-violet-600">
          {safeIdx + 1}/{siblings.length}
        </div>
        <button
          type="button"
          onClick={() => {
            if (safeIdx >= siblings.length - 1) return;
            const next = siblings[safeIdx + 1];
            const nextChoices = { ...branchChoices, [userMsgId]: next.id };
            setBranchChoices(nextChoices);
            persistBranchSwitch(nextChoices, next.id).catch(() => {});
          }}
          disabled={safeIdx >= siblings.length - 1}
          className="border border-violet-800/70 bg-black px-2 py-1 text-xs text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next generation"
        >
          →
        </button>
      </div>
    );
  }

  const showRegenOnLastModel =
    lastModelOnPath &&
    lastUserOnPath &&
    displayPath.length >= 2 &&
    displayPath[displayPath.length - 1]?.id === lastModelOnPath.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-violet-600/40 px-3 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500">
          Assistant
        </span>
        <span className="ml-2 text-[10px] text-violet-800">// comms</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {displayPath.length === 0 && !isStreaming ? (
          <div className="border-b border-violet-900/50 px-3 py-4 text-xs uppercase tracking-wider text-violet-800">
            No traffic — send to open channel.
          </div>
        ) : null}

        <div className="divide-y divide-violet-800/50">
          {displayPath.map((m, i) => {
            const isUser = m.role === "user";
            const prev = i > 0 ? displayPath[i - 1] : null;

            return (
              <div key={m.id} className="flex flex-col">
                <div className={messageBody}>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                    {isUser ? "You" : "Model"}
                  </div>
                  <div
                    className={
                      isUser
                        ? "text-violet-100/95"
                        : "text-violet-200 [text-shadow:0_0_12px_rgba(167,139,250,0.12)]"
                    }
                  >
                    <Markdown content={m.content} />
                  </div>
                </div>
                {!isUser && prev?.role === "user" ? (
                  <div className="border-t border-violet-900/50 px-3 py-2 md:px-4">
                    {renderForkControls(prev.id, m.id)}
                  </div>
                ) : null}
                {!isUser &&
                showRegenOnLastModel &&
                m.id === lastModelOnPath?.id ? (
                  <div className="flex flex-wrap gap-2 border-t border-violet-900/50 px-3 py-2 md:px-4">
                    <button
                      type="button"
                      onClick={() => onRegenerate().catch(() => {})}
                      disabled={isStreaming}
                      className="border border-violet-600/50 bg-violet-950/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200 hover:border-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Regenerate response"
                      title="Regenerate response"
                    >
                      Regen
                    </button>
                    {onAppendToDocument && (
                      <button
                        type="button"
                        onClick={() => onAppendToDocument(m.content)}
                        disabled={isStreaming}
                        className="border border-violet-800/80 bg-black px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-400 hover:border-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Append to document"
                      >
                        + Doc
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}

          {isStreaming && streamDraft ? (
            <div className={messageBody}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                Model
              </div>
              <div className="text-violet-200 [text-shadow:0_0_12px_rgba(167,139,250,0.12)]">
                <Markdown content={streamDraft} />
              </div>
            </div>
          ) : null}

          {isStreaming && !streamDraft && streamRole ? (
            <div className="border-b border-violet-900/50 px-3 py-3 text-xs uppercase tracking-wider text-violet-700">
              Processing…
            </div>
          ) : null}
        </div>

        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-violet-600/40 p-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,text/plain,.md,.markdown,.csv,.json"
              className="hidden"
              onChange={onFileInputChange}
            />
            <label className="sr-only" htmlFor="chat-input">
              Message
            </label>
            <textarea
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={2}
              onPaste={onPaste}
              className="min-h-[44px] w-full resize-none border border-violet-700/50 bg-black px-3 py-2 text-sm text-violet-100 outline-none placeholder:text-violet-900 focus:border-violet-400 focus:shadow-uv-glow"
              placeholder="Transmit…"
              disabled={isStreaming || isReadingAttachments}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend().catch(() => {});
                }
              }}
            />

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.15em] text-violet-600">
                  Safety
                </span>
                <select
                  value={safetyPreset}
                  onChange={(e) =>
                    setSafetyPreset(
                      e.target.value as "none" | "low" | "medium" | "high"
                    )
                  }
                  className="max-w-[140px] border border-violet-800/70 bg-black px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-violet-300 outline-none hover:border-violet-600 disabled:opacity-50"
                  disabled={isStreaming}
                >
                  <option value="none">BLOCK_NONE</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            {attachments.length > 0 ? (
              <div className="mt-2 max-h-32 overflow-y-auto">
                <div className="flex flex-wrap gap-2">
                  {attachments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 border border-violet-800/60 bg-violet-950/30 p-1.5 pr-2 text-xs text-violet-200"
                    >
                      {a.previewUrl ? (
                        <img
                          src={a.previewUrl}
                          alt=""
                          className="h-10 w-10 border border-violet-900/50 object-cover"
                        />
                      ) : null}
                      <span className="max-w-[120px] truncate">{a.filename}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(a.id)}
                        className="px-1 text-violet-600 hover:text-red-400"
                        aria-label={`Remove ${a.filename}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex h-10 shrink-0 items-center justify-center border border-violet-500/60 bg-violet-950/80 px-4 text-xs font-bold uppercase tracking-wider text-violet-200 hover:border-violet-400"
            >
              Abort
            </button>
          ) : (
            <div className="flex shrink-0 flex-col gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isReadingAttachments}
                className="inline-flex h-10 w-10 items-center justify-center border border-violet-800/70 bg-black text-violet-400 hover:border-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Attach files"
                title="Attach files"
              >
                <PaperclipIcon />
              </button>

              <button
                type="button"
                onClick={() => onSend().catch(() => {})}
                disabled={!canSend}
                className="inline-flex h-10 w-10 items-center justify-center border border-violet-500/60 bg-violet-950/80 text-violet-200 hover:border-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send"
                title="Send"
              >
                <SendIcon />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
