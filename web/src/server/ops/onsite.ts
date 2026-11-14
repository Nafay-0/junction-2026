import { isDockError } from "@/core/errors";
import type { AgentSession, Dock } from "@/core/orders";
import { doorLog } from "./door";
import { suspensions } from "./suspensions";

/**
 * The way in for doors that call Dock in-process, with no HTTP request to authenticate: the voice call, the photo
 * door, the menu planner, the buyer's answer link.
 *
 * A call over REST, MCP or the on-site console passes `authenticate` in server/http.ts, which verifies the mandate
 * and then asks the operations layer whether staff suspended the agent. A door that calls `dock.authenticate`
 * itself skips that second step, and a suspended agent could go on ordering through it. So a door that acts for an
 * agent without an HTTP request takes its session from here: the same mandate check in the core, the same
 * operations check (rule `operator_suspension`, refusal written to the ledger), the same door log.
 * `server/one-way-in.test.ts` keeps it that way.
 */

/** A session the core already verified, about to act through an in-process door. Throws the refusal if suspended. */
export function admit(dock: Dock, session: AgentSession, path: string): AgentSession {
  const call = { via: "onsite" as const, transport: "direct" as const, path };
  const record = { at: new Date().toISOString(), agentId: session.agentId, orgId: session.mandate.issuer.orgId, orgName: session.mandate.issuer.name, ...call };
  try {
    suspensions(dock).enforce(session, call);
  } catch (err) {
    if (isDockError(err)) doorLog(dock).record({ ...record, ok: false, code: err.code, rule: err.rule });
    throw err;
  }
  doorLog(dock).record({ ...record, ok: true }, session.mandate);
  return session;
}

/** Verify a kitchen agent's mandate (in the core) and admit it through an in-process door. */
export async function onsiteSession(dock: Dock, creds: { mandateToken: string; agentId: string }, path: string): Promise<AgentSession> {
  return admit(dock, await dock.authenticate(creds.mandateToken, creds.agentId), path);
}
