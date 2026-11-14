import { DockError, isDockError } from "@/core/errors";
import type { AgentSession } from "@/core/orders";
import type { ApproverAccount } from "@/core/passkeys";
import { currentApprover } from "./approver-session";
import { currentAccount, requireSameOrigin } from "./accounts/http";
import { consoleSession, type ConsoleContext } from "./console-context";
import { resolveKitchen } from "./console-kitchens";
import { authenticate } from "./http";
import { currentOps, type OpsSession } from "./ops/access";
import type { Runtime } from "./runtime";
import type { SandboxSummary } from "./sandboxes";

/**
 * Who may read and do what. Every route that hands out a kitchen's data or acts for a kitchen asks here.
 *
 *   a kitchen's data and actions   that kitchen's mandate (its agent); for an account's kitchen the account's own
 *                                  signed-in session (server/accounts); for a visitor's sandbox kitchen the
 *                                  visitor's own session (the passkey-backed approver cookie of that kitchen)
 *   what approvers see             an approver's session for their own kitchen (pending sign-offs, the sign-off
 *                                  screen, their kitchen's events); the one-time link token for its one approval
 *   the wholesaler's views         the operations session (every kitchen's ledger, sign-offs and events)
 *   the public wall                an aggregated feed: counts and anonymous event pings, no private detail
 *   the built-in demo kitchens     accounts like any other (passwords from the environment): closed to strangers,
 *                                  so nobody can spend their budget or stack sign-offs before a pitch
 *
 * The ledger's integrity (verification and head) is public: anyone can check the chain, no one sees entries
 * that are not theirs.
 */


export type Principal = {
  ops?: OpsSession;
  /** A signed-in restaurant account: the organisation of its kitchen (a built-in demo kitchen's, for kaari and laakso). */
  account?: { username: string; orgId?: string };
  approver?: { account: ApproverAccount; sandbox?: SandboxSummary };
  agent?: AgentSession;
};

/** Everything the request proves. A mandate is checked only when one is presented (a bad one is refused, 401/403). */
export async function principalOf(req: Request, rt: Runtime): Promise<Principal> {
  const p: Principal = {};
  p.ops = currentOps(req);
  p.approver = await currentApprover(req, rt);
  const signedIn = await currentAccount(req, rt);
  if (signedIn) p.account = { username: signedIn.account.username, orgId: rt.accounts.view(signedIn.account).orgId };
  if (req.headers.get("authorization")) p.agent = await authenticate(req, rt.dock);
  return p;
}

/** The organisations whose private data this principal may read. `all` for the operations session. */
export function orgsOf(p: Principal): { all: boolean; orgs: Set<string> } {
  const orgs = new Set<string>();
  if (p.approver) orgs.add(p.approver.account.orgId);
  if (p.account?.orgId) orgs.add(p.account.orgId);
  if (p.agent) orgs.add(p.agent.mandate.issuer.orgId);
  return { all: !!p.ops, orgs };
}

export function canRead(p: Principal, orgId: string): boolean {
  const s = orgsOf(p);
  return s.all || s.orgs.has(orgId);
}

export function requireSomeone(p: Principal, what: string): void {
  if (!p.ops && !p.approver && !p.agent && !p.account) {
    throw new DockError(401, "not_signed_in", `${what} is only for the kitchen's own agent (its mandate), its signed-in account, its approver (signed-in phone) or the wholesaler's operations desk.`, "data_access");
  }
}

/**
 * A kitchen console's back end (/ui-api/kitchens/{kitchen}/...): the kitchen, with the browser's console session.
 * An account's kitchen, and each stage kitchen (kaari, laakso), only its signed-in account (or operations). A visitor's
 * sandbox kitchen only from the phone/browser that joined it (or operations).
 * Undefined when the kitchen does not exist; throws 401/403 when it does but the caller may not act for it.
 */
export async function consoleKitchen(req: Request, rt: Runtime, slug: string) {
  const k = await resolveKitchen(slug);
  if (!k) return undefined;
  const session = consoleSession(req);
  const console: ConsoleContext = { kitchen: slug, session: session.id };
  if (k.info.kind === "account" || k.info.kind === "demo") {
    // A restaurant's own kitchen, and the two stage kitchens alike (their accounts' passwords come from the
    // environment): only the kitchen's signed-in account, or the operations desk, which sees every kitchen.
    const owner = k.info.kind === "account" ? k.info.account?.username : slug;
    const signedIn = await currentAccount(req, rt);
    const ops = currentOps(req);
    const mine = !!signedIn && signedIn.account.username === owner;
    if (!mine && !ops) {
      throw signedIn
        ? new DockError(403, "not_your_kitchen", "This is another restaurant's kitchen. You are signed in to a different account.", "data_access")
        : new DockError(401, "not_signed_in", "This kitchen belongs to an account. Sign in to it at /k.", "data_access");
    }
    if (mine && signedIn) {
      requireSameOrigin(req, { json: false });
      console.person = { channel: "portal_session", name: `${signedIn.account.restaurant} (${signedIn.account.username})`, account: signedIn.account.username, ...(signedIn.session.scope === "call" ? { callOnly: true as const } : {}) };
    }
  } else if (k.info.kind === "visitor") {
    requireSameOrigin(req, { json: false });
    const me = await currentApprover(req, rt);
    const ops = currentOps(req);
    if (!me && !ops) throw new DockError(401, "not_signed_in", "This is a visitor's own kitchen. Open it on the phone that joined it.", "data_access");
    if (!ops && me?.account.orgId !== k.info.orgId) throw new DockError(403, "not_your_kitchen", "This is another visitor's kitchen; it can only be used from the phone that joined it.", "data_access");
    // The visitor is the person behind this kitchen: answers given here are theirs, by a passkey-backed session.
    if (me && me.account.orgId === k.info.orgId) console.person = { channel: "portal_session", name: me.account.name, approverId: me.account.approverId };
  }
  return { ...k, console, setCookie: session.setCookie };
}

/**
 * Changing what a kitchen remembers (forgetting or correcting a rule, stating one, sharing it, adding it to the
 * mandate) is the kitchen's own call: it needs the kitchen's signed-in account (a stage kitchen's too), or a
 * visitor's own phone for their kitchen. A relayed name or the operations desk can read memory, never change it.
 */
export function requireKitchenPerson(k: { info: { kind: string; name: string }; console?: ConsoleContext }, what = "Changing this kitchen's rules"): void {
  if (k.console?.person && !k.console.person.callOnly) return;
  throw new DockError(
    401,
    "kitchen_person_required",
    k.info.kind === "visitor"
      ? `${what} needs the kitchen's own signed-in person: open it on the phone that joined it.`
      : k.info.kind === "account"
        ? `${what} needs ${k.info.name}'s own signed-in account. Sign in to it at /k.`
        : `${what} needs ${k.info.name}'s own signed-in account. Sign in to it at /k.`,
    "data_access",
  );
}

/**
 * The ledger entries this principal may read: operations all of them; anyone else the entries of their own
 * organisations' requests and orders (and refusals of their own agent). Strangers none.
 */
export async function readableEntries<E extends { requestId?: string; orderId?: string; actor: string }>(rt: Runtime, p: Principal, entries: readonly E[]): Promise<E[]> {
  const { all, orgs } = orgsOf(p);
  if (all) return [...entries];
  if (orgs.size === 0) return [];
  const orderOrg = new Map<string, string | undefined>();
  const requestOrg = new Map<string, string | undefined>();
  const out: E[] = [];
  for (const e of entries) {
    let org: string | undefined;
    if (e.requestId) {
      if (!requestOrg.has(e.requestId)) requestOrg.set(e.requestId, await rt.dock.orgOfRequest(e.requestId));
      org = requestOrg.get(e.requestId);
    } else if (e.orderId) {
      if (!orderOrg.has(e.orderId)) orderOrg.set(e.orderId, await rt.dock.orgOfOrder(e.orderId));
      org = orderOrg.get(e.orderId);
    }
    else if (p.agent && e.actor === `agent:${p.agent.agentId}`) org = p.agent.mandate.issuer.orgId;
    if (org && orgs.has(org)) out.push(e);
  }
  return out;
}

/** Error JSON for a refused console call, the same shape as every other refusal. */
export function refusalResponse(err: unknown): Response | undefined {
  if (!isDockError(err)) return undefined;
  return Response.json({ error: { code: err.code, rule: err.rule, message: err.message, details: err.details } }, { status: err.status });
}
