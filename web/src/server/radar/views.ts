import type { PublicOrder } from "@/core/orders";
import type { Runtime } from "../runtime";
import { assortmentOf } from "./assortment";
import { listingTarget } from "./readers";
import { deliveryAffected, describeLots } from "./match";
import { publisherOf, radar, type RadarRegistry } from "./registry";
import { BUDGET, RECENT_ORDER_DAYS, REGULAR_ORDER_MIN, SOURCES, sourceOf } from "./sources";
import type { Evidence, Hold, Match, Notice } from "./types";

/**
 * What the two screens read: the operations page /ops/radar, and the notice a kitchen sees in its own shop. Plain
 * words on the surface, the original sentences and links one tap away.
 */

const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);

export type NoticeCard = {
  noticeId: string;
  sourceId: string;
  sourceName: string;
  publisher: string;
  drill: boolean;
  url: string;
  title: string;
  language: string;
  publishedOn?: string;
  seenAt: string;
  readAt?: string;
  readBy?: string;
  state: Notice["state"];
  readError?: string;
  hazard?: { kind: string; allergens: string[]; text?: Evidence };
  products: { name: Evidence; brand?: string; producer?: string; pack?: string; eans: string[]; lots?: string }[];
  producer?: Evidence;
  consumerAction?: Evidence;
  businessAction?: Evidence;
  lots?: string;
  eans: string[];
  summaryEnglish?: string;
  corroboration: Notice["corroboration"];
  sameAs: { noticeId: string; language: string; url: string; title: string }[];
  feed?: Notice["feed"];
  matches: (Match & { productName: string })[];
};

export type AffectedOrder = { orderId: string; orgName: string; status: string; totalCents: number; deliveryDate?: string; approvalId?: string; approverName?: string; affected: boolean; why: string };

export type HoldCard = Hold & { notice?: { title: string; url: string; publishedOn?: string; drill: boolean }; orders: AffectedOrder[]; kitchensTold: number };

export type RadarView = {
  at: string;
  today: string;
  partners: { contextDev: boolean; exa: boolean; gtinMatching: boolean; catalogue: string; products: number; drillReadVia: "context.dev" | "direct"; drillUrl: string };
  sources: {
    id: string;
    name: string;
    publisher: string;
    kind: string;
    language: string;
    homeUrl: string;
    about: string;
    independent: boolean;
    drill: boolean;
    status: string;
    lastCheckAt?: string;
    lastOkAt?: string;
    nextCheckAt?: string;
    lastError?: string;
    listed?: number;
    noticesRead: number;
    monitor?: { monitorId: string; lastRunAt?: string; nextRunAt?: string; lastChangeAt?: string; status?: string; everyMinutes: number };
    checkEveryMinutes: number;
  }[];
  spend: RadarRegistry["state"]["spend"] & { budget: { contextDevCredits: number; exaDollars: number } };
  stats: { window: string; real: number; read: number; matchedAny: number; confirmed: number; possible: number; holds: number; review: number; bySource: Record<string, { read: number; matched: number }> };
  notices: NoticeCard[];
  review: (Match & { notice: { title: string; url: string; publisher: string; publishedOn?: string; drill: boolean } })[];
  holds: HoldCard[];
  lifted: Hold[];
  drill: {
    active: (RadarRegistry["state"]["drills"][number] & { url: string; secondsToPickUp?: number; secondsToHold?: number; secondsToRefusal?: number })[];
    past: RadarRegistry["state"]["drills"];
    candidates: { productId: string; name: string; why: string }[];
  };
};

function card(r: RadarRegistry, n: Notice): NoticeCard {
  const f = n.facts;
  const source = sourceOf(n.sourceId);
  return {
    noticeId: n.noticeId,
    sourceId: n.sourceId,
    sourceName: source?.name ?? n.sourceId,
    publisher: publisherOf(n),
    drill: n.drill,
    url: n.url,
    title: n.title,
    language: n.language,
    publishedOn: n.publishedOn,
    seenAt: n.seenAt,
    readAt: n.readAt,
    readBy: n.readBy,
    state: n.state,
    readError: n.readError,
    ...(f
      ? {
          hazard: f.hazard,
          products: f.products.map((p) => ({ name: p.name, brand: p.brand?.value, producer: p.producer?.value, pack: p.pack?.value, eans: p.eans, lots: describeLots(p.lots) })),
          producer: f.producer,
          consumerAction: f.consumerAction,
          businessAction: f.businessAction,
          lots: describeLots(f.lots),
          eans: f.eans,
          summaryEnglish: f.summaryEnglish,
        }
      : { products: [], eans: [] }),
    corroboration: n.corroboration,
    sameAs: n.sameAs.map((id) => r.store.notice(id)).filter((x): x is Notice => !!x).map((x) => ({ noticeId: x.noticeId, language: x.language, url: x.url, title: x.title })),
    feed: n.feed,
    matches: r.state.matches.filter((m) => m.noticeId === n.noticeId),
  };
}

function ordersFor(productId: string, orders: PublicOrder[], lots: Match["lots"], today: string): AffectedOrder[] {
  const out: AffectedOrder[] = [];
  for (const o of orders) {
    const lines = o.lines.filter((l) => l.productId === productId);
    if (!lines.length) continue;
    const deliveryDate = lines.map((l) => l.deliveryDate).sort().pop();
    if (o.status === "pending_approval") {
      out.push({ orderId: o.orderId, orgName: o.orgName, status: "waiting for sign-off", totalCents: o.totalCents, deliveryDate, approvalId: o.approval?.approvalId, approverName: o.approval?.approver.name, affected: true, why: "Waiting for sign-off: its approver sees the notice and cannot approve it while the hold is in force." });
    } else if (o.status === "committed" && deliveryDate && daysBetween(deliveryDate, today) <= RECENT_ORDER_DAYS) {
      const affected = deliveryAffected(lots, deliveryDate);
      out.push({ orderId: o.orderId, orgName: o.orgName, status: "delivered or on its way", totalCents: o.totalCents, deliveryDate, affected, why: affected ? "Bought recently: the kitchen is told what the authority says to do." : "Delivered after every affected best-before date: it cannot contain an affected pack." });
    }
  }
  return out;
}

export async function radarView(rt: Runtime, now = new Date()): Promise<RadarView> {
  const r = radar(rt);
  const s = r.state;
  const today = day(now);
  const a = await assortmentOf(rt);
  const orders = await rt.dock.listOrders();
  const real = s.notices.filter((n) => !n.drill);
  const windowStart = new Date(now.getTime() - sourceOf("ruokavirasto-fi")!.readWindowDays * 86400_000);
  const matchedIds = new Set(s.matches.filter((m) => !m.drill).map((m) => m.noticeId));
  const bySource: RadarView["stats"]["bySource"] = {};
  for (const n of real.filter((x) => x.state === "read")) {
    const b = (bySource[n.sourceId] ??= { read: 0, matched: 0 });
    b.read += 1;
    if (matchedIds.has(n.noticeId)) b.matched += 1;
  }
  const drillSource = sourceOf("drill")!;
  const target = listingTarget(drillSource, r.deps);
  const sinceS = (from?: string, to?: string) => (from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 1000) : undefined);
  const notice = (id: string) => r.store.notice(id);
  const candidates = await drillCandidates(rt, orders);
  return {
    at: now.toISOString(),
    today,
    partners: { contextDev: r.deps.cd.configured, exa: r.deps.exa.configured, gtinMatching: a.gtins, catalogue: a.source, products: a.items.length, drillReadVia: target.via, drillUrl: target.url },
    sources: SOURCES.map((src) => {
      const st = s.sources[src.id];
      return {
        id: src.id,
        name: src.name,
        publisher: src.publisher,
        kind: src.kind,
        language: src.language,
        homeUrl: src.drill ? target.url : src.homeUrl,
        about: src.about,
        independent: src.independent,
        drill: !!src.drill,
        status: st.status,
        lastCheckAt: st.lastCheckAt,
        lastOkAt: st.lastOkAt,
        nextCheckAt: st.lastCheckAt ? new Date(Date.parse(st.lastCheckAt) + src.checkEveryMinutes * 60_000).toISOString() : undefined,
        lastError: st.lastError,
        listed: st.listedLastTime,
        noticesRead: st.noticesRead,
        ...(st.monitor ? { monitor: { monitorId: st.monitor.monitorId, lastRunAt: st.monitor.lastRunAt, nextRunAt: st.monitor.nextRunAt, lastChangeAt: st.monitor.lastChangeAt, status: st.monitor.lastRunStatus, everyMinutes: src.monitor!.everyMinutes } } : {}),
        checkEveryMinutes: src.checkEveryMinutes,
      };
    }),
    spend: { ...s.spend, budget: { contextDevCredits: BUDGET.contextDevCreditsPerProcess, exaDollars: BUDGET.exaDollarsPerProcess } },
    stats: {
      window: windowStart.toISOString().slice(0, 10),
      real: real.length,
      read: real.filter((n) => n.state === "read").length,
      matchedAny: matchedIds.size,
      confirmed: s.matches.filter((m) => !m.drill && m.strength === "confirmed").length,
      possible: s.matches.filter((m) => !m.drill && m.strength === "possible").length,
      holds: s.holds.filter((h) => !h.liftedAt && !h.drill).length,
      review: s.matches.filter((m) => m.status === "review").length,
      bySource,
    },
    notices: [...s.notices].sort((x, y) => (y.publishedOn ?? y.seenAt).localeCompare(x.publishedOn ?? x.seenAt) || y.seenAt.localeCompare(x.seenAt)).slice(0, 150).map((n) => card(r, n)),
    review: s.matches
      .filter((m) => m.status === "review")
      .map((m) => {
        const n = notice(m.noticeId)!;
        return { ...m, notice: { title: n.title, url: n.url, publisher: publisherOf(n), publishedOn: n.publishedOn, drill: n.drill } };
      }),
    holds: s.holds
      .filter((h) => !h.liftedAt)
      .map((h) => {
        const n = notice(h.noticeId);
        const m = s.matches.find((x) => x.matchId === h.matchId);
        const affected = ordersFor(h.productId, orders, m?.lots ?? { bestBefore: [], batches: [], marks: [] }, today);
        return { ...h, notice: n && { title: n.title, url: n.url, publishedOn: n.publishedOn, drill: n.drill }, orders: affected, kitchensTold: new Set(affected.filter((o) => o.affected).map((o) => o.orgName)).size };
      }),
    lifted: s.holds.filter((h) => h.liftedAt).slice(-20).reverse(),
    drill: {
      active: s.drills
        .filter((d) => !d.withdrawnAt)
        .map((d) => ({ ...d, url: `${target.url}/${d.slug}`, secondsToPickUp: sinceS(d.publishedAt, d.pickedUpAt), secondsToHold: sinceS(d.publishedAt, d.heldAt), secondsToRefusal: sinceS(d.publishedAt, d.firstRefusalAt) })),
      past: s.drills.filter((d) => d.withdrawnAt).slice(-5).reverse(),
      candidates,
    },
  };
}

/** Products worth a drill: what a demo kitchen is about to order (an open quote), is waiting on, or regularly orders. */
async function drillCandidates(rt: Runtime, orders: PublicOrder[]): Promise<RadarView["drill"]["candidates"]> {
  const out = new Map<string, { productId: string; name: string; why: string }>();
  const ledger = rt.dock.ledger.readonly();
  const ordered = new Set(orders.map((o) => o.quoteId));
  for (const e of [...ledger].reverse()) {
    if (e.type !== "quote") continue;
    const d = e.data as { quoteId?: string; expiresAt?: string; lines?: { productId: string }[] };
    if (!d.quoteId || ordered.has(d.quoteId) || (d.expiresAt && Date.parse(d.expiresAt) < Date.now())) continue;
    for (const l of d.lines ?? []) if (!out.has(l.productId)) out.set(l.productId, { productId: l.productId, name: l.productId, why: "in an open quote: about to be ordered" });
  }
  for (const o of orders.filter((x) => x.status === "pending_approval")) for (const l of o.lines) if (!out.has(l.productId)) out.set(l.productId, { productId: l.productId, name: l.name, why: `in ${o.orgName}'s order waiting for sign-off` });
  for (const orgId of ["org_ravintola_kaari"]) {
    const profile = await rt.kitchens.getProfile(orgId).catch(() => undefined);
    const counts = new Map<string, { n: number; name: string }>();
    for (const h of profile?.history ?? []) for (const l of h.lines) counts.set(l.productId, { n: (counts.get(l.productId)?.n ?? 0) + 1, name: l.name });
    for (const [id, c] of [...counts].sort((x, y) => y[1].n - x[1].n).slice(0, 4)) if (!out.has(id)) out.set(id, { productId: id, name: c.name, why: `Ravintola Kaari orders it regularly (${c.n} times)` });
  }
  const a = await assortmentOf(rt);
  return [...out.values()].slice(0, 8).map((c) => ({ ...c, name: a.byId.get(c.productId) ? (a.byId.get(c.productId)!.names.en ?? c.name) : c.name }));
}

// ---------- the kitchen's notice ----------

export type KitchenNotice = {
  noticeId: string;
  drill: boolean;
  title: string;
  publisher: string;
  publishedOn?: string;
  url: string;
  language: string;
  productId: string;
  productName: string;
  relation: "ordering" | "waiting" | "received" | "regular";
  relationText: string;
  held: boolean;
  hazard?: Evidence;
  hazardKind?: string;
  allergens: string[];
  action?: Evidence;
  businessAction?: Evidence;
  lots?: string;
  otherLanguage?: { language: string; url: string };
};

/** Notices that concern what this kitchen ordered, is ordering or regularly orders. */
export async function kitchenNotices(rt: Runtime, k: { orgId: string; agentId: string }, now = new Date()): Promise<KitchenNotice[]> {
  const r = radar(rt);
  const s = r.state;
  const today = day(now);
  const live = s.matches.filter((m) => m.status === "confirmed" || m.status === "confirmed_by_staff");
  if (!live.length) return [];
  const orders = await rt.dock.listOrders({ orgId: k.orgId });
  const profile = await rt.kitchens.getProfile(k.orgId).catch(() => undefined);
  const ledger = rt.dock.ledger.readonly();
  const myRequests = new Set(ledger.filter((e) => e.type === "request" && e.actor === `agent:${k.agentId}`).map((e) => e.requestId));
  const ordered = new Set(orders.map((o) => o.quoteId));
  const quoted = new Set<string>();
  for (const e of ledger) {
    if (e.type !== "quote" || !myRequests.has(e.requestId)) continue;
    const d = e.data as { quoteId?: string; expiresAt?: string; lines?: { productId: string }[] };
    if (d.quoteId && !ordered.has(d.quoteId) && !(d.expiresAt && Date.parse(d.expiresAt) < now.getTime())) for (const l of d.lines ?? []) quoted.add(l.productId);
  }
  const out: KitchenNotice[] = [];
  for (const m of live) {
    const n = r.store.notice(m.noticeId);
    if (!n?.facts) continue;
    const held = s.holds.some((h) => h.matchId === m.matchId && !h.liftedAt);
    // Staff lifted its hold (a drill ended, or the stock was checked): nothing more to tell the kitchen.
    if (m.holdId && !held) continue;
    const mine = orders.filter((o) => o.lines.some((l) => l.productId === m.productId));
    const waiting = mine.find((o) => o.status === "pending_approval");
    const received = mine.find((o) => {
      if (o.status !== "committed") return false;
      const d = o.lines.filter((l) => l.productId === m.productId).map((l) => l.deliveryDate).sort().pop();
      return !!d && daysBetween(d, today) <= RECENT_ORDER_DAYS && deliveryAffected(m.lots, d);
    });
    const historyHits = (profile?.history ?? []).filter((h) => h.lines.some((l) => l.productId === m.productId) && deliveryAffected(m.lots, h.deliveryDate));
    const regular = (profile?.history ?? []).filter((h) => h.lines.some((l) => l.productId === m.productId)).length >= REGULAR_ORDER_MIN;
    let relation: KitchenNotice["relation"] | undefined;
    let relationText = "";
    if (quoted.has(m.productId) && held) [relation, relationText] = ["ordering", "You are about to order it: the order will not go through while the wholesaler holds it."];
    else if (waiting) [relation, relationText] = ["waiting", `It is in your order waiting for ${waiting.approval?.approver.name ?? "sign-off"}: it cannot be approved while the wholesaler holds it.`];
    else if (received || historyHits.some((h) => daysBetween(h.deliveryDate, today) <= RECENT_ORDER_DAYS)) [relation, relationText] = ["received", "You received it recently. Check your stock against the notice."];
    else if (regular && held) [relation, relationText] = ["regular", "You order it regularly: your agent will offer an alternative while it is held."];
    if (!relation) continue;
    const pair = n.sameAs.map((id) => r.store.notice(id)).find((x) => x && x.language !== n.language);
    out.push({
      noticeId: n.noticeId,
      drill: n.drill,
      title: n.title,
      publisher: publisherOf(n),
      publishedOn: n.publishedOn,
      url: n.url,
      language: n.language,
      productId: m.productId,
      productName: m.productName,
      relation,
      relationText,
      held,
      hazard: n.facts.hazard.text,
      hazardKind: n.facts.hazard.kind,
      allergens: n.facts.hazard.allergens,
      action: n.facts.businessAction ?? n.facts.consumerAction,
      businessAction: n.facts.businessAction,
      lots: describeLots(m.lots),
      ...(pair ? { otherLanguage: { language: pair.language, url: pair.url } } : {}),
    });
  }
  const order = { ordering: 0, waiting: 1, received: 2, regular: 3 };
  return out.sort((x, y) => order[x.relation] - order[y.relation]);
}

/** What an approver sees about one waiting order: the holds on its products, with the notice. */
export function approvalRecallFlags(rt: Pick<Runtime, "dock" | "catalog">, productIds: string[]): { productId: string; productName: string; drill: boolean; reason: string; noticeUrl: string; noticeTitle: string; publisher: string }[] {
  return radar(rt)
    .store.activeHolds(productIds)
    .map((h) => ({ productId: h.productId, productName: h.productName, drill: h.drill, reason: h.reason, noticeUrl: h.noticeUrl, noticeTitle: h.noticeTitle, publisher: h.publisher }));
}
