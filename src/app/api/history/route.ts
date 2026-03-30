import fs from "fs/promises";
import path from "path";
import { getProjectDir } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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
  const historyDir = path.join(pDir, subdir, ".history", id);

  let files: string[];
  try {
    files = await fs.readdir(historyDir);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return Response.json({ snapshots: [] });
    }
    throw err;
  }

  const snapshots = await Promise.all(
    files
      .filter((f) => f.endsWith(".md"))
      .map(async (filename) => {
        const stat = await fs.stat(path.join(historyDir, filename));
        return {
          filename,
          timestamp: filename.replace(".md", ""),
          sizeBytes: stat.size,
        };
      }),
  );

  snapshots.sort((a, b) => b.filename.localeCompare(a.filename));

  return Response.json({ snapshots });
}
