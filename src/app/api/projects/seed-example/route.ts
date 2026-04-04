import { createExampleProject } from "@/lib/exampleProjectSeed";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const projectId = await createExampleProject();
    return Response.json({ ok: true, projectId }, { status: 201 });
  } catch (err: any) {
    return Response.json(
      { error: err?.message ?? "Failed to create example project" },
      { status: 500 }
    );
  }
}
