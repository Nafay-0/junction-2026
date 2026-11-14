import { randomUUID } from "node:crypto";
import { addDaysIso, localNow, nextDeliveryDay } from "@/core/kitchen";
import { moneyShort, say } from "@/app/_ui/plain";
import { runBuyerAgent } from "../agent/runner";
import { defaultModel, hasCredentials, parseModelSpec, CHEAP_DEFAULTS } from "../agent/models";
import type { TranscriptEvent } from "../agent/transcript";
import { getRun, launch, launcherStatus, type Run } from "../aiven/showcase/launcher";
import type { Runtime } from "../runtime";
import { ShowAgent, type Json } from "./agent";
import { keepOutside } from "./keep";
import { resolveKitchen } from "./registry";
import type { GateView, OutsideEvent, OutsideRun } from "./types";

/**
 * "Any agent can order": an outside agent arrives at the same gate through the open interface.
 *
 *   aiven    the Aiven-hosted buyer (Managed Agents runtime), when this server is configured to launch it. It
 *            orders for the partner's demo organisation through the public MCP door. When Aiven refuses a run or
 *            the day's runs are used, its launcher plays its own labelled recording (aiven/showcase).
 *   builtin  Dock's reference buyer agent (src/server/agent/runner.ts) on a chosen model, given the visitor
 *            kitchen's own signed mandate, talking to Dock only through the MCP tools any outside agent gets.
 *
 * Model spend is capped per run (the runner's $0.05) and per day (DOCK_SHOW_MODEL_USD_PER_DAY, default $2), and
 * runs per day (DOCK_SHOW_OUTSIDE_RUNS_PER_DAY, default 25). The week itself makes no model calls.
 */
export const OUTSIDE_LIMITS = {
  runsPerDay: Number(process.env.DOCK_SHOW_OUTSIDE_RUNS_PER_DAY ?? 25),
  usdPerDay: Number(process.env.DOCK_SHOW_MODEL_USD_PER_DAY ?? 2),
  usdPerRun: 0.05,
};

type State = { runs: Map<string, OutsideRun>; frames: Map<string, { t0: number; list: { t: number; data: OutsideRun }[] }>; day: string; used: number; usd: number; waiters: Map<string, Set<() => void>> };
const g = globalThis as typeof globalThis & { __dockShowOutside?: State };
const state = (): State => {
  const s = (g.__dockShowOutside ??= { runs: new Map(), frames: new Map(), day: today(), used: 0, usd: 0, waiters: new Map() });
  if (s.day !== today()) Object.assign(s, { day: today(), used: 0, usd: 0 });
  return s;
};
const today = () => new Date().toISOString().slice(0, 10);

export function outsideSpend(): { used: number; usd: number } {
  const s = state();
  return { used: s.used, usd: Math.round(s.usd * 10_000) / 10_000 };
}

/** The models this server can run the reference buyer on (a key is set), cheapest first. */
export function availableModels(env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set<string>();
  const preferred = defaultModel("DOCK_AGENT_MODEL", env);
  if (preferred) out.add(preferred);
  for (const p of ["anthropic", "openai", "google"] as const) if (hasCredentials(p, env)) out.add(CHEAP_DEFAULTS[p]);
  return [...out];
}

function touch(run: OutsideRun) {
  run.version += 1;
  const f = state().frames.get(run.runId) ?? { t0: Date.parse(run.startedAt), list: [] };
  state().frames.set(run.runId, f);
  f.list.push({ t: Date.now() - f.t0, data: structuredClone(run) });
  if (run.state === "done") void keepOutside(run, f.list);
  for (const w of [...(state().waiters.get(run.runId) ?? [])]) w();
}

export async function startOutside(rt: Runtime, opts: { sandboxId?: string; runner?: "auto" | "aiven" | "builtin"; model?: string; by: string }): Promise<OutsideRun> {
  const s = state();
  if (s.used >= OUTSIDE_LIMITS.runsPerDay) throw Object.assign(new Error(`The show's ${OUTSIDE_LIMITS.runsPerDay} outside-agent runs for today are used; switch to the recording (key F).`), { code: "show_daily_cap" });
  if (s.usd + OUTSIDE_LIMITS.usdPerRun > OUTSIDE_LIMITS.usdPerDay) throw Object.assign(new Error(`Model spend today is $${s.usd.toFixed(2)} of the $${OUTSIDE_LIMITS.usdPerDay} cap; switch to the recording (key F).`), { code: "show_spend_cap" });
  const aiven = launcherStatus();
  const runner = opts.runner === "aiven" || (opts.runner !== "builtin" && aiven.configured) ? "aiven" : "builtin";
  s.used += 1;
  return runner === "aiven" ? startAiven(opts.by) : startBuiltin(rt, opts);
}

async function startBuiltin(rt: Runtime, opts: { sandboxId?: string; model?: string }): Promise<OutsideRun> {
  const model = opts.model && availableModels().includes(opts.model) ? opts.model : availableModels()[0];
  if (!model) throw Object.assign(new Error("No model key is set on this server (ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY); play the recording instead."), { code: "model_key_missing" });
  parseModelSpec(model);
  const k = await resolveKitchen(rt, opts.sandboxId);
  const date = nextDeliveryDay(addDaysIso(localNow(new Date()).date, 1), [1, 2, 3, 4, 5, 6])!;
  const task = `We need 30 litres of lactose-free milk delivered by ${date}. Order the cheapest option that meets our rules.`;
  const run: OutsideRun = {
    runId: `out_${randomUUID().slice(0, 12)}`,
    version: 0,
    runner: "builtin",
    model,
    door: "MCP (the open Model Context Protocol door), with the kitchen's own signed mandate",
    kitchenName: k.ref.name,
    task,
    state: "running",
    events: [{ at: new Date().toISOString(), kind: "info", text: `A buyer agent on ${model} connects to the MCP door with ${k.ref.name}'s mandate.` }],
    startedAt: new Date().toISOString(),
    source: "live",
  };
  state().runs.set(run.runId, run);
  void (async () => {
    try {
      const result = await runBuyerAgent({
        model,
        task,
        credentials: { mandate: k.token, agentId: k.ref.agentId },
        caps: { maxCostUsd: OUTSIDE_LIMITS.usdPerRun, maxSteps: 14, maxWallMs: 120_000 },
        onEvent: (e) => {
          const ev = eventOf(e);
          if (ev) {
            run.events.push(ev);
            if (run.events.length > 60) run.events.splice(1, run.events.length - 60);
            touch(run);
          }
        },
      });
      state().usd += result.costUsd ?? 0;
      run.costUsd = result.costUsd ?? undefined;
      run.outcome = outcomeText(result.outcome, result.order?.totalCents);
      run.orderId = result.order?.orderId;
      run.totalCents = result.order?.totalCents;
      if (run.orderId) run.gate = await gateOf(new ShowAgent({ mandateToken: k.token, agentId: k.ref.agentId }, { kitchen: k.ref.sandboxId, share: "show-outside" }), run.orderId, k.ref.perOrderLimitCents);
      run.state = "done";
    } catch (err) {
      run.state = "failed";
      run.outcome = err instanceof Error ? err.message : String(err);
    }
    run.endedAt = new Date().toISOString();
    touch(run);
  })();
  return structuredClone(run);
}

async function startAiven(by: string): Promise<OutsideRun> {
  const r = await launch("within", { by });
  if ("refused" in r) throw Object.assign(new Error(r.refused.reason), { code: r.refused.code });
  const a = r.run;
  const run: OutsideRun = {
    runId: `out_${a.runId}`,
    version: 0,
    runner: "aiven",
    model: a.model,
    door: "MCP on the public site, from Aiven's Managed Agents runtime",
    kitchenName: "Laakso Catering (the partner's demo organisation)",
    task: a.question,
    state: "running",
    events: [],
    startedAt: a.startedAt,
    source: a.recorded ? "recording" : "live",
    recordedAt: a.recordedAt,
  };
  state().runs.set(run.runId, run);
  const follow = setInterval(() => {
    const now = getRun(a.runId);
    if (!now) return;
    syncAiven(run, now);
    if (now.status === "done" || now.status === "failed") clearInterval(follow);
  }, 700);
  follow.unref?.();
  syncAiven(run, a);
  return structuredClone(run);
}

function syncAiven(run: OutsideRun, a: Run) {
  const events: OutsideEvent[] = a.messages.map((m) => ({ at: m.at, kind: m.type === "tool_call" || m.type === "tool_return" ? "tool" : m.type === "assistant" ? "model" : "info", text: say(m.tool ? `${m.tool}: ${m.text}` : m.text).slice(0, 240) }));
  if (events.length !== run.events.length || a.status !== run.state) {
    run.events = events;
    run.state = a.status === "done" ? "done" : a.status === "failed" ? "failed" : "running";
    run.orderId = a.orderId;
    run.outcome = a.outcome ?? a.error;
    if (run.state !== "running") run.endedAt = a.endedAt ?? new Date().toISOString();
    touch(run);
  }
}

function outcomeText(outcome: string, totalCents?: number): string {
  const money = totalCents !== undefined ? ` (${moneyShort(totalCents)})` : "";
  switch (outcome) {
    case "committed":
      return `Placed within the kitchen's mandate${money}: the gate let the agent decide alone.`;
    case "pending_approval":
      return `Stopped at the gate${money}: waiting for the kitchen's named person.`;
    case "refused":
      return "Refused at the gate, with the rule named.";
    default:
      return `Ended: ${outcome.replaceAll("_", " ")}.`;
  }
}

async function gateOf(agent: ShowAgent, orderId: string, limitCents: number): Promise<GateView | undefined> {
  const o = (await agent.getOrder(orderId)).body.order as Json | undefined;
  if (!o) return undefined;
  const rules = (o.decision.rules as Json[]).map((r) => ({ rule: String(r.rule), outcome: r.outcome }));
  const deciding = rules.find((r) => r.outcome === "fail") ?? rules.find((r) => r.outcome === "escalate");
  return { outcome: o.decision.outcome, rule: deciding?.rule, reasons: (o.decision.reasons as string[]).map((r) => say(r)), checks: rules, totalCents: o.totalCents, limitCents };
}

function eventOf(e: TranscriptEvent): OutsideEvent | undefined {
  const at = new Date().toISOString();
  switch (e.type) {
    case "model":
      return e.toolCalls.length ? { at, kind: "model", text: `The model decides to call ${e.toolCalls.map((t) => t.name).join(", ")}.` } : e.text ? { at, kind: "model", text: e.text.slice(0, 240) } : undefined;
    case "tool_result":
      return { at, kind: "tool", text: `${e.name}: ${e.ok ? "answered" : "failed"}${summarise(e.result)}` };
    case "refusal":
      return { at, kind: "error", text: `${e.name} refused${e.rule ? ` (${e.rule})` : ""}: ${say(e.message).slice(0, 200)}` };
    case "human":
      return { at, kind: "human", text: "Dock asked the buyer a question; a stand-in answered for the demo." };
    case "cap":
      return { at, kind: "error", text: `Stopped by the run's own cap (${e.cap}).` };
    case "error":
      return { at, kind: "error", text: e.message.slice(0, 200) };
    default:
      return undefined;
  }
}

function summarise(result: unknown): string {
  const r = result as Json | undefined;
  if (!r || typeof r !== "object") return "";
  if (r.order?.status) return `: order ${String(r.order.status).replace("_", " ")}${r.order.totalCents ? `, ${moneyShort(r.order.totalCents)}` : ""}`;
  if (r.state) return `: ${String(r.state).replaceAll("_", " ")}`;
  if (Array.isArray(r.products)) return `: ${r.products.length} products`;
  return "";
}

export function getOutside(runId: string): OutsideRun | undefined {
  const r = state().runs.get(runId);
  return r && structuredClone(r);
}

export async function nextOutside(runId: string, after: number, waitMs = 15_000): Promise<OutsideRun | undefined> {
  const s = state();
  const r = s.runs.get(runId);
  if (!r) return undefined;
  if (r.version > after || r.state !== "running") return structuredClone(r);
  await new Promise<void>((resolve) => {
    const set = s.waiters.get(runId) ?? new Set();
    s.waiters.set(runId, set);
    const done = () => {
      clearTimeout(t);
      set.delete(done);
      resolve();
    };
    const t = setTimeout(done, waitMs);
    set.add(done);
  });
  return getOutside(runId);
}
