import { z } from "zod";
import { TOOL_MAP } from "@/lib/agentTools";

export const dynamic = "force-dynamic";

const ResolveSchema = z.object({
  document_id: z.string().min(1),
  project_id: z.string().min(1),
  dry_run: z.boolean().optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = ResolveSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error }, { status: 400 });
  }

  const tool = TOOL_MAP.get("resolve_dead_links");
  if (!tool) {
    return Response.json({ error: "resolve_dead_links tool not found" }, { status: 500 });
  }

  // Fast path for dry run (returns standard JSON)
  if (parsed.data.dry_run) {
    const result = await tool.execute(
      { document_id: parsed.data.document_id, dry_run: "true" },
      { projectId: parsed.data.project_id }
    );
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      try {
        const result = await tool.execute(
          { document_id: parsed.data.document_id, dry_run: parsed.data.dry_run ? "true" : "false" },
          {
            projectId: parsed.data.project_id,
            onProgress: (p) => send({ type: "progress", data: p }),
          }
        );
        send({ type: "result", data: result });
      } catch (err: any) {
        send({ type: "error", error: err.message || String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
