import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const GlyphCreateSchema = z.object({
  name: z.string().min(1),
  systemInstruction: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().min(1).optional(),
});

export async function GET() {
  const glyphs = await prisma.glyph.findMany({
    orderBy: { createdAt: "desc" },
  });
  return Response.json(glyphs);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = GlyphCreateSchema.safeParse(json);
  
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const glyph = await prisma.glyph.create({
    data: parsed.data,
  });

  return Response.json(glyph, { status: 201 });
}