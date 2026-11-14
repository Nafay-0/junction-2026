import { InMemoryOutbox } from "@/core/approval";
import { InMemoryCatalog, MeteredCatalog } from "@/core/catalog";
import { InMemoryKitchenRepository, addStatedPreference, emptyProfile, type KitchenProfile } from "@/core/kitchen";
import { generateEd25519KeyPair, type KeyPair } from "@/core/keys";
import { InMemoryLedgerStore, Ledger, type LedgerEntry } from "@/core/ledger";
import { createTrustRegistry, signMandate, type Mandate } from "@/core/mandate";
import { DockError, InMemoryDockRepository, createDock, type AgentSession, type DockDeps, type Door, type PublicOrder } from "@/core/orders";
import { SEED_PRODUCTS, SEED_STOCK } from "@/core/seed";
import { addDays } from "@/core/util";
import { SuspensionRegistry } from "../ops/suspensions";
import type { Hold } from "../radar/types";
import type { Maria } from "./client";
import { MariaMirror } from "./mirror";
import type { GateSources } from "./rows";

/**
 * Three and a half weeks of a school kitchen's rules changing, seeded through the real order flow (createDock on
 * the 12-product seed catalogue, the real gate, real signatures and sign-offs, the real suspension registry) on a
 * clock that is moved forward by hand. After every step the mirror writes what changed, with the session's
 * @@timestamp set to that clock, so MariaDB's history carries the scenario's own moments. Synthetic data only: the
 * kitchens, people and the recall drill are invented.
 *
 * The story of Koulukeittiö Aurinko (all times UTC; the page shows Helsinki time):
 *   day 0   mandate v1: €400 per order alone, €3,000 a week, lactose-free only, no allergen forbidden
 *   day 1   order A: 40 L of oat drink (contains gluten), placed alone
 *           order B: 500 L of lactose-free milk, €645, over the limit, signed off by the kitchen manager
 *   day 7   the kitchen manager adds "Never gluten" to the kitchen's rules; mandate v2 forbids gluten
 *   day 9   recall drill: the 10 L milk box is put on hold; the agent buys the other brand that day
 *   day 11  hold lifted; order D: 300 L of the same milk box, placed alone
 *   day 14  operations suspend the agent at night (calls from an unknown address); a call is refused; resumed
 *   day 15  mandate v3: €1,000 per order alone
 *   day 21  B's twin (the same 500 L) placed alone under the new limit
 *   day 22  the week fills: two orders the same morning (split check, signed), and cream
 * Two other kitchens order in the background, so the history and the decisions have some body.
 */

export const SCENARIO_WRITER = "scenario";
// Each kitchen's agent comes through one door (core/orders.ts Door), as server code would set it.
export const AURINKO = { orgId: "org_demo_aurinko", name: "Koulukeittiö Aurinko (seeded scenario)", agentId: "agent_aurinko_buyer", door: "mcp" as Door };
const SATAMA = { orgId: "org_demo_satama", name: "Hotelli Satama (seeded scenario)", agentId: "agent_satama_buyer", door: "rest" as Door };
const LINNA = { orgId: "org_demo_linna", name: "Kahvila Linna (seeded scenario)", agentId: "agent_linna_buyer", door: "connector" as Door };

export type ScenarioResult = {
  anchor: string;
  /** The orders the story turns on, by letter. */
  orders: Record<"A" | "B" | "C" | "D" | "E" | "F" | "G" | "H", string>;
  /** Moments worth sliding to. */
  moments: { label: string; at: string }[];
  ledger: LedgerEntry[];
  /** For "decisions like this one": who each order belongs to, and the door its request came through. */
  owner: Map<string, { orgId: string; agentId: string; door?: string }>;
  counts: { orders: number; decisions: number; refusals: number; syncs: number; rows: { insert: number; update: number; touch: number; delete: number } };
};

/** A small deterministic random source, so every run seeds the same background. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function mandateOf(k: { orgId: string; name: string; agentId: string }, version: number, from: Date, terms: Partial<Mandate>): Mandate {
  return {
    mandateId: `mnd_${k.orgId.replace("org_demo_", "")}_v${version}`,
    issuer: { orgId: k.orgId, name: k.name },
    agentId: k.agentId,
    validFrom: from.toISOString(),
    validUntil: addDays(from, 60).toISOString(),
    currency: "EUR",
    perOrderLimitCents: 40_000,
    weeklyBudgetCents: 300_000,
    allowedCategories: ["milk", "plant_drink", "cream"],
    requiredAttributes: ["lactose_free"],
    forbiddenAllergens: [],
    requiredCertificates: [],
    delivery: { maxLeadDays: 5 },
    substitution: { rule: "within_preferences", maxPriceIncreasePct: 10 },
    approvers: [
      { role: "kitchen_manager", name: "Aino Virtanen", maxApprovalCents: 250_000 },
      { role: "finance_director", name: "Mikko Laine", maxApprovalCents: 1_000_000 },
    ],
    ...terms,
  };
}

export async function runScenario(db: Maria, opts: { now?: Date; log?: (line: string) => void } = {}): Promise<ScenarioResult> {
  const log = opts.log ?? (() => undefined);
  const realNow = opts.now ?? new Date();
  const anchor = new Date(Math.floor((realNow.getTime() - 25 * 86_400_000) / 86_400_000) * 86_400_000);
  let t = anchor.getTime();
  const clock = () => new Date(t);
  const at = (dayN: number, hh: number, mm = 0) => {
    const next = anchor.getTime() + dayN * 86_400_000 + (hh * 60 + mm) * 60_000;
    if (next <= t) throw new Error(`scenario clock would go back (day ${dayN} ${hh}:${mm})`);
    t = next;
  };
  const tick = (minutes = 1) => void (t += minutes * 60_000);

  const keys = new Map<string, KeyPair>();
  for (const k of [AURINKO, SATAMA, LINNA]) keys.set(k.orgId, await generateEd25519KeyPair(`${k.orgId}-key`));
  const registry = createTrustRegistry([...keys.entries()].map(([orgId, k]) => ({ kid: k.kid, orgId, publicKey: k.publicKey })));
  const repo = new InMemoryDockRepository();
  const kitchens = new InMemoryKitchenRepository();
  const outbox = new InMemoryOutbox();
  const ledgerStore = new InMemoryLedgerStore();
  const holds: Hold[] = [];
  const deps: DockDeps = {
    catalog: new MeteredCatalog(new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK, clock)),
    repo,
    ledger: new Ledger(ledgerStore, clock),
    trustedIssuers: registry,
    wholesalerKey: await generateEd25519KeyPair("scenario-wholesaler"),
    notifier: outbox,
    now: clock,
    kitchens,
    // The gate's recall_hold rule reads the holds through createDock's ProductHolds, as the radar's are in the app.
    holds: { holdsFor: (ids) => holds.filter((h) => !h.liftedAt && ids.includes(h.productId)).map((h) => ({ productId: h.productId, name: h.productName, reason: h.reason, url: h.noticeUrl, drill: h.drill })) },
  };
  const dock = createDock(deps);
  const suspensions = new SuspensionRegistry(dock, clock);
  const sessions = new Map<string, AgentSession>();
  const presented = new Map<string, Mandate>();

  const mirror = new MariaMirror({
    db,
    writer: SCENARIO_WRITER,
    sessionClock: clock,
    intervalMs: 0,
    now: clock,
    read: async (): Promise<GateSources> => {
      const orders = await repo.listOrders();
      const requests = new Map((await Promise.all(orders.map((o) => repo.getRequest(o.requestId)))).filter((r) => r).map((r) => [r!.requestId, r!]));
      const profiles = (await Promise.all([AURINKO, SATAMA, LINNA].map((k) => kitchens.getProfile(k.orgId)))).filter((p): p is KitchenProfile => !!p);
      return { now: clock(), mandates: [...presented.values()], orders, requests, unverified: new Map(), kitchens: profiles, holds: structuredClone(holds), suspensions: suspensions.all() };
    },
  });
  const sync = async () => void (await mirror.sync());

  async function issue(k: typeof AURINKO, version: number, terms: Partial<Mandate>) {
    const m = mandateOf(k, version, clock(), terms);
    sessions.set(k.agentId, { ...(await dock.authenticate(await signMandate(m, keys.get(k.orgId)!), k.agentId)), door: k.door });
    presented.set(k.agentId, m);
    await sync();
  }

  async function addRule(k: typeof AURINKO, id: string, rule: { kind: "forbid_allergen"; allergen: string } | { kind: "require_claim"; claim: string }, text: string, by: string) {
    const p = (await kitchens.getProfile(k.orgId)) ?? emptyProfile(k.orgId, k.name);
    await kitchens.saveProfile(addStatedPreference(p, { id, ...rule, text, statedBy: by, statedAt: clock().toISOString() }));
    await sync();
  }

  let refusals = 0;
  /** One order through the real flow: request, live quote, the gate. Sign-offs are decided by the named person. */
  async function order(k: typeof AURINKO, text: string, lines: { productId: string; quantity: number }[], opts: { asked?: string[]; neededBy?: string; decide?: "approve" | "decline" } = {}): Promise<PublicOrder | undefined> {
    const session = sessions.get(k.agentId)!;
    try {
      suspensions.enforce(session, { via: "rest", path: "/api/v1/requests" });
      const r = await dock.openRequest(session, { text, ...(opts.neededBy ? { neededBy: opts.neededBy } : {}), ...(opts.asked ? { productIds: opts.asked } : {}) });
      tick();
      const q = await dock.requestQuote(session, { requestId: r.requestId, lines });
      tick();
      const o = await dock.placeOrder(session, { requestId: r.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) });
      await sync();
      if (o.status === "pending_approval" && o.approval) {
        tick(7);
        const msg = outbox.messages().find((m) => m.approvalId === o.approval!.approvalId)!;
        const token = new URL(msg.link, "https://x.invalid").searchParams.get("token")!;
        const decided = await dock.decideApproval(o.approval.approvalId, { decision: opts.decide ?? "approve", proof: { kind: "link_token", token } });
        await sync();
        return decided;
      }
      return o;
    } catch (err) {
      if (!(err instanceof DockError)) throw err;
      refusals += 1;
      await sync();
      return undefined;
    } finally {
      tick();
    }
  }

  const ids = {} as ScenarioResult["orders"];
  const keep = (letter: keyof ScenarioResult["orders"], o: PublicOrder | undefined) => {
    if (!o) throw new Error(`scenario order ${letter} was not placed`);
    ids[letter] = o.orderId;
    log(`  ${letter}  ${o.orderId}  ${o.status.padEnd(17)} ${o.decision.outcome}`);
  };
  const moments: ScenarioResult["moments"] = [];
  const mark = (label: string) => moments.push({ label, at: clock().toISOString() });

  // ---- day 0: mandates and the kitchen's first rule ----
  at(0, 6);
  await issue(AURINKO, 1, {});
  await issue(SATAMA, 1, { perOrderLimitCents: 80_000, weeklyBudgetCents: 400_000, allowedCategories: ["milk", "cream", "yoghurt"], forbiddenAllergens: ["nuts"], substitution: { rule: "needs_approval", maxPriceIncreasePct: 10 }, approvers: [{ role: "head_chef", name: "Sanna Koskinen", maxApprovalCents: 300_000 }] });
  await issue(LINNA, 1, { perOrderLimitCents: 25_000, weeklyBudgetCents: 120_000, allowedCategories: ["milk", "plant_drink"], requiredAttributes: [], substitution: { rule: "same_attributes", maxPriceIncreasePct: 5 }, approvers: [{ role: "owner", name: "Jari Mäkelä", maxApprovalCents: 200_000 }] });
  tick(5);
  await addRule(AURINKO, "pref_aurinko_lactose", { kind: "require_claim", claim: "lactose_free" }, "Always lactose-free: the whole school eats from the same pots", "Aino Virtanen (kitchen manager)");
  mark("Mandate v1 in force");

  // ---- day 1: A and B ----
  at(1, 7, 10);
  keep("A", await order(AURINKO, "40 L of oat drink for the porridge", [{ productId: "PK-4001", quantity: 40 }]));
  at(1, 7, 30);
  keep("B", await order(AURINKO, "500 L of lactose-free milk by Wednesday", [{ productId: "VA-1010", quantity: 50 }], { asked: ["VA-1010"] }));
  mark("A and B placed");

  // ---- background, weeks 1 to 3 ----
  const r = rng(20261114);
  const background = async (dayN: number) => {
    const plans: [typeof AURINKO, string, { productId: string; quantity: number }[], { asked?: string[]; decide?: "approve" | "decline" }][] = [
      [SATAMA, "Milk for the breakfast buffet", [{ productId: "VA-1001", quantity: 120 + Math.round(r() * 200) }], {}],
      [SATAMA, "A big milk order for the conference", [{ productId: "VA-1010", quantity: 70 }], { decide: r() < 0.3 ? "decline" : "approve" }],
      [SATAMA, "Cream for the pastry kitchen", [{ productId: "VA-2301", quantity: 20 + Math.round(r() * 30) }], {}],
      [SATAMA, "Ordinary milk, the cheap one", [{ productId: "VA-1110", quantity: 10 }], {}],
      [SATAMA, "Oat drink for the vegan menu", [{ productId: "PK-4001", quantity: 30 }], {}],
      [SATAMA, "Whole milk by Friday", [{ productId: "AR-2015", quantity: 40 }], {}],
      [SATAMA, "10 L boxes of Valio milk, any brand will do", [{ productId: "AR-2010", quantity: 20 }], { asked: ["VA-1010"] }],
      [LINNA, "Milk for the coffee", [{ productId: "VA-1001", quantity: 60 + Math.round(r() * 80) }], {}],
      [LINNA, "Oat drink for lattes", [{ productId: "PK-4001", quantity: 40 + Math.round(r() * 60) }], {}],
      [LINNA, "Yoghurt for the breakfast bowls", [{ productId: "VA-3101", quantity: 10 }], {}],
      [LINNA, "Milk boxes, a swap is fine", [{ productId: "JP-3010", quantity: 60 }], { asked: ["VA-1010"] }],
      [LINNA, "A lot of milk for the weekend market", [{ productId: "VA-1001", quantity: 200 }], { decide: r() < 0.4 ? "decline" : "approve" }],
    ];
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const [k, text, lines, o] = plans[Math.floor(r() * plans.length)];
      at(dayN, 9 + i * 2, Math.floor(r() * 50)); // after the day's scripted events, which all end before 09.00
      await order(k, text, lines, o);
    }
  };
  for (const dayN of [2, 3, 4, 5, 6]) await background(dayN);

  // ---- day 7: a kitchen rule, then the mandate follows it ----
  at(7, 5, 45);
  await addRule(AURINKO, "pref_aurinko_gluten", { kind: "forbid_allergen", allergen: "gluten" }, "Never gluten: two pupils are coeliac", "Aino Virtanen (kitchen manager)");
  at(7, 6);
  await issue(AURINKO, 2, { forbiddenAllergens: ["gluten"] });
  mark("Gluten forbidden");
  await background(8);

  // ---- day 9 to 11: a recall drill on the 10 L milk box ----
  at(9, 8);
  holds.push({
    holdId: "hold_drill_va1010",
    productId: "VA-1010",
    productName: "Valio Eila lactose-free semi-skimmed milk drink 1.5 %, 10 L bag-in-box",
    noticeId: "notice_drill_2611",
    matchId: "match_drill_2611",
    drill: true,
    reason: "Recall drill (synthetic): batch 2611 treated as recalled for a possible foreign object.",
    noticeUrl: "https://example.org/dock-recall-drill/2611",
    noticeTitle: "Recall drill 2611 (synthetic)",
    publisher: "Dock recall drill",
    placedAt: clock().toISOString(),
    placedBy: "Leena Korhonen (quality)",
    refusals: 0,
  });
  await sync();
  mark("Recall drill: milk box on hold");
  at(9, 9, 30);
  keep("C", await order(AURINKO, "250 L lactose-free milk, the 10 L box is on hold", [{ productId: "AR-2010", quantity: 25 }]));
  await background(10);
  at(11, 7);
  Object.assign(holds[0], { liftedAt: clock().toISOString(), liftedBy: "Leena Korhonen (quality)", liftReason: "Drill closed: batch 2611 cleared." });
  await sync();
  mark("Hold lifted");
  at(11, 8);
  keep("D", await order(AURINKO, "300 L of the usual milk box", [{ productId: "VA-1010", quantity: 30 }], { asked: ["VA-1010"] }));
  for (const dayN of [11, 12, 13]) await background(dayN);

  // ---- day 14: the agent suspended at night ----
  at(14, 1);
  const s = suspensions.suspend({ scope: "agent", target: AURINKO.agentId, label: "Aurinko's buyer agent", reason: "Calls at 03.00 from an address the kitchen does not use", by: "Jussi Nieminen (operations)", orgId: AURINKO.orgId });
  await sync();
  mark("Agent suspended");
  at(14, 1, 10);
  await order(AURINKO, "1000 L milk now", [{ productId: "VA-1001", quantity: 1000 }]); // refused at the door
  at(14, 7, 30);
  suspensions.resume(s.suspensionId, { by: "Jussi Nieminen (operations)", note: "The kitchen confirmed: a new tablet in the night kitchen" });
  await sync();
  mark("Agent resumed");

  // ---- day 15: the limit raised ----
  at(15, 6);
  await issue(AURINKO, 3, { forbiddenAllergens: ["gluten"], perOrderLimitCents: 100_000 });
  mark("Limit raised to €1,000");
  await background(15);
  at(16, 6);
  await issue(LINNA, 2, { perOrderLimitCents: 35_000, weeklyBudgetCents: 120_000, allowedCategories: ["milk", "plant_drink"], requiredAttributes: [], substitution: { rule: "same_attributes", maxPriceIncreasePct: 5 }, approvers: [{ role: "owner", name: "Jari Mäkelä", maxApprovalCents: 200_000 }] });
  await addRule(SATAMA, "pref_satama_gluten", { kind: "forbid_allergen", allergen: "gluten" }, "Gluten-free kitchen from now on", "Sanna Koskinen (head chef)");
  at(16, 6, 30);
  await issue(SATAMA, 2, { perOrderLimitCents: 80_000, weeklyBudgetCents: 400_000, allowedCategories: ["milk", "cream", "yoghurt"], forbiddenAllergens: ["nuts", "gluten"], substitution: { rule: "needs_approval", maxPriceIncreasePct: 10 }, approvers: [{ role: "head_chef", name: "Sanna Koskinen", maxApprovalCents: 300_000 }] });
  for (const dayN of [17, 18, 19, 20]) await background(dayN);

  // ---- day 21 and 22: the week fills ----
  at(21, 7, 30);
  keep("H", await order(AURINKO, "500 L of lactose-free milk, like last time", [{ productId: "VA-1010", quantity: 50 }], { asked: ["VA-1010"] }));
  await background(21);
  at(22, 6);
  keep("E", await order(AURINKO, "600 L of milk in cartons for the week", [{ productId: "VA-1001", quantity: 600 }]));
  at(22, 6, 20);
  keep("F", await order(AURINKO, "Another 600 L of cartons, same delivery", [{ productId: "VA-1001", quantity: 600 }]));
  at(22, 7);
  keep("G", await order(AURINKO, "Cream for the sauce", [{ productId: "VA-2301", quantity: 20 }]));
  mark("The week fills");
  for (const dayN of [22, 23]) await background(dayN);

  const st = mirror.status();
  const ledger = ledgerStore.all().map((e) => structuredClone(e));
  const owner = new Map<string, { orgId: string; agentId: string; door?: string }>();
  for (const o of await repo.listOrders()) owner.set(o.orderId, { orgId: o.orgId, agentId: o.agentId, door: (await repo.getRequest(o.requestId))?.door });
  return {
    anchor: anchor.toISOString(),
    orders: ids,
    moments,
    ledger,
    owner,
    counts: { orders: owner.size, decisions: ledger.filter((e) => e.type === "decision").length, refusals, syncs: st.syncs, rows: st.writes },
  };
}
