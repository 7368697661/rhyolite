import { z } from "zod";
import { readTimeline, writeTimeline, deleteTimeline, listProjects, listTimelines } from "@/lib/fs-db";

export const dynamic = "force-dynamic";

const PutSchema = z.object({
  title: z.string().min(1),
});

async function findTimelineAndProject(timelineId: string) {
  const projects = await listProjects();
  for (const p of projects) {
    const timelines = await listTimelines(p.id);
    const timeline = timelines.find((t) => t.id === timelineId);
    if (timeline) return { project: p, timeline };
  }
  return null;
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ timelineId: string }> }
) {
  const { timelineId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const match = await findTimelineAndProject(timelineId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  match.timeline.title = parsed.data.title;
  match.timeline.updatedAt = new Date().toISOString();

  await writeTimeline(match.timeline);

  return Response.json(match.timeline);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ timelineId: string }> }
) {
  const { timelineId } = await params;
  const match = await findTimelineAndProject(timelineId);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  await deleteTimeline(match.project.id, timelineId);
  return Response.json({ ok: true });
}
