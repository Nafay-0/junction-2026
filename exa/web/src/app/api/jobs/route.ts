import { requireUser } from "@/lib/auth/server";
import { listJobs } from "@/lib/db/jobs";
import type { JobList } from "@/lib/jobs/types";

export const dynamic = "force-dynamic";

/** The signed-in account's jobs, newest first. Jobs are made in a chat, so there is no POST here. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body: JobList = { jobs: await listJobs(user.id) };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
