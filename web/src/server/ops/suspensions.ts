import type { LedgerEntryType } from "@/core/ledger";
import { DockError, type AgentSession, type Dock } from "@/core/orders";
import { newId } from "@/core/util";
import { clock } from "@/app/_ui/plain";
import type { RecordStore } from "../records";
import type { Via } from "./door";

/**
 * Suspension: the wholesaler's operations staff stop an agent, or every agent of an organisation, at the door.
 * It lives in the server layer in front of the core: `authenticate` (src/server/http.ts) asks `enforce` after the
 * mandate verified and before any core function runs, so a suspended agent cannot search, look up live prices,
 * quote, order or even read its mandate, over REST, MCP or the on-site console alike. Its next call is refused
 * with the named rule `operator_suspension`, and the refusal is written to the ledger like every other.
 *
 * Every suspension and resumption is a ledger entry of its own (type "control"), so the audit trail shows who
 * stopped which agent, when and why. Orders already waiting for a customer's sign-off are left to the customer:
 * operations can stop an agent, never decide for a kitchen.
 *
 * Suspensions outlive a restart: the runtime hands the registry a store (`restore`, server/records.ts: in memory
 * by default, PostgreSQL with DOCK_STORE=postgres), every suspension and resumption is written to it, and a new
 * process takes over the ones in force. The registry itself is per process; several instances would each need to
 * re-read the store, which this does not do.
 */
export const SUSPENSION_RULE = "operator_suspension";

/** Suspensions and resumptions go into the same hash chain as every other entry, as type "control" (core/ledger.ts). */
export const CONTROL_ENTRY = "control" satisfies LedgerEntryType;

export type SuspensionScope = "agent" | "org";

export type Suspension = {
  suspensionId: string;
  scope: SuspensionScope;
  /** agentId or orgId */
  target: string;
  /** "Kaari's buyer agent", "Ravintola Kaari": what staff saw when they pressed the button. */
  label: string;
  reason: string;
  by: string;
  at: string;
  resumedAt?: string;
  resumedBy?: string;
  resumeNote?: string;
  /** Calls refused while it was in force. */
  refusals: number;
  lastRefusalAt?: string;
};

/** A suspended agent's repeated call (a page polling its order) is written to the ledger at most this often. */
export const SUSPENSION_LOG_EVERY_MS = 60_000;

export class SuspensionRegistry {
  private readonly items: Suspension[] = [];
  /** When each (suspension, method, call) was last written to the ledger. */
  private readonly logged = new Map<string, number>();
  private store?: RecordStore<Suspension>;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly dock: Dock,
    private readonly now: () => Date = () => new Date(),
  ) {}

  all(): Suspension[] {
    return structuredClone(this.items);
  }

  /**
   * Keep suspensions in a store that outlives the process, and take over the ones it already holds: after a
   * restart, an agent that was suspended still is. Returns how many are in force.
   */
  async restore(store: RecordStore<Suspension>): Promise<number> {
    this.store = store;
    for (const s of await store.list()) if (!this.items.some((x) => x.suspensionId === s.suspensionId)) this.items.push(s);
    this.items.sort((a, b) => a.at.localeCompare(b.at));
    return this.active().length;
  }

  /** Resolves when every suspension and resumption so far is in the store. */
  saved(): Promise<void> {
    return this.writes;
  }

  private persist(s: Suspension): void {
    const store = this.store;
    if (!store) return;
    const copy = structuredClone(s);
    this.writes = this.writes.then(() => store.put(copy.suspensionId, copy)).catch((err) => console.error("suspension not saved", copy.suspensionId, err));
  }

  active(): Suspension[] {
    return this.all().filter((s) => !s.resumedAt);
  }

  /** The suspension in force for this agent, if any: its own, or its organisation's. */
  find(agentId: string, orgId: string): Suspension | undefined {
    return this.items.find((s) => !s.resumedAt && ((s.scope === "agent" && s.target === agentId) || (s.scope === "org" && s.target === orgId)));
  }

  suspend(input: { scope: SuspensionScope; target: string; label: string; reason: string; by: string; orgId?: string }): Suspension {
    const reason = input.reason.trim();
    if (!reason) throw new DockError(400, "reason_required", "Say why: the reason is shown to the agent and written to the ledger.");
    if (!input.target.trim()) throw new DockError(400, "target_required", "Name the agent or organisation to suspend.");
    const existing = this.items.find((s) => !s.resumedAt && s.scope === input.scope && s.target === input.target);
    if (existing) throw new DockError(409, "already_suspended", `${existing.label} is already suspended since ${clock(existing.at)}.`);
    const s: Suspension = {
      suspensionId: newId("sus"),
      scope: input.scope,
      target: input.target,
      label: input.label,
      reason,
      by: input.by,
      at: this.now().toISOString(),
      refusals: 0,
    };
    this.items.push(s);
    this.persist(s);
    const what = input.scope === "agent" ? `agent ${input.target} (${input.label})` : `every agent of ${input.label} (${input.target})`;
    this.dock.ledger.append({
      type: CONTROL_ENTRY,
      actor: `operator:${input.by}`,
      summary: `Operations staff (${input.by}) suspended ${what}: "${reason}". Its next call is refused until it is resumed.`,
      data: { action: "suspend", suspensionId: s.suspensionId, scope: s.scope, target: s.target, label: s.label, orgId: input.orgId, reason, by: input.by },
    });
    return structuredClone(s);
  }

  resume(suspensionId: string, input: { by: string; note?: string }): Suspension {
    const s = this.items.find((x) => x.suspensionId === suspensionId);
    if (!s) throw new DockError(404, "suspension_not_found", `No suspension ${suspensionId}.`);
    if (s.resumedAt) throw new DockError(409, "already_resumed", `${s.label} was already resumed at ${clock(s.resumedAt)}.`);
    s.resumedAt = this.now().toISOString();
    s.resumedBy = input.by;
    s.resumeNote = input.note?.trim() || undefined;
    this.persist(s);
    this.dock.ledger.append({
      type: CONTROL_ENTRY,
      actor: `operator:${input.by}`,
      summary: `Operations staff (${input.by}) resumed ${s.scope === "agent" ? `agent ${s.target} (${s.label})` : `the agents of ${s.label} (${s.target})`}${s.resumeNote ? `: "${s.resumeNote}"` : ""}. It was suspended for ${s.refusals} refused call${s.refusals === 1 ? "" : "s"}.`,
      data: { action: "resume", suspensionId: s.suspensionId, scope: s.scope, target: s.target, label: s.label, note: s.resumeNote, by: input.by, refusals: s.refusals },
    });
    return structuredClone(s);
  }

  /**
   * Called for every agent call after its mandate verified. Throws the refusal (and writes it to the ledger) when
   * the agent or its organisation is suspended.
   */
  enforce(session: AgentSession, call: { via: Via; path: string; method?: string }): void {
    const s = this.find(session.agentId, session.mandate.issuer.orgId);
    if (!s) return;
    s.refusals += 1;
    const at = this.now();
    s.lastRefusalAt = at.toISOString();
    const whom = s.scope === "agent" ? "this agent" : `every agent of ${session.mandate.issuer.name}`;
    const err = new DockError(
      403,
      s.scope === "agent" ? "agent_suspended" : "organisation_suspended",
      `The wholesaler's operations staff suspended ${whom} at ${clock(s.at)} Helsinki time: "${s.reason}". No lookups, quotes or orders until they resume it.`,
      SUSPENSION_RULE,
      { suspensionId: s.suspensionId, scope: s.scope, since: s.at },
    );
    // A page left open polls every few seconds: the first refusal of each call is written, then at most one a
    // minute per call, so the ledger and the wall show that the agent was stopped, not every poll it made.
    // `refusals` still counts every call.
    const key = `${s.suspensionId} ${call.method ?? ""} ${call.path.replace(/\/(req|ord|apr|quo)_[a-z0-9]+/gi, "/$1_*")}`;
    const last = this.logged.get(key);
    if (last === undefined || at.getTime() - last >= SUSPENSION_LOG_EVERY_MS) {
      this.logged.set(key, at.getTime());
      this.persist(s); // the refusal count, as often as the ledger line
      this.dock.ledger.append({
        type: "refusal",
        actor: `agent:${session.agentId}`,
        summary: `Refused: ${err.message}`,
        data: { code: err.code, rule: err.rule, status: err.status, suspensionId: s.suspensionId, orgId: session.mandate.issuer.orgId, via: call.via, path: call.path, refusalsSoFar: s.refusals },
      });
    }
    throw err;
  }
}

// Process-wide, not per module copy: Next.js loads server modules once per bundle (pages and route handlers are
// separate graphs), and the runtime's admission hook is built by whichever bundle came first. A WeakMap that lived
// in this module would give the operations route one registry and the hook another: staff would suspend an agent
// in one, and the gate would ask the other. (Found by `pnpm demo:all` on a production build; the unit tests, which
// load each module once, cannot see it.)
const shared = globalThis as typeof globalThis & { __dockSuspensions?: WeakMap<Dock, SuspensionRegistry> };
const registries = (shared.__dockSuspensions ??= new WeakMap<Dock, SuspensionRegistry>());

/** The suspension registry of one runtime. */
export function suspensions(dock: Dock): SuspensionRegistry {
  let r = registries.get(dock);
  if (!r) registries.set(dock, (r = new SuspensionRegistry(dock)));
  return r;
}
