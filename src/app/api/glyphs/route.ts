import { z } from "zod";
import { readGlyphs, writeGlyphs, generateId, type FsGlyph } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const GlyphCreateSchema = z.object({
  name: z.string().min(1),
  systemInstruction: z.string().optional(),
  provider: z.enum(["gemini", "openai", "anthropic"]).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().min(1).optional(),
  isSculpter: z.boolean().optional(),
  specialistRole: z.string().optional(),
});

export async function GET() {
  const glyphs = await readGlyphs();
  return Response.json(glyphs);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = GlyphCreateSchema.safeParse(json);
  
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error }, { status: 400 });
  }

  const glyphs = await readGlyphs();
  const glyph: FsGlyph = {
    id: generateId(),
    name: parsed.data.name,
    systemInstruction: parsed.data.systemInstruction || "",
    provider: parsed.data.provider || "gemini",
    model: parsed.data.model || "gemini-2.5-flash",
    temperature: parsed.data.temperature || 0.7,
    maxOutputTokens: parsed.data.maxOutputTokens || 2048,
    isSculpter: parsed.data.isSculpter ?? true,
    specialistRole: parsed.data.specialistRole,
  };
  glyphs.push(glyph);
  await writeGlyphs(glyphs);

  return Response.json(glyph, { status: 201 });
}