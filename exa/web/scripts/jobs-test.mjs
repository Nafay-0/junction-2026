// End-to-end test of scheduled jobs, against the running server. Run: pnpm test:jobs [port]
//
// With real questions and a throwaway account, it checks that:
// - asked in a chat for something on a schedule, the agent makes a job with the right times;
// - "Run now" runs it: the result is kept as text and as an answer a chat can show, it is emailed,
//   it shows as a notice in the app, and its cost goes on the account's usage record as a job;
// - the Jobs page's own edits work (rename, pause) and cannot change the schedule;
// - the agent can change the schedule and the end, resume, and delete, on the user's word;
// - a job set for a minute from now runs by itself and is then finished;
// - at the usage limit, Run now is refused and a job whose time comes is skipped, with a notice.
//
// The account is made straight in the database (an ordinary account, never an admin) with an
// address at Resend's test inbox, which reaches no one, and is deleted at the end along with
// everything it made. It needs DATABASE_URL from exa/.env.local, and RESEND_API_KEY on the
// server for the email checks (without it they are skipped and said so).
// It takes about eight minutes and costs around ten cents in model and Exa calls.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const port = process.argv.slice(2).find((a) => /^\d{2,5}$/.test(a)) ?? "3000";
const base = `http://localhost:${port}`;
const EMAIL = "delivered+beryl-jobs-test@resend.dev";
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

let failures = 0;
const ok = (label, pass, note = "") => {
  if (!pass) failures += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${label}${note !== "" ? `  (${String(note).slice(0, 240)})` : ""}`);
};
const skip = (label, why) => console.log(`skip ${label}  (${why})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The app's own password format (src/lib/auth/password.ts). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password.normalize("NFKC"), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return ["scrypt", 32768, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}

const password = crypto.randomBytes(18).toString("base64url");
await sql`delete from users where email = ${EMAIL} and role = 'user'`;
const [{ id: userId }] = await sql`
  insert into users (email, name, password_hash, role, status, modes, show_usage)
  values (${EMAIL}, 'Jobs Test', ${hashPassword(password)}, 'user', 'active', ${["ultrafast", "fast"]}, true) returning id`;
const cleanUp = async () => {
  await sql`delete from users where id = ${userId}`;
  await sql.end({ timeout: 5 });
};

const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password }) });
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
ok("a throwaway account signs in", login.ok && Boolean(cookie), login.status);
if (!login.ok) {
  await cleanUp();
  process.exit(1);
}
const user = (p, init = {}) => fetch(`${base}${p}`, { ...init, headers: { "content-type": "application/json", cookie, "x-beryl-client": "web", ...(init.headers ?? {}) } });
const say = async (id, messages) => {
  const res = await user("/api/chat", { method: "POST", body: JSON.stringify({ id, mode: "fast", effort: 1, timeZone: "Europe/Helsinki", place: "Helsinki, Finland", messages }) });
  return res.ok ? await res.text() : `HTTP ${res.status} ${await res.text()}`;
};
const text = (id, role, words) => ({ id, role, parts: [{ type: "text", text: words }] });
const jobsNow = async () => (await (await user("/api/jobs")).json()).jobs ?? [];
const hhmm = (date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Helsinki" });
const emailOn = (await sql`select 1`).length > 0 && (await (await fetch(`${base}/api/health`)).json()).email !== false;

try {
  /* ───────── Made in a chat, run now ───────── */
  const chatId = `jobs-test-${Date.now().toString(36)}`;
  const first = text("u1", "user", "Every weekday at 8:00, email me the three most important AI news stories of the last day, one line each with the source.");
  const stream1 = await say(chatId, [first]);
  ok("asked in a chat, the agent makes a job", stream1.includes('"toolName":"createJob"'), stream1.includes("createJob") ? "" : stream1.slice(0, 200));
  let jobs = await jobsNow();
  const job = jobs[0];
  ok("the job is on the account", jobs.length === 1 && Boolean(job));
  if (!job) throw new Error("no job was made");
  ok("it runs on weekdays at 08:00, Helsinki time", job.schedule.kind === "cron" && job.schedule.cron === "0 8 * * 1-5" && job.timeZone === "Europe/Helsinki", JSON.stringify(job.schedule));
  const next = new Date(job.nextRunAt);
  ok("its next run is a weekday at 08:00 there", hhmm(next) === "08:00" && ![0, 6].includes(new Date(next.toLocaleString("en-US", { timeZone: "Europe/Helsinki" })).getDay()), next.toISOString());
  ok("the agent wrote instructions for the runs", job.prompt.length > 80, job.prompt.replace(/\s+/g, " ").slice(0, 160));

  const started = await user(`/api/jobs/${job.id}/run`, { method: "POST" });
  const { runId } = await started.json();
  ok("Run now starts a run", started.ok && Boolean(runId), started.status);
  ok("a second Run now is refused while it is going", (await user(`/api/jobs/${job.id}/run`, { method: "POST" })).status === 409);
  let run;
  for (let i = 0; i < 150; i++) {
    await wait(2000);
    run = await (await user(`/api/jobs/runs/${runId}`)).json();
    if (run.status !== "running") break;
  }
  ok("the run finishes", run.status === "done", `${run.status} ${run.error ?? ""}`);
  ok("it wrote a result", (run.output ?? "").length > 80, (run.output ?? "").replace(/\s+/g, " ").slice(0, 200));
  ok("the run is kept as an answer a chat can show", Array.isArray(run.messages) && run.messages.length === 1 && run.messages[0].role === "assistant" && run.messages[0].parts.some((p) => p.type.startsWith("tool-")));
  ok("it has a cost", typeof run.costUsd === "number" && run.costUsd > 0, run.costUsd);
  await wait(5000); // the email goes out a moment after the run is marked done
  run = await (await user(`/api/jobs/runs/${runId}`)).json();
  if (emailOn) ok("the result was emailed", run.emailed === true);
  else skip("the result was emailed", "the server has no RESEND_API_KEY");
  const detail = await (await user(`/api/jobs/${job.id}`)).json();
  ok("the job lists the run, and Run now did not count as a scheduled run", detail.runs?.length === 1 && detail.runs[0].trigger === "manual" && detail.job.runCount === 0);
  const notices = await (await user("/api/notifications")).json().catch(() => ({}));
  ok("a notice about the result is in the app", (notices.items ?? []).some((n) => n.kind === "job_done" && n.runId === runId));
  const [used] = await sql`select count(*)::int as rows, coalesce(sum(llm_cost_usd + worker_cost_usd + exa_cost_usd + decision_cost_usd), 0)::float as usd from usage_events where user_id = ${userId} and kind = 'job'`;
  ok("the run is on the account's usage record as a job", used.rows === 1 && Math.abs(used.usd - run.costUsd) < 0.0001, `${used.rows} row, $${used.usd}`);

  /* ───────── Changed from the page, then by the agent ───────── */
  const patched = (await (await user(`/api/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ title: "AI news, mornings", status: "paused", schedule: { kind: "every", every: 5, unit: "minutes" } }) })).json()).job;
  ok("the page can rename and pause, and cannot change the schedule", patched?.title === "AI news, mornings" && patched.status === "paused" && patched.schedule.kind === "cron");
  const said1 = text("a1", "assistant", "Done. It runs every weekday at 08:00.");
  const second = text("u2", "user", `Change my job "AI news, mornings" (id ${job.id}) to run every 6 hours until 20 November 2030 at 18:00, and resume it.`);
  ok("asked to change it, the agent changes it", (await say(chatId, [first, said1, second])).includes('"toolName":"updateJob"'));
  const changed = (await (await user(`/api/jobs/${job.id}`)).json()).job;
  ok("it now runs every 6 hours until 20 Nov 2030 18:00 and is active", changed?.schedule.kind === "every" && changed.schedule.every === 6 && changed.schedule.unit === "hours" && changed.status === "active" && new Date(changed.untilAt).toISOString() === "2030-11-20T16:00:00.000Z", JSON.stringify({ s: changed?.schedule, status: changed?.status, until: changed?.untilAt && new Date(changed.untilAt).toISOString() }));
  const third = text("u3", "user", "Actually, delete that job.");
  ok("asked to delete it, the agent deletes it", (await say(chatId, [first, said1, second, text("a2", "assistant", `Changed job ${job.id}: every 6 hours until 20 November 2030, 18:00.`), third])).includes('"toolName":"deleteJob"'));
  ok("the job is gone", (await jobsNow()).length === 0);
  await user(`/api/conversations/${chatId}`, { method: "DELETE" });

  /* ───────── The clock, and the usage limit ───────── */
  const start = Date.now();
  const firstAt = new Date(Math.ceil((start + 80_000) / 60_000) * 60_000);
  const secondAt = new Date(firstAt.getTime() + 120_000);
  const a = await say(`jobs-clock-a-${start.toString(36)}`, [text("u1", "user", `Today at ${hhmm(firstAt)}, email me today's date and one line on the weather in Helsinki. Just once.`)]);
  const b = await say(`jobs-clock-b-${start.toString(36)}`, [text("u1", "user", `Today at ${hhmm(secondAt)}, email me one short fun fact about clocks. Just once.`)]);
  ok("two one-time jobs are made", a.includes('"toolName":"createJob"') && b.includes('"toolName":"createJob"'));
  jobs = await jobsNow();
  const jobA = jobs.find((j) => new Date(j.nextRunAt).getTime() === firstAt.getTime());
  const jobB = jobs.find((j) => new Date(j.nextRunAt).getTime() === secondAt.getTime());
  ok(`one is set for ${hhmm(firstAt)} and one for ${hhmm(secondAt)}, each once`, Boolean(jobA && jobB) && jobA.schedule.kind === "once" && jobB.schedule.kind === "once", JSON.stringify(jobs.map((j) => j.schedule)));
  if (!jobA || !jobB) throw new Error("the timed jobs were not made as asked");
  const latest = async (id) => {
    const d = await (await user(`/api/jobs/${id}`)).json();
    return d.runs?.[0] ? { ...d.runs[0], job: d.job } : undefined;
  };
  let runA;
  for (let i = 0; i < 120 && !(runA && runA.status !== "running"); i++) {
    await wait(3000);
    runA = await latest(jobA.id);
  }
  await wait(5000);
  runA = await latest(jobA.id);
  ok("the first job ran by itself", runA?.trigger === "schedule" && runA.status === "done", JSON.stringify(runA && { trigger: runA.trigger, status: runA.status, error: runA.error }));
  ok("it started within half a minute of its time", Boolean(runA) && runA.startedAt >= firstAt.getTime() && runA.startedAt - firstAt.getTime() < 30_000, runA && `${Math.round((runA.startedAt - firstAt.getTime()) / 1000)} s after`);
  ok("the job is finished: it has no run left", runA?.job.status === "done" && runA.job.nextRunAt === undefined);
  if (emailOn) ok("its result was emailed", runA?.emailed === true);

  await sql`update users set usage_cap_usd = 0.0001 where id = ${userId}`;
  const refused = await user(`/api/jobs/${jobB.id}/run`, { method: "POST" });
  ok("at the usage limit, Run now is refused", refused.status === 402 && (await refused.json().catch(() => ({}))).code === "usage_cap", refused.status);
  let runB;
  for (let i = 0; i < 80 && !(runB && runB.status !== "running"); i++) {
    await wait(3000);
    runB = await latest(jobB.id);
  }
  ok("the second job's turn is skipped, with the reason", runB?.status === "skipped" && /usage limit/i.test(runB.error ?? ""), JSON.stringify(runB && { status: runB.status, error: runB.error }));
  const told = (await (await user("/api/notifications")).json().catch(() => ({}))).items ?? [];
  ok("the account is told about both", told.some((n) => n.kind === "job_done" && n.jobId === jobA.id) && told.some((n) => n.kind === "job_failed" && n.jobId === jobB.id), told.map((n) => n.kind).join(","));
  const [charged] = await sql`select count(*)::int as rows from usage_events where user_id = ${userId} and kind = 'job'`;
  ok("the skipped turn cost nothing", charged.rows === 2, `${charged.rows} job rows in all`);
} catch (err) {
  ok("the test ran to its end", false, err instanceof Error ? err.message : err);
} finally {
  await cleanUp();
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nJobs are made, run on time, emailed, counted and stopped by the limit as intended.");
process.exit(failures ? 1 : 0);
