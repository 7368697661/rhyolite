import { z } from "zod";
import { readFolders, writeFolders, generateId, type FsFolder } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const FolderCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["document", "wiki"]), // legacy? keeping for compatibility
  projectId: z.string().min(1),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }

  const folders = await readFolders(projectId);
  return Response.json(
    folders.map((f) => ({
      ...f,
      name: f.title,
      type: f.type ?? "document",
    }))
  );
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = FolderCreateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error }, { status: 400 });
  }

  const projectId = parsed.data.projectId;
  const folders = await readFolders(projectId);

  const folder: FsFolder & { type: string } = {
    id: generateId(),
    projectId,
    title: parsed.data.name,
    type: parsed.data.type,
    parentId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  folders.push(folder);
  await writeFolders(projectId, folders);

  return Response.json(
    { ...folder, name: folder.title, type: folder.type },
    { status: 201 }
  );
}
