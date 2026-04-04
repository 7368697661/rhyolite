import { TOOL_MAP, type ToolContext, type ToolResult } from "@/lib/agentTools";
import type { NdjsonEvent } from "@/lib/streamTypes";

export const dynamic = "force-dynamic";

interface PlanStep {
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
}

interface ExecutePlanInput {
  projectId: string;
  timelineId?: string | null;
  documentId?: string | null;
  steps: PlanStep[];
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ExecutePlanInput | null;
  if (!body?.projectId || !Array.isArray(body.steps) || body.steps.length === 0) {
    return Response.json(
      { error: "Missing projectId or steps" },
      { status: 400 }
    );
  }

  const ctx: ToolContext = {
    projectId: body.projectId,
    timelineId: body.timelineId ?? null,
    documentId: body.documentId ?? null,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: NdjsonEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      for (const step of body.steps) {
        const tool = TOOL_MAP.get(step.tool);
        if (!tool) {
          emit({
            t: "tr",
            d: { name: step.tool, result: { error: `Unknown tool: ${step.tool}` }, ok: false },
          });
          continue;
        }

        emit({ t: "s", d: `Executing ${step.tool}: ${step.rationale}` });
        emit({ t: "tc", d: { name: step.tool, args: step.args } });

        let result: ToolResult;
        try {
          result = await tool.execute(step.args, ctx);
        } catch (err: any) {
          result = {
            ok: false,
            error: (err?.message ?? String(err)).slice(0, 500),
          };
        }

        emit({
          t: "tr",
          d: {
            name: step.tool,
            result: result.data ?? result.error,
            ok: result.ok,
          },
        });
      }

      emit({ t: "s", d: "Plan execution complete." });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
