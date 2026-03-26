import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AgentCreateSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  profileId: z.string().min(1),
  temperature: z.coerce.number().optional(),
  maxOutputTokens: z.coerce.number().int().optional(),
  trainingContext: z.string().optional(),
});

export async function GET() {
  const agents = await prisma.agent.findMany({
    orderBy: { createdAt: "desc" },
    include: { profile: { select: { id: true, name: true } } },
  });
  return Response.json(agents);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = AgentCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid payload", details: parsed.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const agent = await prisma.agent.create({
    data: parsed.data,
  });
  return Response.json(agent, { status: 201 });
}

