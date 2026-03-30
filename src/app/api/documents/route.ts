import { z } from "zod";
import { listDocuments, writeDocument, generateId, type FsDocument } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const DocumentCreateSchema = z.object({
  title: z.string().min(1),
  projectId: z.string().min(1),
  content: z.string().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  
  if (!projectId) {
    return new Response(JSON.stringify({ error: "projectId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const documents = await listDocuments(projectId);
  documents.sort((a, b) => a.orderIndex - b.orderIndex);
  return Response.json(documents);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = DocumentCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const projectId = parsed.data.projectId;
  const docs = await listDocuments(projectId);
  const lastDoc = docs.sort((a, b) => b.orderIndex - a.orderIndex)[0];
  const orderIndex = lastDoc ? lastDoc.orderIndex + 1 : 0;

  const doc: FsDocument = {
    id: generateId(),
    projectId,
    title: parsed.data.title,
    content: parsed.data.content || "",
    folderId: null,
    orderIndex,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeDocument(doc);
  return Response.json(doc, { status: 201 });
}