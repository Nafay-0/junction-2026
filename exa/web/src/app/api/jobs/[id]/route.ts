import { requireUser } from "@/lib/auth/server";
import { deleteJob, getJob, listRuns, updateJob, type JobChange } from "@/lib/db/jobs";
import { stopJobRun } from "@/lib/jobs/run";
import type { JobDetail } from "@/lib/jobs/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** One job and its runs, newest first. */
export async function GET(_req: Request, { params }: Params) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const job = await getJob(user.id, id);
  if (!job) return Response.json({ error: "That job does not exist." }, { status: 404 });
  const body: JobDetail = { job, runs: await listRuns(user.id, id, user.showUsage) };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

/**
 * Change what a job is called, what it is for and what it is told to do, or pause and resume it.
 * Its schedule is not changed here: that is asked for in a chat, where the agent works out the
 * times and says what they mean.
 */
export async function PATCH(req: Request, { params }: Params) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Nothing to change." }, { status: 400 });
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const change: JobChange = {
    title: text(body.title),
    description: text(body.description),
    prompt: text(body.prompt),
    status: body.status === "active" || body.status === "paused" ? body.status : undefined,
  };
  if (change.title !== undefined && !change.title.trim()) return Response.json({ error: "A job needs a name." }, { status: 400 });
  if (change.prompt !== undefined && !change.prompt.trim()) return Response.json({ error: "A job needs instructions." }, { status: 400 });
  const result = await updateJob(user.id, id, change);
  if (!result) return Response.json({ error: "That job does not exist." }, { status: 404 });
  if (!result.ok) return Response.json({ error: result.problem }, { status: 409 });
  // Pausing also stops a run that is going.
  if (change.status === "paused") stopJobRun(id);
  return Response.json({ job: result.job });
}

/** Delete a job and its runs. */
export async function DELETE(_req: Request, { params }: Params) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  // Only the account's own job: the delete below is asked by account, and so is this.
  if (await getJob(user.id, id)) stopJobRun(id);
  const gone = await deleteJob(user.id, id);
  return gone ? Response.json({ deleted: true }) : Response.json({ error: "That job does not exist." }, { status: 404 });
}
