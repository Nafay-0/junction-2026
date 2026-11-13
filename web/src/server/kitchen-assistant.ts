import type { Product } from "@/core/catalog";
import { DockError } from "@/core/errors";
import { askAssistant, type AssistantRecord } from "./agent/assistant";
import { categoryIdOf, categoryLabel } from "./kitchen-catalog";
import { liveCheck, overview, type Kitchen, type PortalOrder } from "./kitchen-portal";
import { getRuntime } from "./runtime";
import { catalogBrands } from "./grounding";
import { addDaysIso, localNow } from "@/core/kitchen";

/**
 * Retrieval for the shop assistant, in plain code: the product on screen, products the question names, the
 * partner's substitutes, the kitchen's orders and memory and its mandate. Each becomes a record with an id the
 * answer must cite. Static data only, except one live check for the one product a price or stock question is
 * about.
 */

export type AskBody = { question: string; productId?: string; orderId?: string; screen?: string; history?: { q: string; a: string }[] };
export type Citation = { id: string; kind: AssistantRecord["kind"]; label: string; productId?: string; orderId?: string };
export type AskReply = {
  kind: "answer" | "order_request" | "out_of_scope" | "no_model";
  answer: string;
  citations: Citation[];
  dataMissing: boolean;
  model?: string;
  ms?: number;
  liveCalls: number;
  looked: { products: number; orders: number; memory: number };
};

const LIVE_WORDS = /\b(price|prices|cost|costs|cheap|expensive|euro|€|stock|in stock|available|availability|deliver|delivery|cut-?off|order by|when can|hinta|maksaa|saatavilla|varasto|toimitus|pris|kostar|lager|leverans)\b/i;
const ALT_WORDS = /\b(alternative|alternatives|instead|substitute|replace|similar|other|korvaava|korvaa|vaihtoehto|ersätt|alternativ|istället)\b/i;
const THIS_WORDS = /\b(this|it|that one|tämä|tätä|se|sitä|den|det|denna)\b/i;
const CLAIM_WORDS: [RegExp, string][] = [
  [/lactose|laktoos|laktos/i, "lactose_free"],
  [/gluten|gluteen/i, "gluten_free"],
  [/vegan|vegaan/i, "vegan"],
  [/organic|luomu|ekologisk/i, "organic"],
];

const short = (p: Product) => (p.names?.en ?? p.name).replace(/[®™]/g, "").slice(0, 90);

function productRecord(p: Product): AssistantRecord {
  const a = p.allergenInfo;
  return {
    id: `product:${p.id}`,
    kind: "product",
    label: short(p),
    data: {
      code: p.id,
      name: p.names?.en ?? p.name,
      nameFi: p.names?.fi,
      nameSv: p.names?.sv,
      brand: p.brand,
      supplier: p.vendor ?? null,
      category: categoryLabel(p),
      soldPer: p.salesUnit ?? p.unit,
      packContent: p.packContent ? { ...p.packContent.perSalesUnit, pieces: p.packContent.baseUnitsPerSalesUnit, certain: p.packContent.certain } : { [p.unit]: p.packSize },
      countryOfOrigin: p.countryOfOrigin ?? "no data",
      storage: p.temperatureClass ?? "no data",
      dietaryClaims: p.attributes,
      allergens: a ? (a.declared ? { contains: a.contains, mayContain: a.mayContain, statedFreeFrom: a.freeFrom } : "no allergen data from the manufacturer: unknown") : { contains: p.allergens },
      labels: p.certificates,
      deliveredInFullShare: p.deliveryReliabilityKnown === false ? "no data" : p.deliveryReliability,
      carbonKgCo2ePerKgGroupAverage: p.carbonGroupAvgKgCo2ePerKg ?? "no data",
      partnerListedSubstitutes: p.substitutes ?? [],
    },
  };
}

function orderRecord(o: PortalOrder, text: string | null): AssistantRecord {
  const a = o.authorised;
  return {
    id: `order:${o.orderId}`,
    kind: "order",
    label: `${o.status === "history" ? "Order from the kitchen's history" : "Order"} of ${o.createdAt.slice(0, 10)}`,
    data: {
      placed: o.createdAt,
      delivery: o.deliveryDate,
      buyerAsked: text,
      lines: o.lines.map((l) => `${l.quantity} x ${l.name}`),
      totalEur: o.totalCents / 100,
      status: o.status === "history" ? "delivered (history before the agent)" : o.status,
      authorisedBy: a.by === "agent" ? "the agent alone, within the mandate" : a.by === "person" ? `${a.name} (${a.role}) by ${a.method ?? "sign-off"}` : a.by === "waiting" ? `waiting for ${a.name} (${a.role})` : a.by === "before_dock" ? "before the agent" : "nobody: not ordered",
      whyAPersonOrRefused: o.reasons,
    },
  };
}

export async function ask(k: Kitchen, body: AskBody): Promise<AskReply> {
  const rt = await getRuntime();
  const question = body.question.trim().slice(0, 600);
  if (!question) throw new DockError(400, "invalid_request", "Ask a question.");
  const records: AssistantRecord[] = [];
  const add = (r: AssistantRecord) => {
    if (!records.some((x) => x.id === r.id)) records.push(r);
  };

  // Products: the one on screen, the ones the question names, and alternatives when asked for.
  const [focus] = body.productId ? await rt.catalog.searchProducts({ ids: [body.productId], limit: 1 }) : [];
  if (focus) add(productRecord(focus));
  let named: Product[] = [];
  if (!focus || !THIS_WORDS.test(question)) named = await rt.catalog.searchProducts({ text: question, limit: 5 });
  for (const p of named) add(productRecord(p));
  if (focus && ALT_WORDS.test(question)) {
    const subs = focus.substitutes?.length ? await rt.catalog.searchProducts({ ids: focus.substitutes.slice(0, 5), limit: 5 }) : [];
    const claims = CLAIM_WORDS.filter(([re]) => re.test(question)).map(([, c]) => c);
    const same = await rt.catalog.searchProducts({ category: categoryIdOf(focus), attributes: claims.length ? claims : undefined, limit: 6 });
    for (const p of [...subs, ...same].filter((p) => p.id !== focus.id).slice(0, 8)) add(productRecord(p));
  }

  // The kitchen's own records: orders, memory, mandate.
  const o = await overview(k);
  const texts = new Map(o.requests.map((r) => [r.order?.orderId ?? r.key, r.text]));
  const onScreen = body.orderId ? o.orders.find((x) => x.orderId === body.orderId) : undefined;
  if (onScreen) add(orderRecord(onScreen, texts.get(onScreen.orderId) ?? null));
  for (const x of o.orders.slice(0, 12)) add(orderRecord(x, texts.get(x.orderId) ?? null));
  for (const s of o.memory.stated) add({ id: `memory:${s.id}`, kind: "memory", label: `Rule stated by ${s.statedBy}`, data: { rule: s.text, statedBy: s.statedBy, statedAt: s.statedAt, constrains: "always applied: the agent offers nothing against it" } });
  for (const f of o.memory.families) {
    add({ id: `memory:usual:${f.family}`, kind: "memory", label: `Usual ${f.family} order`, data: { family: f.family, usualAmount: f.usual.text, orders: f.orders, learnedHabits: f.learned.map((l) => l.text), note: "learned habits only pre-select; the buyer can change them" } });
  }
  const m = k.info.mandate;
  add({ id: "mandate", kind: "mandate", label: "The kitchen's signed mandate", data: { agentMaySpendAlonePerOrderEur: m.perOrderLimitCents / 100, weeklyBudgetEur: m.weeklyBudgetCents / 100, allowedCategories: m.allowedCategories, requiredAttributes: m.requiredAttributes, forbiddenAllergens: m.forbiddenAllergens, substitution: m.substitution, approvers: m.approvers } });

  // One live check, only for the one product a price or stock question is about.
  let liveCalls = 0;
  const liveTarget = LIVE_WORDS.test(question) ? (focus ?? (named.length === 1 || THIS_WORDS.test(question) ? undefined : named[0])) : undefined;
  if (liveTarget) {
    try {
      const live = await liveCheck(k, [liveTarget.id]);
      liveCalls = 1;
      const r = live.results[0];
      add({ id: `live:${liveTarget.id}`, kind: "live", label: `Live price and stock for ${short(liveTarget)}`, data: { checkedAt: live.checkedAt, ...(r?.offer ? { priceEurPerSalesUnit: r.offer.unitPriceCents / 100, salesUnit: r.offer.salesUnit, earliestDelivery: r.offer.deliveryDate, orderBy: r.offer.orderBy ?? "not stated", stock: r.offer.stockKnown === false ? "not confirmed by the wholesaler" : r.offer.availablePacks } : { orderable: false, why: r?.problems ?? [], message: r?.message }) } });
    } catch {
      // the answer then rests on master data alone
    }
  }

  const looked = { products: records.filter((r) => r.kind === "product").length, orders: records.filter((r) => r.kind === "order").length, memory: records.filter((r) => r.kind === "memory").length };
  const cite = (ids: string[]): Citation[] =>
    ids.flatMap((id) => {
      const r = records.find((x) => x.id === id);
      if (!r) return [];
      const productId = r.kind === "product" || r.kind === "live" ? id.split(":")[1] : undefined;
      const orderId = r.kind === "order" ? id.slice(6) : undefined;
      return [{ id, kind: r.kind, label: r.label, productId, orderId }];
    });

  try {
    const now = localNow(new Date());
    const weekday = new Date(`${now.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    const today = `Today is ${weekday} ${now.date}, ${now.time} Helsinki time; "last week" means ${addDaysIso(now.date, -7)} to ${addDaysIso(now.date, -1)}.`;
    const a = await askAssistant({ question, records, screen: `${body.screen ?? "the shop"}. ${today}`, history: body.history, brands: await catalogBrands(rt.catalog, k.info.mandate.allowedCategories) });
    return { kind: a.kind, answer: a.answer, citations: cite(a.citations), dataMissing: a.dataMissing, model: a.model, ms: a.ms, liveCalls, looked };
  } catch (err) {
    if (err instanceof DockError && (err.status === 503 || err.status === 504 || err.status === 502)) {
      return {
        kind: "no_model",
        answer: `The assistant's model is not answering (${err.message}). These are the records that match your question; nothing below is a model's answer.`,
        citations: cite(records.filter((r) => r.kind === "product" || r.kind === "live" || r.id === `order:${body.orderId}`).slice(0, 5).map((r) => r.id)),
        dataMissing: true,
        liveCalls,
        looked,
      };
    }
    throw err;
  }
}
