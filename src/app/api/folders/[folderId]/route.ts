import { z } from "zod";
import { readFolders, renameFsFolder, deleteFsFolder, listProjects } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const FolderUpdateSchema = z.object({
  name: z.string().min(1).optional(),
});

async function findFolderAndProject(folderId: string) {
  const projects = await listProjects();
  for (const p of projects) {
    const folders = await readFolders(p.id);
    const folder = folders.find((f) => f.id === folderId);
    if (folder) return { project: p, folder };
  }
  return null;
}

export async function GET(req: Request, { params }: any) {
  const { folderId } = await params;
  const match = await findFolderAndProject(decodeURIComponent(folderId));
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
  const decodedId = decodeURIComponent(folderId);
  const json = await req.json().catch(() => null);
  const parsed = FolderUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error },
      { status: 400 }
    );
  }

  const match = await findFolderAndProject(decodedId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  if (parsed.data.name) {
    const renamed = await renameFsFolder(match.project.id, decodedId, parsed.data.name);
    if (!renamed) return Response.json({ error: "Failed to rename" }, { status: 500 });
    return Response.json({
      ...renamed,
      name: renamed.title,
      type: renamed.type ?? "document",
    });
  }

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
  const decodedId = decodeURIComponent(folderId);
  const match = await findFolderAndProject(decodedId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  const ok = await deleteFsFolder(match.project.id, decodedId);
  if (!ok) return Response.json({ error: "Failed to delete folder" }, { status: 500 });

  return Response.json({ ok: true });
}
