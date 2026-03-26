import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ProfileCreateSchema = z.object({
  name: z.string().min(1),
  systemInstruction: z.string().min(1),
});

export async function GET() {
  const profiles = await prisma.profile.findMany({
    orderBy: { createdAt: "desc" },
  });
  return Response.json(profiles);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = ProfileCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid payload", details: parsed.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const profile = await prisma.profile.create({ data: parsed.data });
  return Response.json(profile, { status: 201 });
}

