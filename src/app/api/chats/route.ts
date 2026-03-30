import { z } from "zod";
import { listChats, writeChat, generateId, getGlyph, listProjects, type FsChat, listDocuments, listTimelines } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const ChatCreateSchema = z
  .object({
    title: z.string().min(1),
    glyphId: z.string().min(1),
    documentId: z.string().optional().nullable(),
    timelineId: z.string().optional().nullable(),
  })
  .refine(
    (d) => !(d.documentId && d.timelineId),
    "Cannot attach chat to both a document and a timeline"
  );

async function findProjectForScope(documentId?: string | null, timelineId?: string | null) {
  const projects = await listProjects();
  for (const p of projects) {
    if (documentId) {
      const docs = await listDocuments(p.id);
      if (docs.some(d => d.id === documentId)) return p.id;
    } else if (timelineId) {
      const timelines = await listTimelines(p.id);
      if (timelines.some(t => t.id === timelineId)) return p.id;
    }
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const documentId = url.searchParams.get("documentId") ?? undefined;
  const timelineId = url.searchParams.get("timelineId") ?? undefined;

  const projectId = await findProjectForScope(documentId, timelineId);
  if (!projectId) {
    return Response.json([]);
  }

  const allChats = await listChats(projectId);
  const filtered = allChats.filter(c => {
    if (documentId && c.documentId !== documentId) return false;
    if (timelineId && c.timelineId !== timelineId) return false;
    return true;
  });

  filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const enriched = await Promise.all(
    filtered.map(async (c) => {
      const g = await getGlyph(c.glyphId);
      return {
        ...c,
        glyph: g ? { id: g.id, name: g.name, model: g.model } : null,
        _count: { messages: c.messages.length },
      };
    })
  );

  return Response.json(enriched);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = ChatCreateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error }, { status: 400 });
  }

  const projectId = await findProjectForScope(parsed.data.documentId, parsed.data.timelineId);
  if (!projectId) {
    return Response.json({ error: "Could not resolve project for chat" }, { status: 400 });
  }

  const chat: FsChat = {
    id: generateId(),
    title: parsed.data.title,
    glyphId: parsed.data.glyphId,
    documentId: parsed.data.documentId ?? null,
    timelineId: parsed.data.timelineId ?? null,
    activeTipMessageId: null,
    branchChoicesJson: "{}",
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeChat(projectId, chat);

  return Response.json(chat, { status: 201 });
}

