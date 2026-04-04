import { listTemplates } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }

  const templates = await listTemplates(projectId);
  return Response.json(
    templates.map((t) => ({
      name: t.name,
      filename: t.filename,
      category: t.frontmatter.category || null,
      tags: t.frontmatter.tags || [],
    }))
  );
}
