import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const GlyphUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  systemInstruction: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().min(1).optional(),
});

export async function GET(req: Request, { params }: any) {
  const { glyphId } = await params;
  const glyph = await prisma.glyph.findUnique({
    where: { id: glyphId },
  });
  if (!glyph) return new Response(null, { status: 404 });
  return Response.json(glyph);
}

export async function PUT(req: Request, { params }: any) {
  const { glyphId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = GlyphUpdateSchema.safeParse(json);
  
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updated = await prisma.glyph.update({
    where: { id: glyphId },
    data: parsed.data,
  });

  return Response.json(updated);
}

export async function DELETE(req: Request, { params }: any) {
  const { glyphId } = await params;
  await prisma.glyph.delete({ where: { id: glyphId } });
  return new Response(null, { status: 204 });
}