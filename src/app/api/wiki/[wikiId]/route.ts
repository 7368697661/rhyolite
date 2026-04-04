import { z } from "zod";
import { readWikiEntry, writeWikiEntry, deleteWikiEntry, listProjects, listWikiEntries, moveFileToFolder } from "@/lib/fs-db";
import { embedSingleEntry } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

const WikiEntryUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  aliases: z.string().optional(),
  folderId: z.string().nullable().optional(),
});

async function findWikiAndProject(wikiId: string) {
  const projects = await listProjects();
  for (const p of projects) {
    const wikis = await listWikiEntries(p.id);
    const wiki = wikis.find((w) => w.id === wikiId);
    if (wiki) return { project: p, wiki };
  }
  return null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ wikiId: string }> }
) {
  const { wikiId } = await params;
  const match = await findWikiAndProject(wikiId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(match.wiki);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ wikiId: string }> }
) {
  const { wikiId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = WikiEntryUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error },
      { status: 400 }
    );
  }

  const match = await findWikiAndProject(wikiId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  const { wiki } = match;
  if (parsed.data.title !== undefined) wiki.title = parsed.data.title;
  if (parsed.data.content !== undefined) wiki.content = parsed.data.content;
  if (parsed.data.aliases !== undefined) wiki.aliases = parsed.data.aliases;
  if (parsed.data.folderId !== undefined && parsed.data.folderId !== wiki.folderId) {
    await moveFileToFolder(match.project.id, "wiki", wiki.id, parsed.data.folderId);
    wiki.folderId = parsed.data.folderId;
  }
  wiki.updatedAt = new Date().toISOString();

  await writeWikiEntry(wiki);
  embedSingleEntry(match.project.id, wiki.id, "wiki", wiki.title, wiki.content).catch(() => {});

  return Response.json(wiki);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ wikiId: string }> }
) {
  const { wikiId } = await params;
  const match = await findWikiAndProject(wikiId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  await deleteWikiEntry(match.project.id, wikiId);
  return Response.json({ ok: true });
}
