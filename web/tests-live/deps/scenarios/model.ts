/**
 * Dependency 1: the model provider. Every model Dock uses points at tests-live/deps/fake-model.ts; no real key,
 * no network, no spend. For each failure mode: what the buyer's free text, the kitchen assistant, the memory
 * writer and the menu planner answer, whether the order path still works and still refuses, and how long until
 * the first good answer once the model is back. Then Dock's own daily caps (calls, spend) and the per-session
 * free-text allowance.
 */
import { startFakeModel, type ModelMode } from "../fake-model";
import { approverSees, orderAudit, visitorCycle } from "../lib/cycle";
import { secondsUntil } from "../lib/flow";
import { consoleCall, consoleInterpretView, Http, isVisitor, joinAsVisitor, laaksoAgent, type Visitor } from "../lib/http";
import type { Results } from "../lib/results";
import { startDock, type Dock } from "../lib/server";

const MODEL_PORT = 4690;
const APP_PORT = 4630;
const CAP_PORT = 4631;

const modelEnv = (extra: Record<string, string> = {}) => ({
  OPENAI_COMPATIBLE_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1`,
  OPENAI_COMPATIBLE_API_KEY: "fake-key-for-tests",
  DOCK_INTERPRET_MODEL: "compat:fake",
  DOCK_ASSISTANT_MODEL: "compat:fake",
  DOCK_MEMORY_MODEL: "compat:fake",
  DOCK_SCAN_MODEL: "compat:fake",
  DOCK_MENU_MODEL: "compat:fake",
  DOCK_MENU_PICK_MODEL: "compat:fake",
  DOCK_AGENT_MODEL: "compat:fake",
  DOCK_LLM_DAILY_CALLS: "100000",
  DOCK_LLM_DAILY_USD: "1000",
  DOCK_INTERPRET_PER_HOUR: "1000",
  ...extra,
});

let n = 0;
const words = () => `${600 + (n++ % 300)} litres of lactose-free milk for the day-care, please (#${Date.now().toString(36)}${n})`;

type ModelProbes = {
  rest: { status: number; code?: string; ms: number };
  console: { status: number; code?: string; ms: number; view: ReturnType<typeof consoleInterpretView> };
  assistant: { status: number; kind?: string; ms: number; code?: string };
  memory?: { status: number; ms: number; code?: string; error?: string };
  planner?: { status: number; ms: number; code?: string };
  modelCalls: number;
};

async function probeAll(http: Http, v: Visitor, fakeCalls: () => number, opts: { planner?: boolean } = {}): Promise<ModelProbes> {
  const before = fakeCalls();
  const a = await laaksoAgent(http);
  const call = consoleCall(v.http, v.sandboxId);
  const [rest, con, asst] = await Promise.all([
    a.post("/api/v1/agent/interpret", { text: words() }),
    call("POST", "/api/v1/agent/interpret", { text: words() }),
    v.http.post(`/ui-api/kitchens/${v.sandboxId}/assistant`, { question: `Is VA-1010 lactose-free? (${Date.now()}-${n++})`, productId: "VA-1010" }),
  ]);
  const out: ModelProbes = {
    rest: { status: rest.status, code: rest.body?.error?.code ?? rest.error, ms: rest.ms },
    console: { status: con.status, code: con.body?.error?.code ?? con.error, ms: con.ms, view: consoleInterpretView(con) },
    assistant: { status: asst.status, kind: asst.body?.kind, ms: asst.ms, code: asst.body?.error?.code ?? asst.error },
    modelCalls: 0,
  };
  // the memory writer reads the buyer's words of a request (POST /ui-api/memory/kitchens/<k>/requests/<id>)
  const reqId = (await call("POST", "/api/v1/intake", { need: { text: words(), item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 40, unit: "L" } }, by: "deps test" })).body?.step?.requestId;
  if (reqId) {
    const m = await v.http.post(`/ui-api/memory/kitchens/${v.sandboxId}/requests/${reqId}`, {});
    out.memory = { status: m.status, ms: m.ms, code: m.body?.error?.code ?? m.error, error: typeof m.body?.proposer?.error === "string" ? m.body.proposer.error.slice(0, 80) : undefined };
  }
  if (opts.planner) {
    const p = await http.post(`/ui-api/plan/kaari`, { text: `Lunch for 40 covers next Wednesday: vegetable soup and bread (${n++})` });
    out.planner = { status: p.status, ms: p.ms, code: p.body?.error?.code ?? p.error };
  }
  out.modelCalls = fakeCalls() - before;
  return out;
}

function buyerLine(p: ModelProbes): string {
  const s = (x: { status: number; code?: string; ms: number }) => `${x.status}${x.code ? ` ${x.code}` : ""} in ${(x.ms / 1000).toFixed(1)} s`;
  const view = p.console.view.kind === "ok" ? "reads the request" : `"${p.console.view.kind}"${p.console.view.offersOffline ? " + retry + offline reader" : " (no retry, no offline reader)"}`;
  return `free text REST ${s(p.rest)}; console ${s(p.console)} -> ${view}; assistant ${p.assistant.status} ${p.assistant.kind ?? p.assistant.code ?? ""} in ${(p.assistant.ms / 1000).toFixed(1)} s`;
}

export async function modelScenario(results: Results): Promise<void> {
  const fake = await startFakeModel(MODEL_PORT);
  let dock: Dock | undefined;
  try {
    dock = await startDock("model-A", APP_PORT, modelEnv());
    const http = new Http(dock.base);
    const join = async () => {
      const v = await joinAsVisitor(http);
      if (!isVisitor(v)) throw new Error(`visitor join failed: ${v.error}`);
      return v;
    };
    const modes: { mode: ModelMode; delayMs?: number; retryAfter?: string; label: string }[] = [
      { mode: "ok", label: "ok (baseline)" },
      { mode: "slow", delayMs: 20_000, label: "slow 20 s" },
      { mode: "hang", label: "hang (no answer)" },
      { mode: "e500", label: "HTTP 500" },
      { mode: "r429", retryAfter: "30", label: "429 Retry-After 30" },
      { mode: "garbage", label: "200 non-JSON body" },
      { mode: "badjson", label: "200, content not JSON" },
      { mode: "reset", label: "connection reset" },
    ];
    for (const m of modes) {
      console.log(`model: ${m.label}`);
      Object.assign(fake.state, { mode: m.mode, delayMs: m.delayMs ?? 20_000, retryAfter: m.retryAfter ?? "30" });
      const v = await join();
      const probes = await probeAll(http, v, () => fake.stats.calls, { planner: m.mode === "ok" || m.mode === "e500" });
      // the order path does not need a model: run it while the model is failing
      const cycle = await visitorCycle(v);
      // back: the first good free-text answer
      fake.state.mode = "ok";
      let recoveryS: number | null = null;
      if (m.mode !== "ok") {
        const a = await laaksoAgent(http);
        recoveryS = await secondsUntil(async () => (await a.post("/api/v1/agent/interpret", { text: words() })).status === 200, 90_000, 250);
      }
      const audit = await orderAudit(v, cycle.orderId ? [cycle.orderId] : []);
      results.add({
        dependency: "model",
        mode: m.label,
        buyer: `${buyerLine(probes)}; form order: ${cycle.buyer}`,
        approver: approverSees(cycle.approver),
        refusalHeld: cycle.refusalHeld && cycle.refusals.length > 0 && cycle.refusals.every((r) => r.refused),
        lostOrDuplicated: cycle.orderId ? (audit.ledgerOk === false ? `ledger does not verify; ${audit.lostOrDup}` : audit.lostOrDup) : null,
        recoveryS,
        evidence: { probes, refusals: cycle.refusals, states: cycle.trace.states, orderStatus: cycle.orderStatus, approver: cycle.approver, ledgerOk: audit.ledgerOk, modelCallsPerRound: probes.modelCalls },
      });
    }
    await dock.stop();
    dock = undefined;

    // ---- Dock's own daily call cap, and failed calls counting against it ----
    console.log("model: Dock's daily call cap (DOCK_LLM_DAILY_CALLS=3)");
    fake.state.mode = "e500";
    dock = await startDock("model-cap-calls", CAP_PORT, modelEnv({ DOCK_LLM_DAILY_CALLS: "3" }));
    {
      const h = new Http(dock.base);
      const a = await laaksoAgent(h);
      const failing = [];
      for (let i = 0; i < 3; i++) failing.push((await a.post("/api/v1/agent/interpret", { text: words() })).body?.error?.code);
      fake.state.mode = "ok";
      const v = await joinAsVisitor(h);
      const rest = await a.post("/api/v1/agent/interpret", { text: words() });
      const con = isVisitor(v) ? await consoleCall(v.http, v.sandboxId)("POST", "/api/v1/agent/interpret", { text: words() }) : undefined;
      const asst = isVisitor(v) ? await v.http.post(`/ui-api/kitchens/${v.sandboxId}/assistant`, { question: "Is VA-1010 lactose-free?", productId: "VA-1010" }) : undefined;
      const cycle = isVisitor(v) ? await visitorCycle(v) : undefined;
      const health = (await h.get("/api/health")).body?.demoLimits?.llm;
      const view = con ? consoleInterpretView(con) : undefined;
      results.add({
        dependency: "model",
        mode: "Dock daily call cap reached (3 failed provider calls used it up)",
        buyer: `3 calls while the provider answered 500 (${failing.join(", ")}); provider back: REST ${rest.status} ${rest.body?.error?.code ?? ""}; console ${con?.status} ${con?.body?.error?.code ?? ""} -> "${view?.kind}"${view?.offersOffline ? "" : " (no retry, no offline reader)"}; assistant ${asst?.status} ${asst?.body?.kind ?? asst?.body?.error?.code ?? ""}; form order: ${cycle?.buyer}`,
        approver: approverSees(cycle?.approver),
        refusalHeld: cycle ? cycle.refusalHeld && cycle.refusals.every((r) => r.refused) : null,
        lostOrDuplicated: null,
        recoveryS: null,
        evidence: { failing, rest: rest.body?.error, console: con?.body?.error, assistant: asst?.body, health, recovery: "not within the run: the counter resets at midnight UTC or on a restart (server/limits.ts)" },
      });
    }
    await dock.stop();
    dock = undefined;

    // ---- the per-session free-text allowance burnt by failing calls, then Dock's daily spend cap ----
    console.log("model: per-session allowance (default 30/h) and daily spend cap (DOCK_LLM_DAILY_USD=0.02)");
    fake.state.mode = "e500";
    dock = await startDock("model-cap-usd", CAP_PORT, modelEnv({ DOCK_LLM_DAILY_USD: "0.02", DOCK_INTERPRET_PER_HOUR: "" }));
    {
      const h = new Http(dock.base);
      const v = await joinAsVisitor(h);
      if (!isVisitor(v)) throw new Error("join failed");
      const call = consoleCall(v.http, v.sandboxId);
      const codes: Record<string, number> = {};
      for (let batch = 0; batch < 3; batch++) {
        const rs = await Promise.all(Array.from({ length: 10 }, () => call("POST", "/api/v1/agent/interpret", { text: words() })));
        for (const r of rs) codes[`${r.status} ${r.body?.error?.code ?? ""}`] = (codes[`${r.status} ${r.body?.error?.code ?? ""}`] ?? 0) + 1;
      }
      fake.state.mode = "ok";
      const after = await call("POST", "/api/v1/agent/interpret", { text: words() });
      const v2 = await joinAsVisitor(h);
      const other = isVisitor(v2) ? await consoleCall(v2.http, v2.sandboxId)("POST", "/api/v1/agent/interpret", { text: words() }) : undefined;
      results.add({
        dependency: "model",
        mode: "per-session free-text allowance (30/h) after 30 failed calls",
        buyer: `30 failed attempts (${Object.entries(codes).map(([k, c]) => `${c}x ${k}`).join(", ")}); model back: same console session ${after.status} ${after.body?.error?.code ?? ""} ("${String(after.body?.error?.message ?? "").slice(0, 90)}"); new session ${other?.status}`,
        approver: "n/a",
        refusalHeld: null,
        lostOrDuplicated: null,
        recoveryS: null,
        evidence: { codes, after: after.body?.error, retryAfter: after.headers.get("retry-after"), other: other?.status },
      });
      const a = await laaksoAgent(h);
      const spend = [];
      for (let i = 0; i < 3; i++) {
        const r = await a.post("/api/v1/agent/interpret", { text: words() });
        spend.push(`${r.status}${r.body?.error?.code ? ` ${r.body.error.code}` : ""}`);
      }
      const con = isVisitor(v2) ? await consoleCall(v2.http, v2.sandboxId)("POST", "/api/v1/agent/interpret", { text: words() }) : undefined;
      const view = con ? consoleInterpretView(con) : undefined;
      const health = (await h.get("/api/health")).body?.demoLimits?.llm;
      results.add({
        dependency: "model",
        mode: "Dock daily spend cap reached (DOCK_LLM_DAILY_USD)",
        buyer: `REST calls after the session above: ${spend.join(", ")}; console ${con?.status} ${con?.body?.error?.code ?? ""} -> "${view?.kind}"${view?.offersOffline ? "" : " (no retry, no offline reader)"}`,
        approver: "n/a",
        refusalHeld: null,
        lostOrDuplicated: null,
        recoveryS: null,
        evidence: { spend, health, console: con?.body?.error, note: "a model with no known price is counted at 1 cent per call (limits.ts recordLlmSpend)" },
      });
    }
  } finally {
    await dock?.stop();
    await fake.close();
  }
}
