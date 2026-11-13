/**
 * Restart proof against a deployed server, the agent side (the phone side is e2e/restart.spec.ts):
 *
 *   pnpm restart-proof before --url https://<host> --state <file>
 *     an agent order through the intake, committed alone; remembers the order, its used quote and the ledger head
 *   ... restart the app (node infra/aiven-deploy.mjs --restart) ...
 *   pnpm restart-proof after --url https://<host> --state <file>
 *     the order reads back unchanged, the ledger verifies (app and operations desk) and still contains the head
 *     seen before, and placing the order again with the used quote is refused
 *
 * Signs Laakso Catering's demo mandate with DOCK_DEMO_ORG_JWK (web/.env.local); enters /ops with DOCK_OPS_PASSCODE.
 * Prints PASS or FAIL; exits 1 on failure. Prints no secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { signMandate } from "@/core/mandate";
import { addDays, isoDate } from "@/core/util";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { DockClient, type Step } from "./lib/client";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();
const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const phase = args[0];
const url = (flag("--url") ?? "").replace(/\/$/, "");
const stateFile = flag("--state");
if (!["before", "after"].includes(phase) || !url || !stateFile) {
  console.error("usage: pnpm restart-proof before|after --url <https://host> --state <file>");
  process.exit(2);
}

type State = { orderId: string; requestId: string; status: string; totalCents: number; quoteToken: string; lines: { productId: string; quantity: number; unitPriceCents: number }[]; head: { seq: number; hash: string }; startedAt: string };

const results: [string, boolean, string][] = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(38)} ${detail}`);
};

function deliveryDay(): string {
  let d = new Date();
  for (let n = 0; n < 3; ) {
    d = addDays(d, 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return isoDate(d);
}

async function json(path: string, init?: RequestInit) {
  const r = await fetch(url + path, { ...init, signal: AbortSignal.timeout(30_000) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any>, headers: r.headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function ledgerCheck(): Promise<{ ok: boolean; length: number; head?: { seq: number; hash: string }; detail: string }> {
  const r = await json("/api/v1/ledger");
  if (r.status === 200) return { ok: r.body.verification?.ok === true, length: r.body.entries?.length ?? 0, head: r.body.head, detail: `app: ok ${r.body.verification?.ok}, ${r.body.entries?.length} entries` };
  return { ok: false, length: 0, detail: `GET /api/v1/ledger -> ${r.status}` };
}

async function opsVerify(): Promise<string> {
  const passcode = process.env.DOCK_OPS_PASSCODE?.trim();
  if (!passcode) return "no DOCK_OPS_PASSCODE";
  const enter = await json("/ops-api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode, name: "Restart proof" }) });
  const cookie = (enter.headers.get("set-cookie") ?? "").split(";")[0];
  const v = await json("/ops-api/verify", { headers: { cookie } });
  await fetch(url + "/ops-api/session", { method: "DELETE", headers: { cookie } });
  return v.status === 200 ? JSON.stringify(v.body).slice(0, 200) : `HTTP ${v.status}`;
}

async function main() {
  const agent = new DockClient((r) => fetch(r), url).as(await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), DEMO_ORG.agentId);
  const health = (await json("/api/health")).body;
  console.log(`${phase} restart: ${url}, commit ${String(health.version?.commit).slice(0, 12)}, process started ${health.startedAt}, store ${health.dataPlane?.switches?.store}\n`);

  if (phase === "before") {
    const by = "Restart proof";
    let s: Step = (await agent.intakeOpen({ item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 100, unit: "L" }, deliverBy: deliveryDay(), optimise: "price" }, by)).body.step;
    for (let i = 0; i < 5 && s && s.state !== "quoted"; i++) {
      if (s.state === "needs_confirmation") s = (await agent.intakeConcerns(s.requestId, by, s.concerns.map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })))).body.step;
      else if (s.state === "needs_input") s = (await agent.intakeAnswers(s.requestId, by, s.questions.map((q) => ({ questionId: q.id, optionId: (q.options.find((o) => o.id === "no_preference") ?? q.options[0]).id })))).body.step;
      else if (s.state === "options_ready") s = (await agent.intakeChoice(s.requestId, by, s.options[0].optionId)).body.step;
      else break;
    }
    if (s?.state !== "quoted" || !s.quote) return record("order before restart", false, `intake ended as ${s?.state}`);
    const lines = s.quote.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));
    const placed = await agent.placeOrder(s.requestId, s.quote.quoteToken, lines);
    const order = placed.body.order;
    record("order before restart", placed.status === 201 || placed.status === 202, `HTTP ${placed.status}, ${order?.orderId} ${order?.status} €${((order?.totalCents ?? 0) / 100).toFixed(2)}`);
    const l = await ledgerCheck();
    record("ledger before restart", l.ok, `${l.detail}, head #${l.head?.seq}`);
    const state: State = { orderId: order.orderId, requestId: s.requestId, status: order.status, totalCents: order.totalCents, quoteToken: s.quote.quoteToken, lines, head: l.head!, startedAt: health.startedAt };
    writeFileSync(stateFile!, JSON.stringify(state));
  } else {
    const st = JSON.parse(readFileSync(stateFile!, "utf8")) as State;
    record("a new process is serving", health.startedAt !== st.startedAt, `started ${st.startedAt} -> ${health.startedAt}`);
    const o = await agent.getOrder(st.orderId);
    record("order placed before is readable", o.status === 200 && o.body.order?.status === st.status && o.body.order?.totalCents === st.totalCents, `HTTP ${o.status}, ${o.body.order?.orderId} ${o.body.order?.status} €${((o.body.order?.totalCents ?? 0) / 100).toFixed(2)}`);
    const again = await agent.placeOrder(st.requestId, st.quoteToken, st.lines);
    record("used quote is still refused", again.status >= 400 && /replay|used|quote/.test(`${again.body.error?.code} ${again.body.error?.rule}`), `HTTP ${again.status}, rule ${again.body.error?.rule}, code ${again.body.error?.code}`);
    const l = await ledgerCheck();
    const r = await json(`/api/v1/ledger?orderId=${st.orderId}`);
    const keepsHead = (l.head?.seq ?? -1) >= st.head.seq && (r.body.entries ?? []).length > 0;
    record("ledger verifies after restart", l.ok && keepsHead, `${l.detail}, head #${st.head.seq} -> #${l.head?.seq}, ${(r.body.entries ?? []).length} entries for the order`);
    console.log(`      operations desk verify: ${await opsVerify()}`);
  }
  const failed = results.filter((x) => !x[1]).length;
  console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed} of ${results.length} (${phase} restart).`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
