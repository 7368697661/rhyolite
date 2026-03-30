import { listDocuments, listWikiEntries } from "@/lib/fs-db";
import { extractEntityMentions } from "@/lib/entityExtractor";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  if (!json) return Response.json({ error: "Invalid JSON body" }, { status: 400 });

  const { projectId, content, selfId } = json as {
    projectId?: string;
    content?: string;
    selfId?: string;
  };

  if (!projectId || content === undefined) {
    return Response.json(
      { error: "projectId and content are required" },
      { status: 400 },
    );
  }

  const [docs, wikis] = await Promise.all([
    listDocuments(projectId),
    listWikiEntries(projectId),
  ]);

  const suggestions = extractEntityMentions(
    content,
    docs.map((d) => ({ id: d.id, title: d.title })),
    wikis.map((w) => ({ id: w.id, title: w.title, aliases: w.aliases })),
    selfId,
  );

  return Response.json({ suggestions: suggestions.slice(0, 15) });
}
