import type { Mandate } from "@/core/mandate";
import type { Dock } from "@/core/orders";

/**
 * The door log: every call an agent makes at the gate, with the interface it came through. Kept in the server
 * layer, in front of the core, so the ledger stays the record of decisions and this stays the record of traffic.
 *
 * Interfaces:
 *   onsite  the kitchen portal's own agent, calling Dock in-process (the console back end, the scripted buyer)
 *   mcp     an outside agent over the Model Context Protocol (/api/mcp)
 *   rest    an outside agent over the plain REST API (/api/v1)
 * All three end in the same `authenticate` and the same gate; this log only says which door they used.
 *
 * In memory, per runtime, the last MAX_CALLS calls. On several instances it belongs in shared storage.
 */
export type Via = "onsite" | "mcp" | "rest";

export type DoorCall = {
  at: string;
  agentId: string;
  orgId?: string;
  orgName?: string;
  via: Via;
  /** How the call travelled: MCP or REST for the on-site agent too; "direct" for in-process function calls. */
  transport: "mcp" | "rest" | "direct";
  path: string;
  ok: boolean;
  code?: string;
  rule?: string;
};

/** In-process callers use this host; nothing from outside reaches Dock under it. */
export const ONSITE_HOST = "dock.local";

export function interfaceOf(req: Request): { via: Via; transport: DoorCall["transport"]; path: string } {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return { via: "rest", transport: "rest", path: "?" };
  }
  const mcp = url.pathname.startsWith("/api/mcp");
  const transport = mcp ? "mcp" : "rest";
  if (url.hostname === ONSITE_HOST) return { via: "onsite", transport, path: url.pathname };
  return { via: mcp ? "mcp" : "rest", transport, path: url.pathname };
}

const MAX_CALLS = 5000;

export class DoorLog {
  private readonly calls: DoorCall[] = [];
  private readonly mandates = new Map<string, Mandate>();

  /** `mandate`: the verified mandate the agent presented, kept (latest per agent) to show what it may do. */
  record(call: DoorCall, mandate?: Mandate): void {
    if (mandate) this.mandates.set(call.agentId, structuredClone(mandate));
    this.calls.push(call);
    if (this.calls.length > MAX_CALLS) this.calls.splice(0, this.calls.length - MAX_CALLS);
  }

  all(): readonly DoorCall[] {
    return this.calls;
  }

  mandateOf(agentId: string): Mandate | undefined {
    const m = this.mandates.get(agentId);
    return m && structuredClone(m);
  }

  /** The interface an agent used for the call at (or just before) `at`: how a ledger entry came in. */
  viaAt(agentId: string, at: string): DoorCall | undefined {
    const t = Date.parse(at) + 50; // the door call is recorded a few ms before the ledger entry it leads to
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i];
      if (c.agentId === agentId && Date.parse(c.at) <= t) return c;
    }
    return undefined;
  }
}

const logs = new WeakMap<Dock, DoorLog>();

/** The door log of one runtime (a fresh runtime, as in tests, gets a fresh log). */
export function doorLog(dock: Dock): DoorLog {
  let log = logs.get(dock);
  if (!log) logs.set(dock, (log = new DoorLog()));
  return log;
}
