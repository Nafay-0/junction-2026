import { databaseReady } from "@/lib/db/start";
import { exaRequestsSent } from "@/lib/exa/client";

export const dynamic = "force-dynamic";

const started = Date.now();

/**
 * Is the server up and can it do its job? Open to anyone, so it says only yes or no to each
 * thing: no addresses, no names, no error text. 200 when the database is ready, 503 when not.
 *
 * It is for a person or a deploy script to look at. The host is deliberately not told to restart
 * the server when this fails: a restart loses the tasks that are running, and a database that
 * is briefly away comes back on its own.
 */
export async function GET() {
  const problem = await databaseReady();
  const has = (name: string) => Boolean(process.env[name]?.trim());
  const body = {
    ok: problem === null,
    database: problem === null,
    search: has("EXA_API_KEY"),
    // The modes run on two providers and voice on one of them: each is either set up or not.
    models: has("ANTHROPIC_AWS_API_KEY") && has("ANTHROPIC_AWS_WORKSPACE_ID") && has("AWS_REGION") && has("GOOGLE_API_KEY"),
    voice: has("GOOGLE_API_KEY"),
    admin: has("ADMIN_EMAIL") && has("ADMIN_PASSWORD"),
    // Whether the server can send email (notifications, job results).
    email: has("RESEND_API_KEY"),
    upSeconds: Math.round((Date.now() - started) / 1000),
    // How many searches and page reads the server has sent since it started: a number that stops
    // moving when nothing is working, which is how a stopped task is seen to have stopped.
    searchesSent: exaRequestsSent(),
  };
  return Response.json(body, { status: body.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
