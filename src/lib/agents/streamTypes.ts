/** Unified streaming chunk for multi-provider chat (reasoning vs visible answer). */
export type StreamChannel = "reasoning" | "content";

export type StreamChunk = { channel: StreamChannel; text: string };

// ---------------------------------------------------------------------------
// NDJSON event types for the agent protocol
// ---------------------------------------------------------------------------

export type ChatMode = "ask" | "agent" | "plan" | "research" | "write";

/** Content or reasoning delta (existing) */
export type NdjsonContent = { t: "c"; d: string };
export type NdjsonReasoning = { t: "r"; d: string };

/** Tool call emitted by the model */
export type NdjsonToolCall = {
  t: "tc";
  d: { name: string; args: Record<string, unknown>; callId?: string };
};

/** Tool execution result */
export type NdjsonToolResult = {
  t: "tr";
  d: { name: string; result: unknown; ok: boolean; callId?: string };
};

/** Confirmation request for risky actions (loop paused) */
export type NdjsonConfirm = {
  t: "confirm";
  d: {
    loopId: string;
    name: string;
    args: Record<string, unknown>;
    reason: string;
    callId?: string;
  };
};

/** Plan proposal (plan mode only) */
export type NdjsonPlanProposal = {
  t: "tp";
  d: Array<{
    tool: string;
    args: Record<string, unknown>;
    rationale: string;
  }>;
};

/** Error event (rate limit, auth failure, provider error) */
export type NdjsonError = {
  t: "e";
  d: { code: string; message: string; retryAfter?: number };
};

/** Status message */
export type NdjsonStatus = { t: "s"; d: string };

/** Sub-agent lifecycle event */
export type NdjsonSubAgent = {
  t: "sub";
  d: {
    phase: "start" | "delta" | "end";
    glyphId: string;
    glyphName: string;
    text?: string;
    step?: number;
    totalSteps?: number;
  };
};

/** Context stats emitted after assembleContext runs */
export type NdjsonContextStats = {
  t: "ctx";
  d: {
    wikiChars: number;
    dagChars: number;
    draftChars: number;
    systemChars: number;
    historyChars: number;
    ragChars: number;
  };
};

export type NdjsonEvent =
  | NdjsonContent
  | NdjsonReasoning
  | NdjsonToolCall
  | NdjsonToolResult
  | NdjsonConfirm
  | NdjsonPlanProposal
  | NdjsonError
  | NdjsonStatus
  | NdjsonSubAgent
  | NdjsonContextStats;
