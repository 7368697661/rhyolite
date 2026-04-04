"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sharedMarkdownComponents } from "./markdownComponents";
import TerminalPrompt, { TerminalConfirm } from "./TerminalPrompt";
import {
  chainFromTip,
  childrenByParent,
  extendTipFromModel,
  messagesById,
  parseBranchChoices,
  siblingModelsForUser,
  type BranchMessage,
} from "@/lib/messageBranch";

import type { ChatMode, NdjsonEvent } from "@/lib/streamTypes";

type ToolCallDisplay = {
  callId?: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  ok?: boolean;
};

type PlanStep = {
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
  approved?: boolean;
};

type StreamError = { code: string; message: string; retryAfter?: number };

type PendingConfirm = {
  loopId: string;
  name: string;
  args: Record<string, unknown>;
  reason: string;
  callId?: string;
};

type SubAgentBlock = {
  glyphId: string;
  glyphName: string;
  text: string;
  done: boolean;
};

type ChatMessage = {
  id: string;
  role: "user" | "model";
  content: string;
  reasoningContent?: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    ok: boolean;
    confirmed?: boolean;
  }>;
  errors?: Array<{ code: string; message: string }>;
  createdAt: string;
  parentMessageId: string | null;
};

const REASONING_STORAGE_KEY = "rhyolite-comms-reasoning";
const MODE_STORAGE_KEY = "rhyolite-comms-mode";

/** After the first `__meta` line, server sends NDJSON events. */
async function consumeCommsSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handlers: {
    onTokenBudget: (b: TokenBudget) => void;
    onContentDelta: (s: string) => void;
    onReasoningDelta: (s: string) => void;
    onToolCall?: (tc: ToolCallDisplay) => void;
    onToolResult?: (tr: { callId?: string; name: string; result: unknown; ok: boolean }) => void;
    onConfirm?: (c: PendingConfirm) => void;
    onPlanProposal?: (steps: PlanStep[]) => void;
    onError?: (e: StreamError) => void;
    onStatus?: (s: string) => void;
    onSubAgent?: (d: { phase: "start" | "delta" | "end"; glyphId: string; glyphName: string; text?: string }) => void;
  }
) {
  const decoder = new TextDecoder();
  let buffer = "";
  let metaParsed = false;

  function processLine(trimmed: string) {
    if (!trimmed) return;
    try {
      const o = JSON.parse(trimmed) as NdjsonEvent;
      switch (o.t) {
        case "r":
          handlers.onReasoningDelta(o.d);
          break;
        case "c":
          handlers.onContentDelta(o.d);
          break;
        case "tc":
          handlers.onToolCall?.({ callId: o.d.callId, name: o.d.name, args: o.d.args });
          break;
        case "tr":
          handlers.onToolResult?.({ callId: o.d.callId, name: o.d.name, result: o.d.result, ok: o.d.ok });
          break;
        case "confirm":
          handlers.onConfirm?.(o.d);
          break;
        case "tp":
          handlers.onPlanProposal?.(o.d.map((s: any) => ({ tool: s.tool, args: s.args, rationale: s.rationale })));
          break;
        case "e":
          handlers.onError?.(o.d);
          break;
        case "s":
          handlers.onStatus?.(o.d);
          break;
        case "sub":
          handlers.onSubAgent?.(o.d);
          break;
      }
    } catch {
      /* ignore bad line */
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    buffer += decoder.decode(value, { stream: true });

    if (!metaParsed) {
      const nlIdx = buffer.indexOf("\n");
      if (nlIdx === -1) continue;
      const firstLine = buffer.slice(0, nlIdx);
      buffer = buffer.slice(nlIdx + 1);
      if (firstLine.startsWith('{"__meta":')) {
        try {
          const meta = JSON.parse(firstLine) as {
            __meta?: boolean;
            tokenBudget?: TokenBudget;
          };
          if (meta.__meta && meta.tokenBudget) {
            handlers.onTokenBudget(meta.tokenBudget);
          }
        } catch {
          /* malformed meta */
        }
      }
      metaParsed = true;
    }

    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      processLine(line.trim());
    }
  }

  const tail = buffer.trim();
  if (tail && metaParsed) {
    processLine(tail);
  }
}

type TokenBudget = {
  canon: number;
  wiki: number;
  dag: number;
  draft: number;
  history: number;
  total: number;
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

function TokenBudgetDisplay({ budget, estimate }: { budget: TokenBudget | null; estimate: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const handleEnter = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ x: r.right, y: r.bottom + 4 });
    }
    setOpen(true);
  };

  return (
    <div
      ref={ref}
      className="shrink-0 text-[9px] uppercase tracking-wider text-violet-700 font-mono cursor-default"
      onMouseEnter={handleEnter}
      onMouseLeave={() => setOpen(false)}
    >
      {budget ? (
        <span>CTX: ~{(budget.total / 1000).toFixed(1)}k</span>
      ) : (
        <span>ctx: ~{estimate.toLocaleString()}</span>
      )}
      {open && (
        <div
          className="fixed z-[9999] border border-violet-700/60 bg-black/95 px-3 py-2 text-[9px] font-mono text-violet-400 whitespace-nowrap shadow-lg"
          style={pos ? { top: pos.y, right: window.innerWidth - pos.x } : undefined}
        >
          {budget ? (
            <div className="flex flex-col gap-0.5">
              <span>CANON: <span className="text-violet-300">{budget.canon.toLocaleString()}</span></span>
              <span>WIKI: <span className="text-violet-300">{budget.wiki.toLocaleString()}</span></span>
              <span>DAG: <span className="text-violet-300">{budget.dag.toLocaleString()}</span></span>
              <span>DRAFT: <span className="text-violet-300">{budget.draft.toLocaleString()}</span></span>
              <span>HIST: <span className="text-violet-300">{budget.history.toLocaleString()}</span></span>
              <span className="border-t border-violet-800/50 pt-0.5 mt-0.5 text-violet-200">TOTAL: {budget.total.toLocaleString()}</span>
            </div>
          ) : (
            <span>Estimated ~{estimate.toLocaleString()} tokens</span>
          )}
        </div>
      )}
    </div>
  );
}

const Markdown = React.memo(function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={sharedMarkdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
});

function ReasoningBlock({
  text,
  autoExpandWhileStreaming,
}: {
  text: string;
  autoExpandWhileStreaming?: boolean;
}) {
  const [open, setOpen] = useState(!!autoExpandWhileStreaming);
  useEffect(() => {
    if (autoExpandWhileStreaming) setOpen(true);
  }, [autoExpandWhileStreaming, text]);
  if (!text.trim()) return null;
  return (
    <div className="mb-2 border border-violet-900/60 bg-black/70">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-2 py-1.5 text-left text-[9px] font-mono uppercase tracking-[0.2em] text-violet-500 hover:bg-violet-950/50"
      >
        {open ? "[−] " : "[+] "}
        Reasoning
      </button>
      {open ? (
        <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap border-t border-violet-900/40 px-2 py-2 text-[10px] font-mono leading-relaxed text-violet-500/90">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

function ToolCallCard({ tc }: { tc: ToolCallDisplay }) {
  const [open, setOpen] = useState(false);
  const statusIcon = tc.result === undefined
    ? "⏳"
    : tc.ok
      ? "✓"
      : "✗";
  const statusColor = tc.result === undefined
    ? "text-violet-500"
    : tc.ok
      ? "text-emerald-400"
      : "text-red-400";

  return (
    <div className="my-1 border border-violet-800/60 bg-violet-950/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] font-mono uppercase tracking-wider text-violet-400 hover:bg-violet-950/50"
      >
        <span className={statusColor}>{statusIcon}</span>
        <span className="text-violet-300">[TOOL]</span>
        <span className="text-violet-200">{tc.name}</span>
        <span className="ml-auto text-violet-700">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-violet-800/40 px-2 py-1.5">
          <div className="text-[9px] font-mono uppercase text-violet-600 mb-1">Args</div>
          <pre className="text-[10px] font-mono text-violet-400 max-h-32 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(tc.args, null, 2)}
          </pre>
          {tc.result !== undefined && (
            <>
              <div className="text-[9px] font-mono uppercase text-violet-600 mt-2 mb-1">Result</div>
              <pre className={`text-[10px] font-mono max-h-32 overflow-auto whitespace-pre-wrap ${tc.ok ? "text-emerald-400/80" : "text-red-400/80"}`}>
                {typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorBanner({ error }: { error: StreamError }) {
  const isRateLimit = error.code === "rate_limited";
  return (
    <div className={`my-1 border px-3 py-2 text-[10px] font-mono ${
      isRateLimit
        ? "border-amber-700/60 bg-amber-950/30 text-amber-300"
        : "border-red-700/60 bg-red-950/30 text-red-300"
    }`}>
      <span className="font-bold uppercase">[{error.code}]</span>{" "}
      {error.message}
      {isRateLimit && error.retryAfter && (
        <span className="ml-2 text-amber-500">
          (retry in ~{error.retryAfter}s)
        </span>
      )}
    </div>
  );
}

function ConfirmPrompt({
  confirm,
  onRespond,
}: {
  confirm: PendingConfirm;
  onRespond: (loopId: string, approved: boolean) => void;
}) {
  return (
    <div className="my-1 border border-amber-600/60 bg-amber-950/20 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-1">
        ⚠ Confirmation Required
      </div>
      <div className="text-[10px] font-mono text-amber-200 mb-1">
        <span className="text-amber-400">{confirm.name}</span>({Object.keys(confirm.args).join(", ")})
      </div>
      <div className="text-[10px] text-amber-300/80 mb-2">{confirm.reason}</div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onRespond(confirm.loopId, true)}
          className="border border-emerald-600/60 bg-emerald-950/40 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300 hover:border-emerald-400"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onRespond(confirm.loopId, false)}
          className="border border-red-600/60 bg-red-950/40 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-red-300 hover:border-red-400"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function PlanChecklist({
  steps,
  onExecute,
  isExecuting,
}: {
  steps: PlanStep[];
  onExecute: (approved: PlanStep[]) => void;
  isExecuting: boolean;
}) {
  const [checkedMap, setCheckedMap] = useState<Record<number, boolean>>(
    () => Object.fromEntries(steps.map((_, i) => [i, true]))
  );

  const toggle = (i: number) =>
    setCheckedMap((m) => ({ ...m, [i]: !m[i] }));

  const selectedSteps = steps.filter((_, i) => checkedMap[i]);

  return (
    <div className="my-1 border border-violet-700/60 bg-violet-950/20 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-violet-400 mb-2">
        Proposed Plan ({steps.length} steps)
      </div>
      <div className="space-y-1">
        {steps.map((step, i) => (
          <label key={i} className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={checkedMap[i] ?? true}
              onChange={() => toggle(i)}
              disabled={isExecuting}
              className="mt-0.5 accent-violet-500"
            />
            <div className="flex-1">
              <div className="text-[10px] font-mono text-violet-300">
                <span className="text-violet-500">{step.tool}</span>
                ({Object.keys(step.args).join(", ")})
              </div>
              <div className="text-[10px] text-violet-500 italic">{step.rationale}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={() => onExecute(selectedSteps)}
          disabled={isExecuting || selectedSteps.length === 0}
          className="border border-emerald-600/60 bg-emerald-950/40 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300 hover:border-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isExecuting ? "Executing..." : `Execute ${selectedSteps.length} steps`}
        </button>
      </div>
    </div>
  );
}

function SubAgentCard({ block }: { block: SubAgentBlock }) {
  const [open, setOpen] = useState(!block.done);
  useEffect(() => {
    if (!block.done) setOpen(true);
  }, [block.done, block.text]);

  return (
    <div className="my-1 border border-cyan-800/60 bg-cyan-950/20">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] font-mono uppercase tracking-wider text-cyan-400 hover:bg-cyan-950/40"
      >
        <span className={block.done ? "text-emerald-400" : "text-cyan-500 animate-pulse"}>
          {block.done ? "✓" : "◆"}
        </span>
        <span className="text-cyan-300">[SUB-AGENT]</span>
        <span className="text-cyan-200">{block.glyphName}</span>
        <span className="ml-auto text-cyan-700">{open ? "▾" : "▸"}</span>
      </button>
      {open && block.text && (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-cyan-800/40 px-2 py-1.5 text-[10px] font-mono leading-relaxed text-cyan-400/80">
          {block.text}
        </pre>
      )}
    </div>
  );
}

function StatusMessage({ text }: { text: string }) {
  return (
    <div className="my-0.5 text-[9px] font-mono uppercase tracking-wider text-violet-600 px-2">
      ◆ {text}
    </div>
  );
}

function HistoricToolCalls({ calls }: { calls: ChatMessage["toolCalls"] }) {
  if (!calls || calls.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {calls.map((tc, i) => (
        <ToolCallCard
          key={i}
          tc={{
            name: tc.name,
            args: tc.args,
            result: tc.result,
            ok: tc.ok,
          }}
        />
      ))}
    </div>
  );
}

function GlyphPicker({
  glyphs,
  glyphId,
  onChangeGlyph,
}: {
  glyphs: { id: string; name: string; isSculpter?: boolean }[];
  glyphId: string;
  onChangeGlyph: (id: string) => void | Promise<void>;
}) {
  const sculpters = glyphs.filter((g) => g.isSculpter !== false);
  const currentGlyph = glyphs.find((g) => g.id === glyphId);
  const currentIsSpecialist = currentGlyph?.isSculpter === false;
  const options = currentIsSpecialist && !sculpters.find((g) => g.id === glyphId)
    ? [...sculpters, currentGlyph!]
    : sculpters;

  return (
    <>
      <select
        value={glyphId}
        onChange={(e) => onChangeGlyph(e.target.value)}
        className="max-w-[120px] truncate bg-transparent border border-violet-800/70 text-violet-300 text-[10px] uppercase tracking-wider outline-none p-0.5"
      >
        {options.map((g) => (
          <option key={g.id} value={g.id} className="bg-black">
            {g.name}{g.isSculpter === false ? " (specialist)" : ""}
          </option>
        ))}
      </select>
      {currentIsSpecialist && (
        <span className="text-[8px] text-cyan-600 tracking-wider" title="This session uses a specialist glyph. Switch to a Sculpter for the standard comms list.">
          SPEC
        </span>
      )}
    </>
  );
}

const MODES: ChatMode[] = ["ask", "agent", "plan"];

const messageBody =
  "w-full whitespace-pre-wrap px-3 py-3 text-xs font-body leading-relaxed text-violet-100/90 md:px-4";

const MessageRow = React.memo(function MessageRow({
  m,
  isUser,
  prev,
  renderForkControls,
  showRegen,
  onRegenerate,
  onAppendToDocument,
  isStreaming,
  chatId,
  onMessagesMutated,
}: {
  m: BranchMessage;
  isUser: boolean;
  prev: BranchMessage | null;
  renderForkControls: (userMsgId: string, currentModelId: string) => React.ReactNode;
  showRegen: boolean;
  onRegenerate: () => void;
  onAppendToDocument?: (text: string) => void;
  isStreaming: boolean;
  chatId?: string;
  onMessagesMutated?: () => void | Promise<void>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  return (
    <div className="flex flex-col">
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
          {!isUser && m.reasoningContent ? (
            <ReasoningBlock text={m.reasoningContent} />
          ) : null}
          {!isUser && m.toolCalls?.length ? (
            <HistoricToolCalls calls={m.toolCalls} />
          ) : null}
          {!isUser && m.errors?.length ? (
            <div className="mt-1 space-y-0.5">
              {m.errors.map((e, i) => (
                <ErrorBanner key={i} error={e} />
              ))}
            </div>
          ) : null}
          <Markdown content={m.content} />
        </div>
      </div>
      {isUser && chatId ? (
        <>
          {editOpen ? (
            <div className="border-t border-violet-900/50 px-3 py-2 md:px-4">
              <TerminalPrompt
                label="Edit message"
                defaultValue={m.content}
                onSubmit={async (next) => {
                  await fetch(`/api/chats/${chatId}/messages/${m.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content: next }),
                  });
                  setEditOpen(false);
                  await onMessagesMutated?.();
                }}
                onCancel={() => setEditOpen(false)}
              />
            </div>
          ) : confirmDeleteOpen ? (
            <div className="border-t border-violet-900/50 px-3 py-2 md:px-4">
              <TerminalConfirm
                message="Delete this message and all replies under it?"
                onConfirm={async () => {
                  await fetch(`/api/chats/${chatId}/messages/${m.id}`, {
                    method: "DELETE",
                  });
                  setConfirmDeleteOpen(false);
                  await onMessagesMutated?.();
                }}
                onCancel={() => setConfirmDeleteOpen(false)}
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 border-t border-violet-900/50 px-3 py-2 md:px-4">
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => setEditOpen(true)}
                className="border border-violet-800/70 bg-black px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-400 hover:border-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => setConfirmDeleteOpen(true)}
                className="border border-red-900/60 bg-black px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-400/90 hover:border-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Del
              </button>
            </div>
          )}
        </>
      ) : null}
      {!isUser && chatId ? (
        <>
          {confirmDeleteOpen ? (
            <div className="border-t border-violet-900/50 px-3 py-2 md:px-4">
              <TerminalConfirm
                message="Delete this AI message and all replies under it?"
                onConfirm={async () => {
                  await fetch(`/api/chats/${chatId}/messages/${m.id}`, {
                    method: "DELETE",
                  });
                  setConfirmDeleteOpen(false);
                  await onMessagesMutated?.();
                }}
                onCancel={() => setConfirmDeleteOpen(false)}
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 border-t border-violet-900/50 px-3 py-2 md:px-4">
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => setConfirmDeleteOpen(true)}
                className="border border-red-900/60 bg-black px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-400/90 hover:border-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Del
              </button>
            </div>
          )}
        </>
      ) : null}
      {!isUser && prev?.role === "user" ? (
        <div className="border-t border-violet-900/50 px-3 py-2 md:px-4">
          {renderForkControls(prev.id, m.id)}
        </div>
      ) : null}
      {!isUser && showRegen ? (
        <div className="flex flex-wrap gap-2 border-t border-violet-900/50 px-3 py-2 md:px-4">
          <button
            type="button"
            onClick={onRegenerate}
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
});

type PromptTemplate = {
  id: string;
  projectId: string;
  name: string;
  template: string;
  createdAt: string;
};

export default function ChatThread({
  chatId,
  activeTimelineEventId,
  onAppendToDocument,
  glyphId,
  glyphs,
  onChangeGlyph,
  projectId,
  cursorPosition,
  onWorkspaceRefresh,
}: {
  chatId: string;
  activeTimelineEventId?: string | null;
  onAppendToDocument?: (text: string) => void;
  glyphId?: string;
  glyphs?: { id: string; name: string; isSculpter?: boolean }[];
  onChangeGlyph?: (id: string) => void | Promise<void>;
  projectId?: string | null;
  cursorPosition?: number;
  onWorkspaceRefresh?: () => void;
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
  const [streamContent, setStreamContent] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  const [streamRole, setStreamRole] = useState<"chat" | "regen" | null>(null);

  const [enableReasoning, setEnableReasoning] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("ask");

  useEffect(() => {
    try {
      const v = localStorage.getItem(REASONING_STORAGE_KEY);
      setEnableReasoning(v === "1" || v === "true");
      const m = localStorage.getItem(MODE_STORAGE_KEY) as ChatMode | null;
      if (m && MODES.includes(m)) setChatMode(m);
    } catch {
      /* private mode */
    }
  }, []);

  const toggleEnableReasoning = useCallback(() => {
    setEnableReasoning((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(REASONING_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const switchMode = useCallback((m: ChatMode) => {
    setChatMode(m);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, m);
    } catch { /* ignore */ }
  }, []);

  // Agent-mode streaming state
  const [streamToolCalls, setStreamToolCalls] = useState<ToolCallDisplay[]>([]);
  const [streamErrors, setStreamErrors] = useState<StreamError[]>([]);
  const [streamStatuses, setStreamStatuses] = useState<string[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [planProposal, setPlanProposal] = useState<PlanStep[] | null>(null);
  const [isExecutingPlan, setIsExecutingPlan] = useState(false);
  const [subAgentBlocks, setSubAgentBlocks] = useState<SubAgentBlock[]>([]);

  const [safetyPreset, setSafetyPreset] = useState<"none" | "low" | "medium" | "high">("none");
  const [estimatedTokens, setEstimatedTokens] = useState<number>(0);
  const [tokenBudget, setTokenBudget] = useState<TokenBudget | null>(null);

  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [templateNamePromptOpen, setTemplateNamePromptOpen] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement | null>(null);

  // Simple token estimator: ~3.5 chars per token for english text
  useEffect(() => {
    let totalChars = 0;
    for (const m of allMessages) {
      totalChars += m.content.length;
    }
    totalChars += input.length;
    // Add ~2000 chars overhead for base system prompt / draft context padding
    setEstimatedTokens(Math.ceil((totalChars + 2000) / 3.5));
  }, [allMessages, input]);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/prompts?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPromptTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!showTemplateMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setShowTemplateMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showTemplateMenu]);

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

  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    setIsAutoScroll(distanceToBottom < 30);
  }, []);

  useEffect(() => {
    if (isAutoScroll) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [
    displayPath.length,
    isStreaming,
    streamContent,
    streamReasoning,
    isAutoScroll,
  ]);

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
    setStreamContent("");
    setStreamReasoning("");
    setStreamToolCalls([]);
    setStreamErrors([]);
    setStreamStatuses([]);
    setPendingConfirm(null);
    setPlanProposal(null);
    setSubAgentBlocks([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          activeTimelineEventId,
          message: trimmed,
          continuedFromModelMessageId: continuedFromModelMessageId ?? null,
          safetyPreset,
          cursorPosition,
          enableReasoning,
          mode: chatMode,
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
      await consumeCommsSseStream(reader, {
        onTokenBudget: setTokenBudget,
        onContentDelta: (s) => setStreamContent((c) => c + s),
        onReasoningDelta: (s) => setStreamReasoning((r) => r + s),
        onToolCall: (tc) => setStreamToolCalls((prev) => [...prev, tc]),
        onToolResult: (tr) =>
          setStreamToolCalls((prev) =>
            prev.map((tc) =>
              tc.callId === tr.callId || (tc.name === tr.name && tc.result === undefined)
                ? { ...tc, result: tr.result, ok: tr.ok }
                : tc
            )
          ),
        onConfirm: (c) => setPendingConfirm(c),
        onPlanProposal: (steps) => setPlanProposal(steps),
        onError: (e) => setStreamErrors((prev) => [...prev, e]),
        onStatus: (s) => setStreamStatuses((prev) => [...prev, s]),
        onSubAgent: (d) => {
          setSubAgentBlocks((prev) => {
            if (d.phase === "start") return [...prev, { glyphId: d.glyphId, glyphName: d.glyphName, text: "", done: false }];
            if (d.phase === "end") return prev.map((b) => b.glyphId === d.glyphId && !b.done ? { ...b, done: true } : b);
            if (d.phase === "delta" && d.text) return prev.map((b) => b.glyphId === d.glyphId && !b.done ? { ...b, text: b.text + d.text } : b);
            return prev;
          });
        },
      });
    } catch {
      // aborted / network
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamRole(null);
      setStreamContent("");
      setStreamReasoning("");
      setStreamToolCalls([]);
      setStreamStatuses([]);
      setPendingConfirm(null);
      setSubAgentBlocks([]);
      await loadMessages().catch(() => {});
      if (chatMode !== "ask") onWorkspaceRefresh?.();
    }
  }

  const handleRegenerate = useCallback(async () => {
    if (isStreaming || !lastUserOnPath) return;

    setIsStreaming(true);
    setStreamRole("regen");
    setStreamContent("");
    setStreamReasoning("");
    setStreamToolCalls([]);
    setStreamErrors([]);
    setStreamStatuses([]);
    setPendingConfirm(null);
    setPlanProposal(null);
    setSubAgentBlocks([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/chat/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          activeTimelineEventId,
          safetyPreset,
          enableReasoning,
          mode: chatMode,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Regenerate request failed.");
      }

      const reader = res.body.getReader();
      await consumeCommsSseStream(reader, {
        onTokenBudget: setTokenBudget,
        onContentDelta: (s) => setStreamContent((c) => c + s),
        onReasoningDelta: (s) => setStreamReasoning((r) => r + s),
        onToolCall: (tc) => setStreamToolCalls((prev) => [...prev, tc]),
        onToolResult: (tr) =>
          setStreamToolCalls((prev) =>
            prev.map((tc) =>
              tc.callId === tr.callId || (tc.name === tr.name && tc.result === undefined)
                ? { ...tc, result: tr.result, ok: tr.ok }
                : tc
            )
          ),
        onConfirm: (c) => setPendingConfirm(c),
        onPlanProposal: (steps) => setPlanProposal(steps),
        onError: (e) => setStreamErrors((prev) => [...prev, e]),
        onStatus: (s) => setStreamStatuses((prev) => [...prev, s]),
        onSubAgent: (d) => {
          setSubAgentBlocks((prev) => {
            if (d.phase === "start") return [...prev, { glyphId: d.glyphId, glyphName: d.glyphName, text: "", done: false }];
            if (d.phase === "end") return prev.map((b) => b.glyphId === d.glyphId && !b.done ? { ...b, done: true } : b);
            if (d.phase === "delta" && d.text) return prev.map((b) => b.glyphId === d.glyphId && !b.done ? { ...b, text: b.text + d.text } : b);
            return prev;
          });
        },
      });
    } catch {
      // ignore
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamRole(null);
      setStreamContent("");
      setStreamReasoning("");
      setStreamToolCalls([]);
      setStreamStatuses([]);
      setPendingConfirm(null);
      setSubAgentBlocks([]);
      await loadMessages().catch(() => {});
      if (chatMode !== "ask") onWorkspaceRefresh?.();
    }
  }, [
    isStreaming,
    lastUserOnPath,
    chatId,
    chatMode,
    activeTimelineEventId,
    safetyPreset,
    enableReasoning,
    loadMessages,
    onWorkspaceRefresh,
  ]);

  function onStop() {
    abortControllerRef.current?.abort();
  }

  const renderForkControls = useCallback((userMsgId: string, currentModelId: string) => {
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
  }, [branchChoices, childrenMap, allMessages, chatId, loadMessages]);

  const handleMessagesMutated = useCallback(() => {
    loadMessages().catch(() => {});
  }, [loadMessages]);

  const showRegenOnLastModel =
    lastModelOnPath &&
    lastUserOnPath &&
    displayPath.length >= 2 &&
    displayPath[displayPath.length - 1]?.id === lastModelOnPath.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-violet-600/40 px-3 py-1.5 flex justify-between items-center">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-[10px] font-bold text-violet-500">&gt;_</span>
          {glyphs && glyphs.length > 0 && glyphId && onChangeGlyph ? (
            <GlyphPicker glyphs={glyphs} glyphId={glyphId} onChangeGlyph={onChangeGlyph} />
          ) : (
            <span className="text-[10px] text-violet-800">// comms</span>
          )}
          <button
            type="button"
            onClick={toggleEnableReasoning}
            disabled={isStreaming}
            title="Opt-in: request provider reasoning/thinking when supported (extra tokens & latency)."
            className="shrink-0 border border-violet-800/70 bg-black px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-violet-400 hover:border-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reasoning: {enableReasoning ? "ON" : "OFF"}
          </button>
          <div className="flex shrink-0 border border-violet-800/70 bg-black">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                disabled={isStreaming}
                className={`px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-40 ${
                  chatMode === m
                    ? "bg-violet-800/50 text-violet-100"
                    : "text-violet-500 hover:text-violet-300"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <TokenBudgetDisplay budget={tokenBudget} estimate={estimatedTokens} />
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {displayPath.length === 0 && !isStreaming ? (
        <div className="border-b border-violet-900/50 px-3 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-violet-700 font-mono mb-1">
            No messages yet
          </div>
          <div className="text-[9px] text-violet-800 leading-relaxed max-w-xs mx-auto">
            {chatMode === "ask" && "Ask mode — Type a question. The AI uses your project context (crystals, artifacts, lore) to answer."}
            {chatMode === "agent" && "Agent mode — The AI can search, create, and modify your project using tools. Risky actions require your approval."}
            {chatMode === "plan" && "Plan mode — The AI will propose a plan of actions for you to review and approve before execution."}
          </div>
        </div>
        ) : null}

        <div className="divide-y divide-violet-800/50">
          {displayPath.map((m, i) => {
            const isUser = m.role === "user";
            const prev = i > 0 ? displayPath[i - 1] : null;
            const isLastModel = showRegenOnLastModel && m.id === lastModelOnPath?.id;

            return (
              <MessageRow
                key={m.id}
                m={m}
                isUser={isUser}
                prev={prev}
                renderForkControls={renderForkControls}
                showRegen={!!isLastModel}
                onRegenerate={handleRegenerate}
                onAppendToDocument={onAppendToDocument}
                isStreaming={isStreaming}
                chatId={chatId}
                onMessagesMutated={handleMessagesMutated}
              />
            );
          })}

          {isStreaming && (streamContent || streamReasoning || streamToolCalls.length > 0 || streamErrors.length > 0 || pendingConfirm || planProposal || streamStatuses.length > 0 || subAgentBlocks.length > 0) ? (
            <div className={messageBody}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                Model {chatMode !== "ask" && <span className="text-violet-800">({chatMode})</span>}
              </div>
              <div className="text-violet-200 [text-shadow:0_0_12px_rgba(167,139,250,0.12)]">
                {streamReasoning ? (
                  <ReasoningBlock
                    text={streamReasoning}
                    autoExpandWhileStreaming
                  />
                ) : null}
                {streamToolCalls.map((tc, i) => (
                  <ToolCallCard key={tc.callId ?? i} tc={tc} />
                ))}
                {subAgentBlocks.map((block, i) => (
                  <SubAgentCard key={`${block.glyphId}-${i}`} block={block} />
                ))}
                {streamStatuses.length > 0 && (
                  <StatusMessage text={streamStatuses[streamStatuses.length - 1]} />
                )}
                {streamErrors.map((e, i) => (
                  <ErrorBanner key={i} error={e} />
                ))}
                {pendingConfirm && (
                  <ConfirmPrompt
                    confirm={pendingConfirm}
                    onRespond={async (loopId, approved) => {
                      setPendingConfirm(null);
                      await fetch("/api/chat/confirm", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ loopId, approved }),
                      });
                    }}
                  />
                )}
                {planProposal && (
                  <PlanChecklist
                    steps={planProposal}
                    isExecuting={isExecutingPlan}
                    onExecute={async (approved) => {
                      setIsExecutingPlan(true);
                      try {
                        const res = await fetch("/api/chat/execute-plan", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            projectId,
                            steps: approved,
                          }),
                        });
                        if (res.ok && res.body) {
                          const reader = res.body.getReader();
                          await consumeCommsSseStream(reader, {
                            onTokenBudget: () => {},
                            onContentDelta: (s) => setStreamContent((c) => c + s),
                            onReasoningDelta: () => {},
                            onToolCall: (tc) => setStreamToolCalls((prev) => [...prev, tc]),
                            onToolResult: (tr) =>
                              setStreamToolCalls((prev) =>
                                prev.map((tc) =>
                                  tc.callId === tr.callId || (tc.name === tr.name && tc.result === undefined)
                                    ? { ...tc, result: tr.result, ok: tr.ok }
                                    : tc
                                )
                              ),
                            onStatus: (s) => setStreamStatuses((prev) => [...prev, s]),
                            onError: (e) => setStreamErrors((prev) => [...prev, e]),
                          });
                        }
                      } catch { /* ignore */ }
                      setIsExecutingPlan(false);
                      setPlanProposal(null);
                      await loadMessages().catch(() => {});
                    }}
                  />
                )}
                {streamContent ? <Markdown content={streamContent} /> : null}
              </div>
            </div>
          ) : null}

          {isStreaming && !streamContent && !streamReasoning && streamToolCalls.length === 0 && streamErrors.length === 0 && !pendingConfirm && !planProposal && streamStatuses.length === 0 && subAgentBlocks.length === 0 && streamRole ? (
            <div className="border-b border-violet-900/50 px-3 py-3 text-xs uppercase tracking-wider text-violet-700">
              Processing…
            </div>
          ) : null}

          {!isStreaming && streamErrors.length > 0 && (
            <div className={messageBody}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-red-500">
                Agent Error
              </div>
              <div>
                {streamErrors.map((e, i) => (
                  <ErrorBanner key={i} error={e} />
                ))}
              </div>
            </div>
          )}
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
            <div className="relative">
              <div className="absolute left-3 top-2.5 text-violet-500 font-bold opacity-80 pointer-events-none">
                &gt;
              </div>
            <textarea
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={2}
              onPaste={onPaste}
              className="min-h-[44px] w-full resize-none border border-violet-700/50 bg-[#020005] py-2 pl-7 pr-3 text-xs font-body leading-relaxed text-violet-100 outline-none caret-violet-500 placeholder:text-violet-900 focus:border-violet-400 focus:shadow-uv-glow"
              placeholder="_"
              disabled={isStreaming || isReadingAttachments}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend().catch(() => {});
                  }
                }}
              />
            </div>

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

                {projectId && (
                  <div className="relative" ref={templateMenuRef}>
                    <button
                      type="button"
                      onClick={() => setShowTemplateMenu((v) => !v)}
                      className="border border-violet-800/70 bg-black px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-400 hover:border-violet-600"
                      title="Prompt templates"
                    >
                      /
                    </button>
                    {showTemplateMenu && (
                      <div className="absolute bottom-full left-0 mb-1 z-50 w-56 max-h-52 overflow-y-auto border border-violet-700/60 bg-black shadow-lg">
                        <div className="border-b border-violet-800/50 px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-violet-600">
                          Prompt Templates
                        </div>
                        {promptTemplates.length === 0 && (
                          <div className="px-2 py-2 text-[10px] text-violet-700">
                            No templates yet.
                          </div>
                        )}
                        {promptTemplates.map((t) => (
                          <div key={t.id} className="group flex items-center justify-between hover:bg-violet-950/50">
                            <button
                              type="button"
                              onClick={() => {
                                setInput(t.template);
                                setShowTemplateMenu(false);
                              }}
                              className="flex-1 truncate px-2 py-1.5 text-left text-[10px] text-violet-300 hover:text-violet-100"
                            >
                              {t.name}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await fetch(`/api/prompts/${t.id}`, { method: "DELETE" });
                                setPromptTemplates((prev) => prev.filter((p) => p.id !== t.id));
                              }}
                              className="shrink-0 px-1.5 py-1 text-[10px] text-violet-800 opacity-0 group-hover:opacity-100 hover:text-red-400"
                              title="Delete template"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <div className="border-t border-violet-800/50">
                          {templateNamePromptOpen ? (
                            <div className="px-1 py-1">
                              <TerminalPrompt
                                label="Template name"
                                onSubmit={async (name) => {
                                  const currentText = input.trim();
                                  if (!currentText) return;
                                  const res = await fetch("/api/prompts", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ projectId, name, template: currentText }),
                                  });
                                  if (res.ok) {
                                    const newTpl = await res.json();
                                    setPromptTemplates((prev) => [...prev, newTpl]);
                                  }
                                  setTemplateNamePromptOpen(false);
                                  setShowTemplateMenu(false);
                                }}
                                onCancel={() => setTemplateNamePromptOpen(false)}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                const currentText = input.trim();
                                if (!currentText) {
                                  alert("Type a prompt in the input field first, then save it as a template.");
                                  return;
                                }
                                setTemplateNamePromptOpen(true);
                              }}
                              className="w-full px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-emerald-500/80 hover:bg-emerald-950/30 hover:text-emerald-400"
                            >
                              [+] Save current as template
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
