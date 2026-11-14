/* eslint-disable @typescript-eslint/no-explicit-any -- test harness: replies are untyped JSON. */
/**
 * Dependency 2: the partner's live price and availability API, replaced by tests-live/deps/fake-partner.ts.
 * The real catalogue index (web/.data/valio/catalog-index.json.gz) with VALIO_API_BASE pointing at the fake;
 * no secrets, no network. For each failure mode: the console and REST buyer, an MCP agent, recovery time. Then:
 * a quote and an order asked while the partner is down (after the options were shown), sign-off while the
 * partner is down, and five full orders while the partner flaps, audited for lost or duplicated orders.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { startFakePartner, type PartnerMode } from "../fake-partner";
import { approverSees, orderAudit, visitorCycle } from "../lib/cycle";
import { approverFlow, deliveryDay, driveIntake, refusalChecks, reuseCheck, secondsUntil } from "../lib/flow";
import { consoleCall, Http, isVisitor, joinAsVisitor, laaksoAgent, passkeyDecide, restCaller, type Visitor } from "../lib/http";
import { mcpLiveCheck } from "../lib/mcp";
import type { Results } from "../lib/results";
import { startDock, WEB, type Dock } from "../lib/server";

const API_PORT = 4691;
const CONTROL_PORT = 4692;
const APP_PORT = 4632;
/** Flap period: 3 s is absorbed by the partner client's own retries (0.5 + 1 + 2 s); 10 s reaches the buyer. */
const FLAP_S = Number(process.env.DEPS_FLAP_S ?? 10);

/**
 * Delivery dates the demo mandates accept (weekdays within maxLeadDays 5). Live answers are cached per product and
 * date (the partner client keeps availability 60 s and prices 10 min; Dock's option cards are set to 0 s here), so
 * a date is reused only after 65 s, when its availability has expired: every probe group then reaches the partner.
 */
const lastUsed = new Map<string, number>();
function validDates(): string[] {
  const out = new Set<string>();
  for (let d = 2; d <= 5; d++) out.add(deliveryDay(d));
  return [...out].filter((x) => Date.parse(`${x}T12:00:00Z`) - Date.now() <= 5 * 864e5);
}
async function freshDate(): Promise<string> {
  const dates = validDates();
  const date = dates.sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0))[0];
  const wait = (lastUsed.get(date) ?? 0) + 65_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastUsed.set(date, Date.now());
  return date;
}
const markUsed = (date: string) => lastUsed.set(date, Date.now());

const need = (litres: number, deliverBy: string) => ({ item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: litres, unit: "L" }, deliverBy });

export async function partnerScenario(results: Results): Promise<void> {
  const index = path.join(WEB, ".data/valio/catalog-index.json.gz");
  if (!existsSync(index)) return results.skip("partner", `no real catalogue index at ${index} (pnpm index:build)`);
  const fake = await startFakePartner(API_PORT, CONTROL_PORT);
  let dock: Dock | undefined;
  try {
    dock = await startDock("partner", APP_PORT, { DOCK_CATALOG: "", VALIO_API_BASE: `http://127.0.0.1:${API_PORT}`, VALIO_API_KEY: "fake-key-for-tests", VALIO_INDEX_PATH: index, DOCK_LIVE_CACHE_SECONDS: "0" }, { readyTimeoutMs: 120_000 });
    const http = new Http(dock.base);
    const health = (await http.get("/api/health")).body;
    if (health?.catalog?.source !== "valio") {
      results.note(`partner: server is on catalogue ${health?.catalog?.source}, not the real index; partner rows are not meaningful`);
    }
    const join = async (): Promise<Visitor> => {
      const v = await joinAsVisitor(http);
      if (!isVisitor(v)) throw new Error(`visitor join failed: ${v.error}`);
      return v;
    };
    // warm the index and the first request
    await driveIntake(restCaller(await laaksoAgent(http)), need(100, await freshDate()), { placeOrder: false });

    const modes: { mode: PartnerMode; label: string; delayMs?: number; retryAfter?: string }[] = [
      { mode: "ok", label: "ok (baseline)" },
      { mode: "slow", delayMs: 20_000, label: "slow 20 s" },
      { mode: "hang", label: "hang (no answer)" },
      { mode: "r429", retryAfter: "30", label: "429 Retry-After 30" },
      { mode: "r429", retryAfter: "1", label: "429 Retry-After 1" },
      { mode: "e503", label: "HTTP 503" },
      { mode: "refused", label: "down (connection refused)" },
      { mode: "reset", label: "connection reset" },
      { mode: "garbage", label: "200 HTML body" },
    ];
    for (const m of process.env.DEPS_PARTNER_EXTRAS_ONLY === "1" ? [] : modes) {
      console.log(`partner: ${m.label}`);
      const date = await freshDate();
      await fake.setMode({ mode: m.mode, delayMs: m.delayMs ?? 20_000, retryAfter: m.retryAfter ?? "30" });
      const calls0 = fake.stats.calls;
      const v = await join();
      const a = await laaksoAgent(http);
      const [con, rest, mcp] = await Promise.all([
        driveIntake(consoleCall(v.http, v.sandboxId), need(1000, date), { placeOrder: false }),
        driveIntake(restCaller(a), need(990, date), { placeOrder: false }),
        mcpLiveCheck(dock.base, date),
      ]);
      const partnerCalls = fake.stats.calls - calls0;
      let recoveryS: number | null = null;
      await fake.setMode({ mode: "ok" });
      if (m.mode !== "ok") {
        const probe = await laaksoAgent(http);
        recoveryS = await secondsUntil(async () => (await driveIntake(restCaller(probe), need(980, date), { placeOrder: false })).states.includes("options_ready"), 90_000, 250);
      }
      // the full order with sign-off once the partner is back
      const cycle = await visitorCycle(v, { deliverBy: date });
      const audit = await orderAudit(v, cycle.orderId ? [cycle.orderId] : []);
      const s = (t: { states: string[]; ms: number }) => `${t.states.at(-1)} in ${(t.ms / 1000).toFixed(1)} s`;
      results.add({
        dependency: "partner",
        mode: m.label,
        buyer: `console ${s(con)} ("${(con.final?.notes?.[0] ?? con.firstError?.message ?? "").slice(0, 110)}"); REST ${s(rest)}; MCP ${mcp.ok ? `${mcp.offers} offers` : `error "${mcp.error?.slice(0, 80)}"`} in ${(mcp.ms / 1000).toFixed(1)} s; after: ${cycle.buyer}`,
        approver: approverSees(cycle.approver),
        refusalHeld: cycle.refusals.length ? cycle.refusalHeld && cycle.refusals.every((r) => r.refused) : null,
        lostOrDuplicated: cycle.orderId ? (audit.ledgerOk === false ? `ledger does not verify; ${audit.lostOrDup}` : audit.lostOrDup) : null,
        recoveryS,
        evidence: { console: { states: con.states, ms: con.ms, notes: con.final?.notes, err: con.firstError }, rest: { states: rest.states, ms: rest.ms, err: rest.firstError }, mcp, partnerCallsDuringOutage: partnerCalls, refusals: cycle.refusals, ledgerOk: audit.ledgerOk },
      });
      markUsed(date);
    }

    // ---- options shown, then the partner goes down before the buyer takes one: quote, then order ----
    console.log("partner: quote and order asked while the partner is down");
    {
      const date = await freshDate();
      const v = await join();
      const call = consoleCall(v.http, v.sandboxId);
      const t = await driveIntake(call, need(1000, date), { placeOrder: false });
      // a second request stopped at options_ready (cards shown, nothing quoted yet)
      const opts = await call("POST", "/api/v1/intake", { need: need(1001, date), by: "deps" });
      let step = opts.body?.step;
      for (let i = 0; i < 3 && step && step.state !== "options_ready"; i++) {
        if (step.state === "needs_confirmation") step = (await call("POST", `/api/v1/intake/${step.requestId}/concerns`, { by: "deps", responses: step.concerns.map((c: any) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections?.[0]?.id })) })).body?.step;
        else if (step.state === "needs_input") step = (await call("POST", `/api/v1/intake/${step.requestId}/answers`, { by: "deps", answers: step.questions.map((q: any) => ({ questionId: q.id, optionId: q.options[0].id })) })).body?.step;
        else break;
      }
      const ready = step?.state === "options_ready";
      // the partner client keeps availability 60 s: wait it out, so the quote must ask the partner
      await new Promise((r) => setTimeout(r, 62_000));
      await fake.setMode({ mode: "refused" });
      const choiceDown = ready ? await call("POST", `/api/v1/intake/${step.requestId}/choice`, { by: "deps", optionId: step.options[0].optionId }) : undefined;
      const choiceDownState = choiceDown?.body?.step?.state ?? `http_${choiceDown?.status} ${choiceDown?.body?.error?.code ?? ""}`;
      // a quote that was fixed before the outage: can it be ordered while the partner is down?
      const preQuote = t.quoteStep;
      const orderDown = preQuote ? await call("POST", "/api/v1/orders", preQuote.next.example) : undefined;
      const refusalsDown = preQuote ? await refusalChecks(call, preQuote) : [];
      await fake.setMode({ mode: "ok" });
      const back0 = Date.now();
      let choiceBack: any;
      let recoveryS: number | null = null;
      if (ready) {
        recoveryS = await secondsUntil(async () => {
          choiceBack = await call("POST", `/api/v1/intake/${step.requestId}/choice`, { by: "deps", optionId: step.options[0].optionId });
          return choiceBack.body?.step?.state === "quoted";
        }, 60_000, 250);
      }
      const orderBack = choiceBack?.body?.step?.state === "quoted" ? await call("POST", "/api/v1/orders", choiceBack.body.step.next.example) : undefined;
      const reuse = choiceBack?.body?.step?.state === "quoted" ? await reuseCheck(call, choiceBack.body.step) : undefined;
      const ids = [orderDown?.body?.order?.orderId, orderBack?.body?.order?.orderId].filter(Boolean) as string[];
      // approver signs both while the partner is down
      await fake.setMode({ mode: "refused" });
      const approvals = [];
      for (const o of [orderDown, orderBack]) {
        const apr = o?.body?.order?.approval?.approvalId;
        if (apr) approvals.push(await approverFlow(v, apr, "approve", passkeyDecide));
      }
      await fake.setMode({ mode: "ok" });
      const audit = await orderAudit(v, ids);
      markUsed(date);
      const allRefusals = [...refusalsDown, ...(reuse ? [reuse] : [])];
      results.add({
        dependency: "partner",
        mode: "down after options were shown; order a quote fixed before; sign-off while down",
        buyer: `choose option while down -> ${choiceDownState} in ${((choiceDown?.ms ?? 0) / 1000).toFixed(1)} s ("${String(choiceDown?.body?.step?.notes?.[0] ?? choiceDown?.body?.error?.message ?? "").slice(0, 100)}"); order on a quote fixed before the outage -> ${orderDown?.body?.order?.status ?? orderDown?.status}; same choice after return -> ${choiceBack?.body?.step?.state ?? choiceBack?.status} -> order ${orderBack?.body?.order?.status ?? orderBack?.status}`,
        approver: approvals.map((a) => approverSees(a)).join(" / ") || "none",
        refusalHeld: allRefusals.length > 0 && allRefusals.every((r) => r.refused),
        lostOrDuplicated: audit.ledgerOk === false ? `ledger does not verify; ${audit.lostOrDup}` : audit.lostOrDup,
        recoveryS,
        evidence: { choiceDown: choiceDown?.body?.step ? { state: choiceDown.body.step.state, notes: choiceDown.body.step.notes } : choiceDown?.body, orderDown: orderDown?.body?.order?.status ?? orderDown?.body, orderBack: orderBack?.body?.order?.status, refusals: allRefusals, approvals, backAfterMs: Date.now() - back0, ledgerOk: audit.ledgerOk },
      });
    }

    // ---- five buyers order while the partner flaps every 3 s; each retries a failed step like a person would ----
    console.log(`partner: five orders while the partner flaps (${FLAP_S} s down / ${FLAP_S} s up)`);
    {
      await fake.setMode({ mode: "flap", flapMs: FLAP_S * 1000 });
      const placed: string[] = [];
      const lines: string[] = [];
      let retries = 0;
      let committed = 0;
      let refusalsTried = 0;
      let refusalsAccepted = 0;
      const vs: Visitor[] = [];
      for (let i = 0; i < 5; i++) vs.push(await join());
      for (const v of vs) {
        const date = await freshDate();
        let c;
        for (let attempt = 0; attempt < 8; attempt++) {
          c = await visitorCycle(v, { deliverBy: date, approve: false });
          refusalsTried += c.refusals.length;
          refusalsAccepted += c.refusals.filter((r) => !r.refused).length + (c.refusalHeld ? 0 : 1);
          if (c.orderId) break;
          retries++;
          await new Promise((r) => setTimeout(r, 1_000));
        }
        markUsed(date);
        if (c?.orderId) placed.push(c.orderId);
        lines.push(c?.orderStatus ?? c?.trace.states.at(-1) ?? "?");
        if (c?.approvalId) {
          const ap = await approverFlow(v, c.approvalId, "approve", passkeyDecide);
          if (ap.orderStatus === "committed") committed++;
          else lines.push(`sign-off ${ap.decideStatus} ${ap.decideCode ?? ""}`);
        }
      }
      await fake.setMode({ mode: "ok" });
      const audits = await Promise.all(vs.map((v, i) => orderAudit(v, placed[i] ? [placed[i]] : [])));
      const dup = audits.filter((a) => a.lostOrDup !== "none").map((a) => a.lostOrDup);
      results.add({
        dependency: "partner",
        mode: `flapping ${FLAP_S} s down / ${FLAP_S} s up, 5 buyers, retry on failure`,
        buyer: `${placed.length}/5 orders placed after ${retries} retried attempts (${lines.join(", ")}); ${committed} committed after sign-off`,
        approver: `${committed}/${placed.length} signed and committed while flapping`,
        refusalHeld: refusalsAccepted === 0 && refusalsTried > 0,
        lostOrDuplicated: dup.length ? dup.join(" | ") : audits.some((a) => a.ledgerOk === false) ? "ledger does not verify" : "none",
        recoveryS: null,
        evidence: { placed, retries, lines, refusalsAccepted, partnerCalls: fake.stats.calls },
      });
    }
    results.note(`partner: fake partner answered ${fake.stats.calls} calls in total (${JSON.stringify(fake.stats.byMode)})`);
  } finally {
    await dock?.stop();
    await fake.close();
  }
}

