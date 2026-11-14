import type { LedgerEntry } from "@/core/ledger";
import { currentAccount } from "../accounts/http";
import type { Runtime } from "../runtime";
import { opsContext } from "./context";

/**
 * Looking without operating: anyone may open the operations portal and read it, with the same data staff see and the
 * same privacy rule (a kitchen's private memory named, never shown). What a viewer does not see is other people's
 * words: for a kitchen someone opened for themselves (an own account, a visitor's sandbox kitchen), the words of its
 * conversations and the buyer's own words wherever a view quotes them are replaced by WORDS_HIDDEN. The built-in
 * stage kitchens, the shared test kitchens and the sample activity are shown in full; so is the viewer's own
 * kitchen when the same browser is signed in to it. Staff with the passcode see everything.
 */
export const WORDS_HIDDEN = "the buyer's words are shown to staff only";
const HIDDEN = `[${WORDS_HIDDEN}]`;

export type ViewerScope = {
  /** Organisations whose words this viewer may not read. */
  privateOrgs: Set<string>;
  /** The words to hide, longest first: requests, conversation turns. */
  texts: string[];
  /** The viewer's own kitchen, when this browser is signed in to one. */
  ownOrg?: string;
};

type Cache = { n: number; byOrg: Map<string, string[]>; privateOrgs: string[]; at: number };
const g = globalThis as typeof globalThis & { __dockViewerTexts?: Cache };

/** Kitchens someone opened for themselves: an own account's, a visitor's sandbox. */
async function personalOrgs(rt: Runtime): Promise<string[]> {
  const out: string[] = [];
  for (const a of await rt.accounts.list()) if (a.kind === "own" && a.orgId) out.push(a.orgId);
  for (const s of await rt.sandboxes.list()) out.push(s.orgId);
  return out;
}

/** The words each personal kitchen's buyers said, from the ledger (requests, conversation turns), by organisation. */
async function wordsByOrg(rt: Runtime): Promise<Cache> {
  const entries = rt.dock.ledger.readonly();
  const c = g.__dockViewerTexts;
  if (c && c.n === entries.length && Date.now() - c.at < 30_000) return c;
  const orgs = await personalOrgs(rt);
  const set = new Set(orgs);
  const byOrg = new Map<string, string[]>();
  if (set.size) {
    const ctx = await opsContext(rt);
    // Who each request and agent belongs to: from the orders, then the agents the desk knows.
    const reqOrg = new Map<string, string>();
    const agentOrg = new Map<string, string>();
    for (const o of ctx.orders) {
      reqOrg.set(o.requestId, o.orgId);
      agentOrg.set(o.agentId, o.orgId);
    }
    for (const a of ctx.agents.values()) if (!agentOrg.has(a.agentId)) agentOrg.set(a.agentId, a.orgId);
    for (const a of await rt.accounts.list()) if (a.orgId && a.kitchen) agentOrg.set(`agent_${a.kitchen.replace(/-/g, "_")}_buyer`, a.orgId);
    const orgOfAgent = (agentId: string) => agentOrg.get(agentId);
    const add = (org: string | undefined, text: unknown) => {
      if (!org || !set.has(org) || typeof text !== "string" || !text.trim()) return;
      const l = byOrg.get(org) ?? [];
      l.push(text.trim());
      byOrg.set(org, l);
    };
    for (const e of entries as readonly LedgerEntry[]) {
      const agent = e.actor.startsWith("agent:") ? e.actor.slice(6) : undefined;
      const org = (e.requestId && reqOrg.get(e.requestId)) || (agent && orgOfAgent(agent)) || undefined;
      if (e.type === "request") add(org, e.data.text);
      else if (e.type === "agent" && e.data.event === "turn") add(org, e.data.words);
      else if (e.type === "agent" && e.data.event === "memory_write" && typeof e.data.text === "string") add(org, e.data.text);
    }
  }
  const out: Cache = { n: entries.length, byOrg, privateOrgs: orgs, at: Date.now() };
  g.__dockViewerTexts = out;
  return out;
}

/** What this viewer may not read. */
export async function viewerScope(rt: Runtime, req: Request): Promise<ViewerScope> {
  const signedIn = await currentAccount(req, rt).catch(() => undefined);
  const ownOrg = signedIn ? rt.accounts.view(signedIn.account).orgId : undefined;
  const c = await wordsByOrg(rt);
  const privateOrgs = new Set(c.privateOrgs.filter((o) => o !== ownOrg));
  const texts = [...new Set([...c.byOrg.entries()].filter(([o]) => privateOrgs.has(o)).flatMap(([, t]) => t))].sort((a, b) => b.length - a.length);
  return { privateOrgs, texts, ...(ownOrg ? { ownOrg } : {}) };
}

/** Replace other people's words in any JSON a view returns. Short words are hidden only where they stand alone. */
export function scrubWords<T>(value: T, scope: ViewerScope): T {
  if (!scope.texts.length) return value;
  const long = scope.texts.filter((t) => t.length >= 6);
  const exact = new Set(scope.texts);
  const fix = (s: string): string => {
    if (exact.has(s.trim()) || exact.has(s.replace(/^[“"]|[”"]$/g, "").trim())) return HIDDEN;
    let out = s;
    for (const t of long) if (out.includes(t)) out = out.split(t).join(HIDDEN);
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return fix(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
