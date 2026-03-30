import { listDocuments, listWikiEntries } from "@/lib/fs-db";
import { extractEntityMentions } from "@/lib/entityExtractor";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const content = url.searchParams.get("content");
  const selfId = url.searchParams.get("selfId") ?? undefined;

  if (!projectId || content === null) {
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
