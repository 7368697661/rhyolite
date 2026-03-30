import { z } from "zod";
import { listTimelines, writeTimeline, generateId, type FsTimeline } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  title: z.string().min(1),
  projectId: z.string().min(1),
});

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }
  const timelines = await listTimelines(projectId);
  timelines.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return Response.json(timelines);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const timeline: FsTimeline = {
    id: generateId(),
    projectId: parsed.data.projectId,
    title: parsed.data.title,
    events: [],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeTimeline(timeline);

  return Response.json(timeline, { status: 201 });
}
