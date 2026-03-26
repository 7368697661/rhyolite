import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ProfileUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  systemInstruction: z.string().min(1).optional(),
});

export async function PUT(
  req: Request,
  { params }: any
) {
  const json = await req.json().catch(() => null);
  const parsed = ProfileUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid payload", details: parsed.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const updated = await prisma.profile.update({
    where: { id: params.profileId },
    data: parsed.data,
  });
  return Response.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: any
) {
  await prisma.profile.delete({ where: { id: params.profileId } });
  return new Response(null, { status: 204 });
}

