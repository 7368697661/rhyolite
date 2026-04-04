import { resolveConfirmation } from "@/lib/agentLoop";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as {
    loopId?: string;
    approved?: boolean;
  } | null;

  if (!body?.loopId || typeof body.approved !== "boolean") {
    return Response.json(
      { error: "Missing loopId or approved field" },
      { status: 400 }
    );
  }

  const found = resolveConfirmation(body.loopId, body.approved);
  if (!found) {
    return Response.json(
      { error: "No pending confirmation with that loopId" },
      { status: 404 }
    );
  }

  return Response.json({ ok: true, approved: body.approved });
}
