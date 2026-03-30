import { z } from "zod";
import { listProjects, writeProject, generateId, listDocuments, listWikiEntries } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const ProjectCreateSchema = z.object({
  name: z.string().min(1),
  storyOutline: z.string().optional(),
  loreBible: z.string().optional(),
});

export async function GET() {
  const projects = await listProjects();
  // We need to add `_count` so the UI doesn't break
  const enriched = await Promise.all(
    projects.map(async (p) => {
      const docs = await listDocuments(p.id);
      const wikis = await listWikiEntries(p.id);
      return {
        ...p,
        name: p.title,
        _count: {
          documents: docs.length,
          wikiEntries: wikis.length,
        },
      };
    })
  );
  enriched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return Response.json(enriched);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = ProjectCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const project = {
    id: generateId(),
    title: parsed.data.name,
    loreBible: parsed.data.loreBible || "",
    storyOutline: parsed.data.storyOutline || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeProject(project);
  return Response.json({ ...project, name: project.title }, { status: 201 });
}