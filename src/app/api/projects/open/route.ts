import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { ensureDir, generateId, registerExternalProject, type FsProject } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const OpenFolderSchema = z.object({
  path: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = OpenFolderSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const folderPath = path.resolve(parsed.data.path);

  // Validate the path exists and is a directory
  try {
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) {
      return Response.json({ error: "Path is not a directory" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Path does not exist" }, { status: 400 });
  }

  // Create Rhyolite subdirectories if missing
  await ensureDir(path.join(folderPath, "crystals"));
  await ensureDir(path.join(folderPath, "artifacts"));
  await ensureDir(path.join(folderPath, "timelines"));
  await ensureDir(path.join(folderPath, "chats"));
  const rhyoliteDir = path.join(folderPath, ".rhyolite");
  await ensureDir(rhyoliteDir);

  // Create .rhyolite/project.json if it doesn't exist
  const projectJsonPath = path.join(rhyoliteDir, "project.json");
  let project: FsProject;
  try {
    const text = await fs.readFile(projectJsonPath, "utf8");
    project = JSON.parse(text) as FsProject;
  } catch {
    const folderName = path.basename(folderPath);
    project = {
      id: generateId(),
      title: folderName,
      loreBible: "",
      storyOutline: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(projectJsonPath, JSON.stringify(project, null, 2));
  }

  // Register in known-projects.json so getProjectDir/listProjects can find it
  await registerExternalProject(project.id, folderPath);

  return Response.json({ ...project, name: project.title }, { status: 201 });
}
