import { z } from "zod";
import { readGlyphs, writeGlyphs } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const GlyphUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  systemInstruction: z.string().optional(),
  provider: z.enum(["gemini", "openai", "anthropic"]).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().min(1).optional(),
  isSculpter: z.boolean().optional(),
  specialistRole: z.string().optional(),
});

export async function GET(req: Request, { params }: any) {
  const { glyphId } = await params;
  const glyphs = await readGlyphs();
  const glyph = glyphs.find((g) => g.id === glyphId);
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

  const glyphs = await readGlyphs();
  const glyph = glyphs.find((g) => g.id === glyphId);
  if (!glyph) return new Response(null, { status: 404 });

  if (parsed.data.name !== undefined) glyph.name = parsed.data.name;
  if (parsed.data.systemInstruction !== undefined) glyph.systemInstruction = parsed.data.systemInstruction;
  if (parsed.data.provider !== undefined) glyph.provider = parsed.data.provider;
  if (parsed.data.model !== undefined) glyph.model = parsed.data.model;
  if (parsed.data.temperature !== undefined) glyph.temperature = parsed.data.temperature;
  if (parsed.data.maxOutputTokens !== undefined) glyph.maxOutputTokens = parsed.data.maxOutputTokens;
  if (parsed.data.isSculpter !== undefined) glyph.isSculpter = parsed.data.isSculpter;
  if (parsed.data.specialistRole !== undefined) glyph.specialistRole = parsed.data.specialistRole;

  await writeGlyphs(glyphs);
  return Response.json(glyph);
}

export async function DELETE(req: Request, { params }: any) {
  const { glyphId } = await params;
  const glyphs = await readGlyphs();
  const updated = glyphs.filter((g) => g.id !== glyphId);
  await writeGlyphs(updated);
  return new Response(null, { status: 204 });
}