export type BranchMessage = {
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
  errors?: Array<{ code: string; message: string; detail?: string }>;
  createdAt: string | Date;
  parentMessageId: string | null;
};

export function messagesById(messages: BranchMessage[]) {
  return new Map(messages.map((m) => [m.id, m]));
}

export function childrenByParent(messages: BranchMessage[]) {
  const map = new Map<string | null, BranchMessage[]>();
  for (const m of messages) {
    const p = m.parentMessageId;
    if (!map.has(p)) map.set(p, []);
    map.get(p)!.push(m);
  }
  for (const arr of map.values()) {
    arr.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }
  return map;
}

/** Walk parent pointers from tip to root, then reverse to chronological order. */
export function chainFromTip(
  tipId: string,
  byId: Map<string, BranchMessage>
): BranchMessage[] {
  const out: BranchMessage[] = [];
  let cur: string | null = tipId;
  while (cur) {
    const m = byId.get(cur);
    if (!m) break;
    out.push(m);
    cur = m.parentMessageId;
  }
  return out.reverse();
}

/**
 * From a model message, walk down using branch choices (latest model if unset)
 * until there is no user continuation.
 */
export function extendTipFromModel(
  modelId: string,
  children: Map<string | null, BranchMessage[]>,
  branchChoices: Record<string, string>
): string {
  let tip = modelId;
  while (true) {
    const kids = children.get(tip) ?? [];
    const users = kids.filter((k) => k.role === "user");
    if (users.length === 0) return tip;
    const u = users[users.length - 1];
    tip = u.id;
    const models = (children.get(tip) ?? []).filter((k) => k.role === "model");
    if (models.length === 0) return tip;
    const chosenId = branchChoices[tip];
    const chosen = chosenId
      ? models.find((m) => m.id === chosenId)
      : undefined;
    const pick =
      chosen ??
      models.reduce((a, b) =>
        new Date(a.createdAt) > new Date(b.createdAt) ? a : b
      );
    tip = pick.id;
  }
}

export function siblingModelsForUser(
  userId: string,
  children: Map<string | null, BranchMessage[]>
) {
  return (children.get(userId) ?? []).filter((m) => m.role === "model");
}

export function parseBranchChoices(json: string): Record<string, string> {
  try {
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== "object") return {};
    return v as Record<string, string>;
  } catch {
    return {};
  }
}

export function serializeBranchChoices(v: Record<string, string>) {
  return JSON.stringify(v);
}
