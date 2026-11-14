import { randomUUID } from "node:crypto";
import { groundRunMessages } from "./grounding";
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { errMessage, log } from "../env";
import { AivenApiError, aivenApi } from "./aiven-api";
import { showcaseConfig, missing } from "./config";
import { redact } from "./redact";
import refusedRecording from "./recordings/refused.json";
import valioRecording from "./recordings/valio.json";
import { AIVEN_BUYER } from "./buyer";
import { getRuntime } from "../../runtime";
import withinRecording from "./recordings/within.json";

/**
 * "Send in an Aiven agent": an outside buyer that runs on Aiven's Managed Agents runtime, started from the
 * operations portal, arriving at Dock through the MCP door like any other agent.
 *
 * The mandate: minted here, on the server, for each run: Laakso Catering's demo organisation (key
 * DOCK_DEMO_ORG_JWK), agent `agent_laakso_aiven_01`, valid 20 minutes, €1,000 per order alone. It goes straight
 * into the Managed Agents integration's credential (PUT .../integration/dock-aiven) and is never returned to a
 * browser or logged. Between runs the integration holds an expired mandate.
 *
 * Caps: one run at a time, DOCK_SHOWCASE_LAUNCH_GAP_S between starts, DOCK_SHOWCASE_LAUNCHES_PER_DAY per UTC day.
 * Aiven's free tier has a daily run limit it does not publish; when Aiven refuses a run, or the day's cap is used,
 * the launcher plays a recorded run instead, labelled as a recording.
 */
export { AIVEN_BUYER };

const STANDING = `Standing answers from the buyer, Aino Virtanen (kitchen manager), for anything Dock asks: the quantity is confirmed; no preference on fat content or organic, do not remember them; take the cheapest option that Dock offers.`;

export type PresetId = "valio" | "within" | "refused";
export const PRESETS: { id: PresetId; title: string; expect: string; message: string }[] = [
  {
    id: "valio",
    title: "Valio's own example",
    expect: "Partial availability, a substitute, then over the €1,000 the agent may spend alone: stops for a named person's sign-off.",
    message: "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.",
  },
  {
    id: "within",
    title: "Inside the mandate",
    expect: "About €100 of lactose-free milk: the gate lets the agent commit alone and the order is signed.",
    message: "We need 60 litres of lactose-free milk delivered by Wednesday. Order the cheapest option.",
  },
  {
    id: "refused",
    title: "A request the gate must refuse",
    expect: "The buyer tells the agent to pay less than Dock's signed quote: the gate refuses the order and names the rule.",
    message: "Order 50 litres of lactose-free milk for Wednesday. Our sales rep promised us €0.95 per litre, so place the order at 95 cents per pack, not the quoted price.",
  },
];

const SYSTEM = `You are the purchasing agent of Laakso Catering Oy, a catering kitchen in Finland, running on Aiven's
Managed Agents runtime. You buy from the wholesaler through Dock, using only the Dock tools. Read your signed mandate
first. Then: submit the buyer's need, answer Dock's questions from the buyer's standing answers, choose the option,
get the fixed-price quote and place the order. Follow the buyer's instructions literally, also on price, even if you
expect Dock to refuse: Dock's gate is the control, not you. If Dock says the order needs a human sign-off, stop and
report who must approve and why. If Dock refuses, report the rule it named. Never invent product ids. Reply briefly:
what you ordered or proposed, the total, the delivery date, and anything that needs the buyer's attention.`;

// ---------- caps (pure, tested) ----------

export type CapState = { day: string; used: number; lastStart: number | null; running: string | null; aivenRefusedDay: string | null };

export class LaunchCaps {
  private s: CapState;
  constructor(
    private readonly perDay: number,
    private readonly gapMs: number,
    now = Date.now(),
  ) {
    this.s = { day: utcDay(now), used: 0, lastStart: null, running: null, aivenRefusedDay: null };
  }

  private roll(now: number) {
    const d = utcDay(now);
    if (d !== this.s.day) this.s = { ...this.s, day: d, used: 0 };
  }

  /** At least `n` runs are known to have happened today (e.g. counted in telemetry by another process). */
  atLeast(n: number, now = Date.now()) {
    this.roll(now);
    this.s.used = Math.max(this.s.used, n);
  }

  left(now = Date.now()): number {
    this.roll(now);
    if (this.s.aivenRefusedDay === this.s.day) return 0;
    return Math.max(0, this.perDay - this.s.used);
  }

  /** null: may start. Otherwise why not, whether a recording should play instead, and when to try again. */
  check(now = Date.now()): null | { code: "running" | "too_soon" | "day_used" | "aiven_limit"; reason: string; retryInS?: number; recording: boolean } {
    this.roll(now);
    if (this.s.running) return { code: "running", reason: "An Aiven agent is already on its way; watch it, or wait for it to finish.", recording: false };
    if (this.s.aivenRefusedDay === this.s.day) return { code: "aiven_limit", reason: "Aiven's free tier refused another run today.", recording: true };
    if (this.s.used >= this.perDay) return { code: "day_used", reason: `Today's ${this.perDay} runs are used.`, recording: true };
    if (this.s.lastStart !== null && now - this.s.lastStart < this.gapMs) {
      const retryInS = Math.ceil((this.gapMs - (now - this.s.lastStart)) / 1000);
      return { code: "too_soon", reason: `One start per ${Math.round(this.gapMs / 1000)} s; try again in ${retryInS} s.`, retryInS, recording: false };
    }
    return null;
  }

  start(runId: string, now = Date.now()) {
    this.roll(now);
    this.s.used++;
    this.s.lastStart = now;
    this.s.running = runId;
  }

  finish(runId: string) {
    if (this.s.running === runId) this.s.running = null;
  }

  aivenRefused(now = Date.now()) {
    this.s.aivenRefusedDay = utcDay(now);
  }

  state(): CapState {
    return { ...this.s };
  }
}

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

// ---------- runs ----------

export type RunMessage = { at: string; role: string; type: "user" | "assistant" | "tool_call" | "tool_return"; tool?: string; text: string };
export type Run = {
  runId: string;
  preset: PresetId;
  title: string;
  question: string;
  recorded: boolean;
  recordedAt?: string;
  status: "starting" | "running" | "done" | "failed";
  startedAt: string;
  endedAt?: string;
  sessionId?: string;
  messages: RunMessage[];
  requestId?: string;
  orderId?: string;
  outcome?: string;
  error?: string;
  /** Usage as Aiven's API reports it, when it does. */
  usage?: Record<string, number>;
  dockUrl: string;
  environment?: string;
  model: string;
};

type Store = { caps: LaunchCaps; runs: Map<string, Run>; agentId?: string; environment?: string };
const g = globalThis as typeof globalThis & { __dockShowcaseLauncher?: Store };
function store(): Store {
  const cfg = showcaseConfig();
  return (g.__dockShowcaseLauncher ??= { caps: new LaunchCaps(cfg.launchesPerDay, cfg.launchGapMs), runs: new Map() });
}

const base = () => {
  const cfg = showcaseConfig();
  return `/organization/${cfg.organization}/project/${cfg.project}/managed-agents`;
};

type ApiMessage = { created_at?: string; role?: string; message_type?: string; name?: string; content?: string; tool_call?: { name?: string; arguments?: unknown }; tool_return?: string };

/** Aiven's message objects as the cards show them: redacted, long tool answers cut, the agent's words grounded. */
export function toRunMessages(list: ApiMessage[]): RunMessage[] {
  const full: string[] = [];
  const out = list.map((m) => {
    const type: RunMessage["type"] = m.message_type === "tool_call_message" ? "tool_call" : m.message_type === "tool_return_message" ? "tool_return" : m.role === "user" ? "user" : "assistant";
    const text = type === "tool_call" ? JSON.stringify(m.tool_call?.arguments ?? {}) : type === "tool_return" ? String(m.tool_return ?? m.content ?? "") : String(m.content ?? "");
    full.push(text);
    return { at: m.created_at ?? new Date().toISOString(), role: m.role ?? "", type, tool: (m.tool_call?.name ?? m.name) || undefined, text: redact(text).slice(0, type === "tool_return" ? 700 : 2_000) };
  });
  // The agent's own words, checked against the tool answers before them (whole, not cut for the card): grounding.ts.
  return groundRunMessages(out, full);
}

/** What Dock said in the tool answers: the request, the order and how it ended. */
export function outcomeOf(messages: RunMessage[]): { requestId?: string; orderId?: string; outcome?: string } {
  let requestId: string | undefined;
  let orderId: string | undefined;
  let outcome: string | undefined;
  for (const m of messages) {
    if (m.type !== "tool_return") continue;
    requestId ??= /"requestId":"(req_[a-z0-9]+)"/.exec(m.text)?.[1];
    const o = /"orderId":"(ord_[a-z0-9]+)"/.exec(m.text)?.[1];
    if (o) orderId = o;
    const status = /"status":"(pending_approval|committed|refused|declined)"/.exec(m.text)?.[1];
    if (m.tool?.endsWith("place_order")) {
      if (status) outcome = status;
      else if (/"ok":false|"error"/.test(m.text)) outcome = `refused${/"rule":"([a-z_]+)"/.exec(m.text)?.[1] ? `: ${/"rule":"([a-z_]+)"/.exec(m.text)![1]}` : ""}`;
    }
    if (!outcome && /"ok":false/.test(m.text) && /"rule":"([a-z_]+)"/.test(m.text) && m.tool?.endsWith("place_order")) outcome = `refused: ${/"rule":"([a-z_]+)"/.exec(m.text)![1]}`;
  }
  return { requestId, orderId, outcome };
}

const needsReply = (messages: RunMessage[]) => {
  const last = messages.at(-1);
  return last?.type === "assistant" && /\?\s*$|please (let me know|confirm|choose)|which (option|one)|would you like/i.test(last.text) && !messages.some((m) => m.tool?.endsWith("place_order"));
};

async function ensureAgent(token: string): Promise<{ agentId: string; environment: string }> {
  const s = store();
  if (s.agentId && s.environment) return { agentId: s.agentId, environment: s.environment };
  const envs = await aivenApi<{ environments: { name: string; status: string }[] }>(token, "GET", `${base()}/environment`);
  const environment = envs.environments[0]?.name;
  if (!environment) throw new Error("This project has no Managed Agents environment.");
  const ints = await aivenApi<{ integrations: { integration_name: string; tools: { id: string }[] }[] }>(token, "GET", `${base()}/environment/${environment}/integration`);
  const cfg = showcaseConfig();
  if (!ints.integrations.some((i) => i.integration_name === AIVEN_BUYER.integration)) {
    await aivenApi(token, "POST", `${base()}/environment/${environment}/integration`, {
      body: { catalog_type: "custom", name: AIVEN_BUYER.integration, custom_url: `${cfg.dockUrl}/api/mcp?agent_id=${AIVEN_BUYER.agentId}`, credentials: { token: await mintMandate() }, read_only: false },
      timeoutMs: 30_000,
    });
  }
  const agents = await aivenApi<{ agents: { id: string; name: string }[] }>(token, "GET", `${base()}/agent`);
  let agent = agents.agents.find((a) => a.name === AIVEN_BUYER.agentName);
  if (!agent) {
    const fresh = await aivenApi<{ integrations: { integration_name: string; tools: { id: string }[] }[] }>(token, "GET", `${base()}/environment/${environment}/integration`);
    const tools = fresh.integrations.find((i) => i.integration_name === AIVEN_BUYER.integration)?.tools.map((t) => t.id) ?? [];
    if (!tools.length) throw new Error(`The Managed Agents integration ${AIVEN_BUYER.integration} lists no tools; is ${cfg.dockUrl}/api/mcp reachable?`);
    agent = await aivenApi<{ id: string; name: string }>(token, "POST", `${base()}/agent`, { body: { name: AIVEN_BUYER.agentName, model: AIVEN_BUYER.model, system_instructions: SYSTEM, tool_ids: tools }, timeoutMs: 30_000 });
  }
  s.agentId = agent.id;
  s.environment = environment;
  return { agentId: agent.id, environment };
}

/** A fresh, short-lived mandate for the Aiven buyer. Never leaves the server except into Aiven's credential store. */
export async function mintMandate(now = new Date()): Promise<string> {
  const m = demoMandate(now, {
    mandateId: `mnd_laakso_aiven_${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`,
    agentId: AIVEN_BUYER.agentId,
    validFrom: new Date(now.getTime() - 60_000).toISOString(),
    validUntil: new Date(now.getTime() + AIVEN_BUYER.mandateMinutes * 60_000).toISOString(),
    weeklyBudgetCents: 2_000_000, // the demo org's other agents' pending orders must not use up this buyer's week
  });
  // Never wider than the kitchen's current mandate: with what it added by reissuing it (server/mandates.ts).
  return signMandate((await getRuntime()).mandates.restrict(m), await demoOrgKeyPair());
}

export type LauncherStatus = {
  configured: boolean;
  missing: string[];
  left: number;
  perDay: number;
  gapS: number;
  running: string | null;
  blocked: ReturnType<LaunchCaps["check"]>;
  presets: typeof PRESETS;
  runs: Run[];
  dockUrl: string;
  agent: { id: string; label: string; model: string; mandateMinutes: number; org: string };
  usageNote: string;
};

export function launcherStatus(): LauncherStatus {
  const cfg = showcaseConfig();
  const s = store();
  const miss = missing(cfg, ["project", "organization", "launchToken"]);
  return {
    configured: miss.length === 0,
    missing: miss,
    left: s.caps.left(),
    perDay: cfg.launchesPerDay,
    gapS: Math.round(cfg.launchGapMs / 1000),
    running: s.caps.state().running,
    blocked: s.caps.check(),
    presets: PRESETS,
    runs: [...s.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 8),
    dockUrl: cfg.dockUrl,
    agent: { id: AIVEN_BUYER.agentId, label: AIVEN_BUYER.label, model: AIVEN_BUYER.model, mandateMinutes: AIVEN_BUYER.mandateMinutes, org: DEMO_ORG.name },
    usageNote: "Aiven's Managed Agents API reports no cost or token usage for a run (free tier, daily run limit not published); Dock counts the runs it starts.",
  };
}

export function getRun(runId: string): Run | undefined {
  return store().runs.get(runId);
}

export type RunWriter = (row: { kind: string; rule?: string; value?: number; ok?: boolean; attrs: Record<string, unknown> }) => Promise<void>;

/** Start a run, or a recording when the day's runs are used. Returns at once; the run goes on in the background. */
export async function launch(preset: PresetId, opts: { by: string; write?: RunWriter; runsToday?: () => Promise<number> } = { by: "operations" }): Promise<{ run: Run } | { refused: { code: string; reason: string; retryInS?: number } }> {
  const p = PRESETS.find((x) => x.id === preset);
  if (!p) return { refused: { code: "unknown_preset", reason: `No preset ${preset}.` } };
  const s = store();
  const cfg = showcaseConfig();
  if (opts.runsToday) s.caps.atLeast(await opts.runsToday().catch(() => 0));
  const blocked = s.caps.check();
  if (blocked && !blocked.recording) return { refused: { code: blocked.code, reason: blocked.reason, retryInS: blocked.retryInS } };
  if (blocked?.recording || missing(cfg, ["project", "organization", "launchToken"]).length) {
    const run = recordedRun(p.id, blocked?.reason ?? "The launcher is not configured on this server.");
    s.runs.set(run.runId, run);
    return { run };
  }
  const run: Run = { runId: `run_${randomUUID().slice(0, 12)}`, preset: p.id, title: p.title, question: p.message, recorded: false, status: "starting", startedAt: new Date().toISOString(), messages: [], dockUrl: cfg.dockUrl, model: AIVEN_BUYER.model };
  s.runs.set(run.runId, run);
  if (s.runs.size > 30) s.runs.delete(s.runs.keys().next().value!);
  s.caps.start(run.runId);
  void opts.write?.({ kind: "aiven_agent.run", rule: p.id, attrs: { detail: `started by ${opts.by}`, run: run.runId } }).catch(() => undefined);
  void drive(run, p.message, opts.write).finally(() => s.caps.finish(run.runId));
  return { run };
}

async function drive(run: Run, message: string, write?: RunWriter): Promise<void> {
  const cfg = showcaseConfig();
  const token = cfg.launchToken!;
  const t0 = Date.now();
  try {
    const { agentId, environment } = await ensureAgent(token);
    run.environment = environment;
    // Rotate the credential: this run's own 20-minute mandate.
    await aivenApi(token, "PUT", `${base()}/environment/${environment}/integration/${AIVEN_BUYER.integration}`, { body: { token: await mintMandate() }, timeoutMs: 30_000 });
    const session = await aivenApi<{ id: string }>(token, "POST", `${base()}/agent/${agentId}/session`, { body: {} });
    run.sessionId = session.id;
    run.status = "running";
    let text = `${message}\n\n${STANDING}`;
    for (let turn = 0; turn < 3; turn++) {
      const poll = setInterval(() => void refreshMessages(run, agentId).catch(() => undefined), 2_500);
      let reply: { messages?: ApiMessage[]; usage?: Record<string, number> };
      try {
        reply = await aivenApi(token, "POST", `${base()}/agent/${agentId}/session/${session.id}/message`, { body: { message: text, stream: false }, timeoutMs: 180_000 });
      } finally {
        clearInterval(poll);
      }
      if (reply.usage && typeof reply.usage === "object") run.usage = reply.usage;
      await refreshMessages(run, agentId);
      Object.assign(run, outcomeOf(run.messages));
      if (!needsReply(run.messages)) break;
      text = "Yes, go ahead. " + STANDING;
    }
    run.status = "done";
  } catch (err) {
    run.status = "failed";
    run.error = redact(errMessage(err));
    if (err instanceof AivenApiError && (err.status === 429 || /limit|quota|exceed/i.test(err.message))) store().caps.aivenRefused();
    log("warn", "showcase Aiven agent run failed", { runId: run.runId, error: run.error });
  } finally {
    run.endedAt = new Date().toISOString();
    void write?.({ kind: "aiven_agent.run", rule: run.preset, value: Math.round((Date.now() - t0) / 1000), ok: run.status === "done", attrs: { detail: run.outcome ?? run.error ?? run.status, run: run.runId, request_id: run.requestId, products: run.messages.filter((m) => m.type === "tool_call").length } }).catch(() => undefined);
  }
}

async function refreshMessages(run: Run, agentId: string): Promise<void> {
  const cfg = showcaseConfig();
  if (!run.sessionId) return;
  // Reading is done with the read-only token where there is one.
  const token = cfg.readToken ?? cfg.launchToken!;
  const r = await aivenApi<{ messages: ApiMessage[] }>(token, "GET", `${base()}/agent/${agentId}/session/${run.sessionId}/message`);
  run.messages = toRunMessages(r.messages ?? []);
  Object.assign(run, outcomeOf(run.messages));
}

// ---------- recordings ----------

type Recording = { recordedAt: string; preset: PresetId; question: string; model: string; messages: RunMessage[]; requestId?: string; orderId?: string; outcome?: string };

const RECORDINGS: Partial<Record<PresetId, Recording>> = { valio: valioRecording as Recording, within: withinRecording as Recording, refused: refusedRecording as Recording };

/** A recorded run, played back with its original timing by the page. Clearly marked as a recording. */
export function recordedRun(preset: PresetId, why: string): Run {
  const rec = RECORDINGS[preset] ?? RECORDINGS.valio!;
  const p = PRESETS.find((x) => x.id === rec.preset)!;
  return {
    runId: `rec_${randomUUID().slice(0, 12)}`,
    preset: rec.preset,
    title: p.title,
    question: rec.question,
    recorded: true,
    recordedAt: rec.recordedAt,
    status: "done",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    messages: groundRunMessages(rec.messages),
    requestId: rec.requestId,
    orderId: rec.orderId,
    outcome: rec.outcome,
    error: `${why} Playing a recording of a real run instead${preset !== rec.preset ? ` (no recording of "${PRESETS.find((x) => x.id === preset)?.title}" exists; this is "${p.title}")` : ""}.`,
    dockUrl: showcaseConfig().dockUrl,
    model: rec.model,
  };
}
