import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { getProjectDir } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename: rawFilename } = await params;
  const filename = path.basename(rawFilename);
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");
  const projectId = url.searchParams.get("projectId");

  if (!type || !id || !projectId) {
    return Response.json(
      { error: "type, id, and projectId are required" },
      { status: 400 },
    );
  }

  const subdir = type === "wiki" ? "artifacts" : "crystals";
  const pDir = await getProjectDir(projectId);
  const filePath = path.join(pDir, subdir, ".history", id, filename);

  try {
    const text = await fs.readFile(filePath, "utf8");
    const { data, content } = matter(text);
    return Response.json({ content, frontmatter: data });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return Response.json({ error: "Snapshot not found" }, { status: 404 });
    }
    throw err;
  }
}
