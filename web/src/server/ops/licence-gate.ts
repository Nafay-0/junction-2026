import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { LICENCE_LEVELS, licensedMandate, type LicenceLevel } from "@/crash/licence";
import { dockRunnerHarness } from "@/crash/harness";
import { SUITE_VERSION } from "@/crash/scenarios";
import type { AgentSession, Dock, PublicOrder } from "@/core/orders";
import { formatEur } from "@/core/util";
import { licenceSource, type LicenceRecord } from "./licences";
import { CONTROL_ENTRY } from "./suspensions";

/**
 * The crash-test licence, enforced. The licence moves where a person is asked: the gate applies the STRICTER of the
 * kitchen's own mandate and the licence the agent earned on the crash test (src/crash/licence.ts). It never lets an
 * agent buy more than its mandate allows, and it never decides for anyone: an order over the licence's limit goes to
 * the same named person who signs off orders over the mandate's limit.
 *
 * Where: the server layer in front of the core, like suspensions (./suspensions.ts) and recall holds
 * (../radar/gate.ts). The core's admission hook (./onsite.ts, run by `authenticate` for every door) hands every verified session to `apply`, which swaps in the
 * licensed mandate (per-order limit = min(mandate, licence); substitutes need sign-off below L3), so every core call
 * (intake options, quotes, the gate's rules, the re-check at sign-off) works with the same, tighter terms. `placeOrder`
 * is wrapped so that when the licence, not the mandate, is what sends an order to a person, the answer and the ledger
 * say so.
 *
 * Which licence an agent has. A crash-test result names a model and a harness (crash agent
 * `model:anthropic:claude-opus-5-5` in `dock-runner@<digest>`), never a kitchen's agent id. A licence applies to a
 * running agent only through a BINDING the wholesaler keeps on its own side:
 *
 *   DOCK_LICENCE_BINDINGS (default .data/licence-bindings.json)
 *   { "bindings": [ { "agentId": "agent_laakso_buyer_01", "orgId": "org_laakso", "crashAgent": "own",
 *                     "harness": "own", "boundBy": "ops:anna", "boundAt": "...", "note": "Dock's own buyer agent" } ] }
 *
 * The agent cannot create or change one: it controls only its own requests, and its agent id is the one its
 * organisation signed into its mandate (verified before this runs). A binding counts only when the licence it points
 * to exists, was earned on the current suite version, by the same harness, and is not older than LICENCE_MAX_AGE_DAYS.
 * `crashAgent: "own"` means Dock's own buyer agent (src/server/agent/runner.ts): the model is whatever this server
 * runs it with (DOCK_AGENT_MODEL) and the harness is the runner's current digest, both known to the server itself.
 * Any other agent, or a binding that does not check out, is treated at L0: every order needs a person.
 *
 * What a licence proves: that this model, in this harness, scored this rating on its worst of N repeats of a fixed,
 * public, reproducible suite, with the stated unsafe attempts. What it does not prove: that the agent behind an agent
 * id really runs that model and harness (a binding is the wholesaler's or the organisation's statement, not a proof;
 * Dock's own agent is the one case the server knows first-hand), or anything about situations outside the suite.
 *
 * Switch: DOCK_LICENCE_ENFORCE=on. Off by default, so the built-in demo kitchens' flows are unchanged; when off,
 * the operations portal still shows licences and nothing is enforced.
 */
export const LICENCE_RULE = "crash_licence";
export const LICENCE_MAX_AGE_DAYS = 30;

export type LicenceBinding = { agentId: string; orgId?: string; crashAgent: string; harness: string; boundBy: string; boundAt: string; note?: string };

export type AppliedLicence = {
  level: LicenceLevel["level"];
  name: string;
  /** The licence's per-order limit and the mandate's: the stricter is what the gate used. */
  licenceLimitCents: number;
  mandateLimitCents: number;
  appliedLimitCents: number;
  /** Which of the two set the limit. */
  limitFrom: "licence" | "mandate";
  substitution: { mandate: string; applied: string };
  /** Licensed through a binding that checked out, or L0 because none did (and why). */
  basis: "licensed" | "unlicensed";
  why: string;
  crashAgent?: string;
  harness?: string;
  rating?: number;
};

// ---------- bindings ----------

const g = globalThis as typeof globalThis & { __dockLicenceBindings?: { file: string; mtime: number; list: LicenceBinding[] } };

function bindingsFile(): string {
  return process.env.DOCK_LICENCE_BINDINGS?.trim() || path.join(process.cwd(), ".data", "licence-bindings.json");
}

function fileBindings(): LicenceBinding[] {
  const file = bindingsFile();
  let mtime: number;
  try {
    mtime = statSync(/*turbopackIgnore: true*/ file).mtimeMs;
  } catch {
    return [];
  }
  const hit = g.__dockLicenceBindings;
  if (hit && hit.file === file && hit.mtime === mtime) return hit.list;
  let list: LicenceBinding[] = [];
  try {
    const parsed = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as { bindings?: unknown };
    list = (Array.isArray(parsed.bindings) ? parsed.bindings : []).filter((b): b is LicenceBinding => !!b && typeof (b as LicenceBinding).agentId === "string" && typeof (b as LicenceBinding).crashAgent === "string" && typeof (b as LicenceBinding).harness === "string");
  } catch {
    // a broken file binds nobody: every agent is then treated at L0 when enforcement is on
  }
  g.__dockLicenceBindings = { file, mtime, list };
  return list;
}

/** The crash agent and harness Dock's own buyer agent runs as, from this server's own configuration. */
export function ownAgentIdentity(env: Record<string, string | undefined> = process.env): { crashAgent: string; harness: string } | undefined {
  const model = env.DOCK_AGENT_MODEL?.trim();
  return model ? { crashAgent: `model:${model}`, harness: dockRunnerHarness().id } : undefined;
}

export type Resolution = { record: LicenceRecord; binding: LicenceBinding; crashAgent: string; harness: string } | { record?: undefined; why: string };

/**
 * The licence a running agent holds, or why it holds none. `records` looks a licence up by crash agent name
 * (the licences file written by `pnpm crash:export`).
 */
export function resolveLicence(
  session: { agentId: string; orgId: string },
  opts: { bindings?: LicenceBinding[]; records?: (crashAgent: string) => LicenceRecord | undefined; now?: Date; env?: Record<string, string | undefined> } = {},
): Resolution {
  const bindings = opts.bindings ?? fileBindings();
  const records = opts.records ?? ((name: string) => licenceSource().get(name));
  const now = opts.now ?? new Date();
  const b = bindings.find((x) => x.agentId === session.agentId && (!x.orgId || x.orgId === session.orgId));
  if (!b) return { why: `no crash-test licence is bound to agent ${session.agentId}` };
  let crashAgent = b.crashAgent;
  let harness = b.harness;
  if (crashAgent === "own") {
    const own = ownAgentIdentity(opts.env);
    if (!own) return { why: "bound as Dock's own agent, but DOCK_AGENT_MODEL is not set on this server" };
    ({ crashAgent } = own);
    harness = harness === "own" ? own.harness : harness;
  }
  const record = records(crashAgent);
  if (!record || record.crashAgent !== crashAgent) return { why: `bound to ${crashAgent}, which has no crash-test licence` };
  if (record.suite && record.suite !== SUITE_VERSION) return { why: `the licence of ${crashAgent} was earned on suite ${record.suite}, not the current ${SUITE_VERSION}` };
  if (!record.harness || record.harness !== harness) return { why: `the licence of ${crashAgent} was earned in harness ${record.harness ?? "(unknown)"}, but this agent runs in ${harness}` };
  const rated = record.ratedAt ? Date.parse(record.ratedAt) : NaN;
  if (!Number.isFinite(rated) || now.getTime() - rated > LICENCE_MAX_AGE_DAYS * 86_400_000) return { why: `the licence of ${crashAgent} is older than ${LICENCE_MAX_AGE_DAYS} days (rated ${record.ratedAt ?? "at an unknown time"})` };
  if (!LICENCE_LEVELS.some((l) => l.level === record.level)) return { why: `unknown licence level ${record.level}` };
  return { record, binding: b, crashAgent, harness };
}

// ---------- the gate ----------

export class LicenceGate {
  /** By the licensed mandate object, which a door keeps when it copies the session to add its own fields. */
  private readonly applied = new WeakMap<object, AppliedLicence>();
  private enforced: boolean | undefined;

  constructor(
    private readonly dock: Dock,
    private readonly resolve: (s: { agentId: string; orgId: string }) => Resolution = (s) => resolveLicence(s),
  ) {
    const placeOrder = dock.placeOrder;
    dock.placeOrder = async (session, input) => {
      const order = await placeOrder(session, input);
      const lic = this.applied.get(session.mandate);
      return lic ? this.annotate(session, order, lic) : order;
    };
  }

  /** DOCK_LICENCE_ENFORCE=on|true|1, unless set in code (tests, an operator switch). */
  get enabled(): boolean {
    return this.enforced ?? /^(1|on|true|yes)$/i.test(process.env.DOCK_LICENCE_ENFORCE?.trim() ?? "");
  }

  setEnforced(on: boolean | undefined): void {
    this.enforced = on;
  }

  /** What the gate would apply to this session (also when enforcement is off, for display). */
  assess(session: AgentSession): AppliedLicence {
    const m = session.mandate;
    const r = this.resolve({ agentId: session.agentId, orgId: m.issuer.orgId });
    const level = LICENCE_LEVELS.find((l) => l.level === (r.record?.level ?? "L0"))!;
    const capped = licensedMandate(m, level);
    const fromLicence = level.perOrderLimitCents < m.perOrderLimitCents;
    return {
      level: level.level,
      name: level.name,
      licenceLimitCents: level.perOrderLimitCents,
      mandateLimitCents: m.perOrderLimitCents,
      appliedLimitCents: capped.perOrderLimitCents,
      limitFrom: fromLicence ? "licence" : "mandate",
      substitution: { mandate: m.substitution.rule, applied: capped.substitution.rule },
      ...(r.record
        ? { basis: "licensed" as const, why: `crash-test licence ${level.level} ${level.name} of ${r.crashAgent} in ${r.harness}${r.record.rating !== undefined ? `, rating ${r.record.rating} on its worst repeat` : ""} (bound by ${r.binding.boundBy})`, crashAgent: r.crashAgent, harness: r.harness, rating: r.record.rating }
        : { basis: "unlicensed" as const, why: `${r.why}: treated as L0 Learner, every order needs a person` }),
    };
  }

  /** Called by admission (ops/onsite.ts) for every verified session, on every door. Returns the session the core should see. */
  apply(session: AgentSession): AgentSession {
    if (!this.enabled) return session;
    const lic = this.assess(session);
    const level = LICENCE_LEVELS.find((l) => l.level === lic.level)!;
    const licensed: AgentSession = { ...session, mandate: licensedMandate(session.mandate, level) };
    this.applied.set(licensed.mandate, lic);
    return licensed;
  }

  /** The licence applied to a session `apply` returned, if any. */
  of(session: AgentSession): AppliedLicence | undefined {
    return this.applied.get(session.mandate);
  }

  private annotate(session: AgentSession, order: PublicOrder, lic: AppliedLicence): PublicOrder & { licence: AppliedLicence & { decisive: boolean } } {
    const total = order.totalCents;
    // The licence decided where a person is asked when the order is over the licence's limit but within the mandate's.
    const decisive = lic.limitFrom === "licence" && order.status !== "rejected" && total > lic.appliedLimitCents && total <= lic.mandateLimitCents;
    const substitutionTightened = lic.substitution.applied !== lic.substitution.mandate;
    const note = `Limit applied: ${formatEur(lic.appliedLimitCents)} per order from the ${lic.limitFrom === "licence" ? `crash-test licence (${lic.level} ${lic.name})` : "kitchen's mandate"}; the mandate allows ${formatEur(lic.mandateLimitCents)}, the licence ${formatEur(lic.licenceLimitCents)}. ${lic.basis === "licensed" ? `Licence: ${lic.why}.` : `No licence: ${lic.why}.`}`;
    if (decisive || substitutionTightened) {
      this.dock.ledger.append({
        type: CONTROL_ENTRY,
        actor: "dock",
        requestId: order.requestId,
        orderId: order.orderId,
        summary: decisive
          ? `${formatEur(total)} order ${order.orderId} goes to a person because of the agent's crash-test licence, not its mandate. ${note}`
          : `Order ${order.orderId} placed under the agent's crash-test licence (substitutes ${lic.substitution.applied}). ${note}`,
        data: { action: "licence_applied", rule: LICENCE_RULE, agentId: session.agentId, orgId: session.mandate.issuer.orgId, decisive, totalCents: total, ...lic },
      });
    }
    const decision = order.decision && decisive ? { ...order.decision, reasons: order.decision.reasons.map((r) => (/per-order limit/.test(r) ? `${r} ${note}` : r)) } : order.decision;
    return { ...order, decision, licence: { ...lic, decisive } };
  }
}

// Process-wide (see ops/suspensions.ts): one gate per Dock, so placeOrder is wrapped once whichever bundle asks.
const sharedGates = globalThis as typeof globalThis & { __dockLicenceGates?: WeakMap<Dock, LicenceGate> };
const gates = (sharedGates.__dockLicenceGates ??= new WeakMap<Dock, LicenceGate>());

/** The licence gate of one runtime (created on first use; it wraps placeOrder once). */
export function licenceGate(dock: Dock): LicenceGate {
  let gate = gates.get(dock);
  if (!gate) gates.set(dock, (gate = new LicenceGate(dock)));
  return gate;
}

