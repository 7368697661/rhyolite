import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AgentUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  profileId: z.string().min(1).optional(),
  temperature: z.coerce.number().optional(),
  maxOutputTokens: z.coerce.number().int().optional(),
  trainingContext: z.string().optional(),
});

export async function PUT(
  req: Request,
  { params }: any
) {
  const json = await req.json().catch(() => null);
  const parsed = AgentUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid payload", details: parsed.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const updated = await prisma.agent.update({
    where: { id: params.agentId },
    data: parsed.data,
  });
  return Response.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: any
) {
  await prisma.agent.delete({ where: { id: params.agentId } });
  return new Response(null, { status: 204 });
}

