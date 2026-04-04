import { z } from "zod";
import { readDocument, writeDocument, deleteDocument, listProjects, listDocuments, moveFileToFolder } from "@/lib/fs-db";
import { embedSingleEntry } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

const DocumentUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  orderIndex: z.number().optional(),
  folderId: z.string().nullable().optional(),
});

async function findDocumentAndProject(docId: string) {
  const projects = await listProjects();
  for (const p of projects) {
    const docs = await listDocuments(p.id);
    const doc = docs.find((d) => d.id === docId);
    if (doc) return { project: p, doc };
  }
  return null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  const match = await findDocumentAndProject(documentId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(match.doc);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = DocumentUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error },
      { status: 400 }
    );
  }

  const match = await findDocumentAndProject(documentId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  const { doc } = match;
  if (parsed.data.title !== undefined) doc.title = parsed.data.title;
  if (parsed.data.content !== undefined) doc.content = parsed.data.content;
  if (parsed.data.orderIndex !== undefined) doc.orderIndex = parsed.data.orderIndex;
  if (parsed.data.folderId !== undefined && parsed.data.folderId !== doc.folderId) {
    await moveFileToFolder(match.project.id, "document", doc.id, parsed.data.folderId);
    doc.folderId = parsed.data.folderId;
  }
  doc.updatedAt = new Date().toISOString();

  await writeDocument(doc);
  embedSingleEntry(match.project.id, doc.id, "document", doc.title, doc.content).catch(() => {});

  return Response.json(doc);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  const match = await findDocumentAndProject(documentId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  await deleteDocument(match.project.id, documentId);
  return Response.json({ ok: true });
}
