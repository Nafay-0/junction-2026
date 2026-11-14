import { requireUser } from "@/lib/auth/server";
import { capFor, capRefusal } from "@/lib/db/cap";
import { runNow } from "@/lib/jobs/run";

export const dynamic = "force-dynamic";

/**
 * "Run now": run the job once, right away, whatever its schedule says. It answers as soon as the
 * run has started, with the run's id; the run carries on by itself and its result is emailed and
 * kept like any other. It does not count as one of the job's scheduled runs.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const cap = await capFor(user);
  if (cap.reached) return capRefusal();
  const { id } = await params;
  const started = await runNow(user.id, id);
  if (!started.ok) return Response.json({ error: started.problem }, { status: started.status });
  return Response.json({ runId: started.runId });
}
