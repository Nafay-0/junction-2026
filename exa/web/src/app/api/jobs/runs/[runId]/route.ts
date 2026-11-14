import { requireUser } from "@/lib/auth/server";
import { getRun } from "@/lib/db/jobs";

export const dynamic = "force-dynamic";

/** One run in full: what the agent wrote, and the run as a chat would show it. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { runId } = await params;
  const run = await getRun(user.id, runId, user.showUsage);
  if (!run) return Response.json({ error: "That run does not exist." }, { status: 404 });
  return Response.json(run, { headers: { "cache-control": "no-store" } });
}
