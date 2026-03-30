import { z } from "zod";
import { listWikiEntries, writeWikiEntry, generateId, type FsWikiEntry } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const WikiEntryCreateSchema = z.object({
  title: z.string().min(1),
  projectId: z.string().min(1),
  content: z.string().optional(),
  aliases: z.string().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  
  if (!projectId) {
    return new Response(JSON.stringify({ error: "projectId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const entries = await listWikiEntries(projectId);
  entries.sort((a, b) => a.title.localeCompare(b.title));
  return Response.json(entries);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = WikiEntryCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const projectId = parsed.data.projectId;
  const entry: FsWikiEntry = {
    id: generateId(),
    projectId,
    title: parsed.data.title,
    content: parsed.data.content || "",
    aliases: parsed.data.aliases || "",
    folderId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeWikiEntry(entry);
  return Response.json(entry, { status: 201 });
}