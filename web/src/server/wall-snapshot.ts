import type { LedgerEntry } from "@/core/ledger";
import { amount, eur, humanize, ruleTitle } from "@/app/_ui/plain";
import { KITCHEN_ORG } from "./demo-kitchen";
import { DEMO_ORG } from "./dev-fixtures";
import { BROWSE_TEXT } from "./portal-requests";
import type { Runtime } from "./runtime";
import { isSampleRequest, setOfEntry } from "./alive/marks";

/**
 * What the wall shows, read from the ledger, the orders and the catalogue meter of this server.
 * The public v1 API has no cross-kitchen activity view (and should not hand every org's orders to anyone),
 * so the wall reads the runtime directly and sends only plain sentences and counts.
 */
export type FeedItem = {
  key: string;
  kitchen: string;
  what: string;
  /** 1 asked, 2 checked and priced, 3 price fixed, 4 at the gate, 5 signed (or a final refusal/decline). */
  reached: number;
  status: string;
  tone: "plain" | "safety" | "done";
  totalCents?: number;
  /** The door the request came through when it was an outside agent's (mcp, connector, rest); absent for the store's own doors. */
  door?: "mcp" | "connector" | "rest";
  at: string;
  /** Played by the sample activity (server/alive): the wall shows the same small "sample" mark. */
  sample?: boolean;
};

export type RefusalItem = { key: string; kitchen: string; rule: string; reason: string; at: string; sample?: boolean };

export type WallSnapshot = {
  at: string;
  counters: { orders: number; agentAlone: number; humanSignedOff: number; refused: number; liveCalls: number; waiting: number };
  chain: { ok: boolean; length: number };
  feed: FeedItem[];
  refusals: RefusalItem[];
  kitchens: { slug: string; name: string; approverName: string }[];
  lastActivityAt?: string;
  /** Which catalogue answers: the partner's real one, or the small built-in seed. */
  catalogue: { kind: "valio"; products: number } | { kind: "seed" };
};

// Product names for sentences that carry product codes. Looked up once per id from master data (local, not metered).
const g = globalThis as typeof globalThis & { __dockWallNames?: Map<string, string>; __dockWallState?: WeakMap<object, WallState> };
const NAMES = (g.__dockWallNames ??= new Map<string, string>());
let say = (t: string) => humanize(t);

async function learnNames(rt: Runtime, entries: readonly LedgerEntry[]): Promise<void> {
  const ids = new Set<string>();
  for (const e of entries) {
    const d = e.data as { productIds?: unknown; lines?: unknown; resultIds?: unknown };
    for (const id of Array.isArray(d.productIds) ? d.productIds : []) if (typeof id === "string") ids.add(id);
    for (const l of Array.isArray(d.lines) ? d.lines : []) if (l && typeof (l as { productId?: unknown }).productId === "string") ids.add((l as { productId: string }).productId);
  }
  const unknown = [...ids].filter((id) => !NAMES.has(id)).slice(0, 100);
  if (unknown.length) {
    try {
      for (const p of await rt.catalog.searchProducts({ ids: unknown, limit: 100 })) NAMES.set(p.id, p.name);
    } catch {
      // names are a nicety; ids stay as they are
    }
  }
  const names = Object.fromEntries(NAMES);
  say = (t: string) => humanize(t, names);
}

/**
 * What the wall keeps between polls, per Dock: the ledger is read once, entry by entry, as it grows (never again
 * from the start), so a poll costs the entries added since the last one plus the few rows on screen.
 *   activity   request ids by their latest entry, most recent last (bounded): the feed's candidates
 *   refusals   the latest refusals, with the count of all of them
 *   committed  orders committed (one ledger "order" entry each), and how many a person signed
 */
type WallState = {
  seen: number;
  activity: Map<string, true>;
  refusals: (Omit<RefusalItem, "reason"> & { reason: string })[];
  refused: number;
  committed: number;
  signed: number;
  cached?: { key: string; at: number; snap: WallSnapshot };
};
const WALL_STATE = (g.__dockWallState ??= new WeakMap<object, WallState>());
const ACTIVITY_MAX = 400;
const REFUSALS_KEPT = 20;
/** A poll within this long of the last, with nothing new in the ledger, gets the last snapshot again. */
const CACHE_MS = 1_000;

const browsing = (list: readonly LedgerEntry[]) => {
  const first = list.find((e) => e.type === "request");
  return !first || first.data.text === BROWSE_TEXT ? undefined : first;
};

export async function wallSnapshot(rt: Runtime): Promise<WallSnapshot> {
  const { dock, sandboxes } = rt;
  let st = WALL_STATE.get(dock);
  if (!st) WALL_STATE.set(dock, (st = { seen: 0, activity: new Map(), refusals: [], refused: 0, committed: 0, signed: 0 }));
  const length = dock.ledger.length;
  const kitchens = await sandboxes.list();
  const key = `${length}|${kitchens.length}|${dock.stats().liveCalls}`;
  if (st.cached && st.cached.key === key && Date.now() - st.cached.at < CACHE_MS) return { ...st.cached.snap, at: new Date().toISOString() };

  const now = new Date();
  const agentOrg = new Map<string, string>([
    [KITCHEN_ORG.agentId, KITCHEN_ORG.name],
    [DEMO_ORG.agentId, DEMO_ORG.name],
    ...kitchens.map((k) => [k.agentId, `${k.kitchenName}, ${k.city}`] as [string, string]),
  ]);
  // The organisation a request belongs to, as its opening entry names it ("Agent x of <org> opened a request").
  const kitchenOf = (requestId: string | undefined, actor: string): string => {
    if (requestId) {
      const req = dock.ledger.readonly({ requestId }).find((e) => e.type === "request");
      const m = req && / of (.+?) opened a request/.exec(req.summary);
      if (m) return m[1];
    }
    return agentOrg.get(actor.replace(/^agent:/, "")) ?? "An unknown agent";
  };

  const fresh = dock.ledger.since(st.seen - 1);
  for (const e of fresh) {
    if (e.requestId) {
      st.activity.delete(e.requestId);
      st.activity.set(e.requestId, true);
      if (st.activity.size > ACTIVITY_MAX) st.activity.delete(st.activity.keys().next().value!);
    }
    if (e.type === "order") {
      st.committed++;
      if ((e.data.authorisedBy as { kind?: string } | undefined)?.kind === "approver") st.signed++;
    } else if (e.type === "refusal") {
      st.refused++;
      const rule = typeof e.data.rule === "string" ? e.data.rule : undefined;
      st.refusals.push({ key: `r${e.seq}`, kitchen: kitchenOf(e.requestId, e.actor), rule: ruleTitle(rule), reason: e.summary.replace(/^Refused: /, ""), at: e.at, ...(setOfEntry(dock.ledger, e) ? { sample: true } : {}) });
    } else if (e.type === "decision" && e.data.outcome === "reject") {
      st.refused++;
      const rules = (e.data.rules as { rule: string; outcome: string }[] | undefined) ?? [];
      const failed = rules.find((r) => r.outcome === "fail");
      const reasons = (e.data.reasons as string[] | undefined) ?? [];
      st.refusals.push({ key: `r${e.seq}`, kitchen: kitchenOf(e.requestId, e.actor), rule: ruleTitle(failed?.rule), reason: reasons[0] ?? e.summary, at: e.at, ...(setOfEntry(dock.ledger, e) ? { sample: true } : {}) });
    }
    if (st.refusals.length > REFUSALS_KEPT * 2) st.refusals.splice(0, st.refusals.length - REFUSALS_KEPT);
  }
  st.seen = length;

  // The feed: the requests with the latest activity (a portal's catalogue browsing is not a purchase request).
  const lists: { requestId: string; list: readonly LedgerEntry[]; first: LedgerEntry }[] = [];
  const recent = [...st.activity.keys()];
  for (let i = recent.length - 1; i >= 0 && lists.length < 8; i--) {
    const list = dock.ledger.readonly({ requestId: recent[i] });
    const first = browsing(list);
    if (first) lists.push({ requestId: recent[i], list, first });
  }
  await learnNames(rt, [...lists.flatMap((x) => x.list), ...fresh.slice(-300)]);
  const outside = (list: readonly LedgerEntry[]) => {
    const d = list.find((e) => e.type === "request")?.data.door;
    return d === "mcp" || d === "connector" || d === "rest" ? { door: d as "mcp" | "connector" | "rest" } : {};
  };
  const feed: FeedItem[] = lists.map(({ requestId, list, first }) => ({ key: requestId, kitchen: kitchenOf(requestId, first.actor), ...progress(list, now), ...outside(list), at: list.at(-1)!.at, ...(isSampleRequest(dock.ledger, requestId) ? { sample: true } : {}) }));
  feed.sort((a, b) => b.at.localeCompare(a.at));
  const refusals = st.refusals
    .slice(-REFUSALS_KEPT)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 4)
    .map((r) => ({ ...r, reason: say(r.reason) }));

  const chain = dock.ledger.verify();
  const waiting = await dock.pendingCount();
  const snap: WallSnapshot = {
    at: new Date().toISOString(),
    counters: {
      orders: st.committed,
      agentAlone: st.committed - st.signed,
      humanSignedOff: st.signed,
      refused: st.refused,
      liveCalls: dock.stats().liveCalls,
      waiting,
    },
    chain: { ok: chain.ok, length },
    feed,
    refusals,
    kitchens: kitchens
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((k) => ({ slug: k.sandboxId, name: `${k.kitchenName}, ${k.city}`, approverName: k.approverName })),
    lastActivityAt: dock.ledger.since(length - 2)[0]?.at,
    catalogue: rt.catalogSource.kind === "valio" ? { kind: "valio", products: rt.catalogSource.products } : { kind: "seed" },
  };
  st.cached = { key, at: Date.now(), snap };
  return { ...snap };
}

/** Where one request is, in a few words. Reads its ledger entries in order; the last word wins. */
export function progress(list: readonly LedgerEntry[], now = new Date()): Pick<FeedItem, "what" | "reached" | "status" | "tone" | "totalCents"> {
  const request = list.find((e) => e.type === "request")!;
  let what = String(request.data.text ?? "").trim();
  let reached = 1;
  let status = "Reading the request";
  let tone: FeedItem["tone"] = "plain";
  let totalCents: number | undefined;
  /** When the last quote's fixed price runs out, while nothing has been decided on it. */
  let priceUntil: string | undefined;

  for (const e of list) {
    if (e.type === "decision" || e.type === "order" || e.type === "refusal") priceUntil = undefined;
    const d = e.data;
    if (e.type === "intake") {
      const step = d.step;
      if (step === "need") {
        const need = d.need as { item?: { text?: string }; quantity?: { amount: number; unit: string }; sameAsLastTime?: boolean } | undefined;
        if (need?.item?.text) what = need.quantity ? `${amount(need.quantity.amount, need.quantity.unit)} ${need.item.text}` : `${need.item.text}, same as last time`;
        status = "Reading the request";
      } else if (step === "concerns") [reached, status] = [2, "Checking a possible mistake"];
      else if (step === "questions") [reached, status] = [2, "Asking the kitchen one question"];
      else if (step === "confirmation" || step === "correction") [reached, status] = [2, "Kitchen corrected the request"];
      else if (step === "options") [reached, status] = [2, `Comparing ${(d.options as unknown[] | undefined)?.length ?? "the"} options`];
      else if (step === "no_options") [reached, status, tone] = [2, "Nothing fits the rules", "plain"];
      else if (step === "cancelled") [reached, status, tone] = [2, "Cancelled by the kitchen", "plain"];
      else if (step === "choice") [reached, status] = [2, "Option chosen"];
    } else if (e.type === "lookup" && d.source === "live") [reached, status] = [Math.max(reached, 2), "Checking live prices"];
    else if (e.type === "quote") {
      totalCents = d.totalCents as number;
      priceUntil = typeof d.expiresAt === "string" ? d.expiresAt : undefined;
      [reached, status] = [3, `Price fixed at ${eur(totalCents)}`];
    } else if (e.type === "decision") {
      totalCents = d.totalCents as number;
      const approver = d.approver as { name: string; role: string } | undefined;
      if (d.outcome === "auto_approve") [reached, status, tone] = [4, "Within the agent's mandate", "plain"];
      else if (d.outcome === "needs_human_approval") [reached, status, tone] = [4, `Waiting for ${approver?.name ?? "a person"}`, "safety"];
      else {
        const failed = (d.rules as { rule: string; outcome: string }[] | undefined)?.find((r) => r.outcome === "fail");
        [reached, status, tone] = [4, `Refused: ${ruleTitle(failed?.rule).toLowerCase()}`, "safety"];
      }
    } else if (e.type === "approval") {
      const name = /^(.+?) \(/.exec(e.summary)?.[1] ?? "The approver";
      if (d.decision === "approved") [reached, status, tone] = [4, `Signed off by ${name}`, "safety"];
      else [reached, status, tone] = [5, `Declined by ${name}`, "safety"];
    } else if (e.type === "order") {
      const by = d.authorisedBy as { kind: string; name?: string } | undefined;
      [reached, status, tone] = [5, by?.kind === "approver" ? `Signed order, approved by ${by.name}` : "Signed order, agent alone", "done"];
    } else if (e.type === "refusal") {
      const rule = typeof d.rule === "string" ? d.rule : undefined;
      [reached, status, tone] = [Math.max(reached, 3), `Refused: ${ruleTitle(rule).toLowerCase()}`, "safety"];
    }
  }
  // A fixed price nobody ordered on stops holding when it runs out: the row says so instead of "Price fixed" forever.
  if (priceUntil && reached === 3 && Date.parse(priceUntil) <= now.getTime()) [status, tone] = ["Price ran out; not ordered", "plain"];
  if (what.length > 80) what = `${what.slice(0, 77).trimEnd()}…`;
  return { what: say(what), reached, status: say(status), tone, totalCents };
}
