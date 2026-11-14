import { isDockError } from "@/core/errors";
import type { AgentSession, Dock } from "@/core/orders";
import { doorLog, type DoorCall } from "./door";
import { licenceGate } from "./licence-gate";
import { SUSPENSION_RULE, suspensions } from "./suspensions";

/**
 * Admission: the operations layer's check on every agent session, run by the core itself.
 *
 * The core calls `admission` from `authenticate`, right after a mandate verified and before a session exists
 * (core/orders.ts DockDeps.admit; wired in server/runtime.ts). So a door cannot verify a mandate and forget to
 * ask whether staff suspended the agent: REST, MCP, the on-site console, the voice call, the photo door, the menu
 * planner and the scripted buyer all get their session from the same function, and a suspended agent gets none.
 * A refusal carries the rule `operator_suspension` and is written to the ledger (ops/suspensions.ts). The same
 * step applies the agent's crash-test licence when that is enforced (ops/licence-gate.ts): no session without it.
 *
 * What a caller passes as the entrance only says where the call came from, for the door log and the refusal's
 * record. One entrance is let through while suspended, and it has to say so: STORE_PAGE_READ, the kitchen's own
 * people reading their records in the store, whose pages show the suspension instead of failing. Nothing is
 * opened, quoted or ordered with it: those calls go through the agent's HTTP door, which is refused.
 */
export type Entrance = Pick<DoorCall, "via" | "transport" | "path"> & { method?: string; readOnly?: true };

const IN_PROCESS: Entrance = { via: "onsite", transport: "direct", path: "in-process" };

/** The kitchen's own people reading their records in the store (never the agent acting). */
export const STORE_PAGE_READ: Entrance = { via: "onsite", transport: "direct", path: "store page (read only)", readOnly: true };

const isEntrance = (e: unknown): e is Entrance => typeof e === "object" && e !== null && typeof (e as Entrance).path === "string" && typeof (e as Entrance).via === "string";

/** The function the runtime hands to createDock as `admit`. `dock` is read when a call arrives. */
export function admission(dock: () => Dock): (session: AgentSession, entrance?: unknown) => AgentSession | undefined {
  return (session, given) => {
    const entrance = isEntrance(given) ? given : IN_PROCESS;
    if (entrance.readOnly) return undefined;
    const d = dock();
    const { via, transport, path } = entrance;
    const record = { at: new Date().toISOString(), agentId: session.agentId, orgId: session.mandate.issuer.orgId, orgName: session.mandate.issuer.name, via, transport, path };
    try {
      suspensions(d).enforce(session, { via, path, method: entrance.method });
    } catch (err) {
      if (isDockError(err)) doorLog(d).record({ ...record, ok: false, code: err.code, rule: err.rule });
      throw err;
    }
    doorLog(d).record({ ...record, ok: true }, session.mandate);
    // The crash-test licence (DOCK_LICENCE_ENFORCE=on, ops/licence-gate.ts): the core sees the stricter of the
    // mandate and the licence. Applied here, not in one door's code, so it binds on every door like the suspension.
    return licenceGate(d).apply(session);
  };
}

/** True for the refusal admission throws: the door log already has it. */
export const isAdmissionRefusal = (err: unknown): boolean => isDockError(err) && err.rule === SUSPENSION_RULE;

/** A kitchen agent's session for a door that calls Dock in-process, named for the door log. */
export function onsiteSession(dock: Dock, creds: { mandateToken: string; agentId: string }, path: string): Promise<AgentSession> {
  return dock.authenticate(creds.mandateToken, creds.agentId, { via: "onsite", transport: "direct", path } satisfies Entrance);
}

/** Admission again for a session verified earlier and used later (the buyer's answer link). */
export function admit(dock: Dock, session: AgentSession, path: string): Promise<AgentSession> {
  return dock.admit(session, { via: "onsite", transport: "direct", path } satisfies Entrance);
}
