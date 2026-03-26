import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const FolderCreateSchema = z.object({
  name: z.string().min(1),
});

export async function GET() {
  const folders = await prisma.chatFolder.findMany({
    orderBy: { createdAt: "desc" },
  });
  return Response.json(folders);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = FolderCreateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid payload", details: parsed.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const folder = await prisma.chatFolder.create({ data: parsed.data });
  return Response.json(folder, { status: 201 });
}

