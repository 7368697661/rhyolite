import { z } from "zod";
import { readFolders, createFsFolder } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const FolderCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["document", "wiki"]),
  projectId: z.string().min(1),
  parentId: z.string().nullable().optional(),
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

  const folder = await createFsFolder(
    parsed.data.projectId,
    parsed.data.name,
    parsed.data.type,
    parsed.data.parentId,
  );

  return Response.json(
    { ...folder, name: folder.title, type: folder.type },
    { status: 201 }
  );
}
