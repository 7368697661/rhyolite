import { z } from "zod";
import { readFolders, writeFolders } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const FolderUpdateSchema = z.object({
  name: z.string().min(1).optional(),
});

// Helper to find folder since we don't have projectId in URL
import { listProjects } from "@/lib/fs-db";

async function findFolderAndProject(folderId: string) {
  const projects = await listProjects();
  for (const p of projects) {
    const folders = await readFolders(p.id);
    const folder = folders.find((f) => f.id === folderId);
    if (folder) return { project: p, folders, folder };
  }
  return null;
}

export async function GET(req: Request, { params }: any) {
  const { folderId } = await params;
  const match = await findFolderAndProject(folderId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });
  const f = match.folder;
  return Response.json({
    ...f,
    name: f.title,
    type: f.type ?? "document",
  });
}

export async function PUT(req: Request, { params }: any) {
  const { folderId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = FolderUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error },
      { status: 400 }
    );
  }

  const match = await findFolderAndProject(folderId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  if (parsed.data.name !== undefined) match.folder.title = parsed.data.name;
  match.folder.updatedAt = new Date().toISOString();

  await writeFolders(match.project.id, match.folders);

  const f = match.folder;
  return Response.json({
    ...f,
    name: f.title,
    type: f.type ?? "document",
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ folderId: string }> }
) {
  const { folderId } = await params;
  const match = await findFolderAndProject(folderId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  const updatedFolders = match.folders.filter((f) => f.id !== folderId);
  await writeFolders(match.project.id, updatedFolders);

  return Response.json({ ok: true });
}
