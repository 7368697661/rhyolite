import { listDocuments } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const url = new URL(req.url);
  const includeToc = url.searchParams.get("toc") !== "false";
  const folderId = url.searchParams.get("folderId");

  let docs = await listDocuments(projectId);
  if (folderId) {
    docs = docs.filter((d) => d.folderId === folderId);
  }
  docs.sort((a, b) => a.orderIndex - b.orderIndex);

  if (docs.length === 0) {
    return new Response("# (empty manuscript)\n\nNo documents found.", {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": 'attachment; filename="manuscript.md"',
      },
    });
  }

  const parts: string[] = [];

  if (includeToc) {
    parts.push("# Table of Contents\n");
    docs.forEach((doc, i) => {
      parts.push(`${i + 1}. ${doc.title}`);
    });
    parts.push("\n---\n");
  }

  docs.forEach((doc, i) => {
    parts.push(`# ${doc.title}\n\n${doc.content}`);
    if (i < docs.length - 1) {
      parts.push("\n---\n");
    }
  });

  const manuscript = parts.join("\n");

  return new Response(manuscript, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="manuscript.md"',
    },
  });
}
