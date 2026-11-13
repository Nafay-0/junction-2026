import { InMemoryOutbox } from "@/core/approval";
import { InMemoryCatalog, MeteredCatalog, type Product } from "@/core/catalog";
import { InMemoryKitchenRepository } from "@/core/kitchen";
import { generateEd25519KeyPair } from "@/core/keys";
import { Ledger } from "@/core/ledger";
import { createTrustRegistry, signMandate, type Mandate } from "@/core/mandate";
import { InMemoryDockRepository, createDock, type AgentSession, type Dock } from "@/core/orders";
import { NeedSchema } from "@/core/need";
import { addDays } from "@/core/util";
import type { InteractionEvent } from "./model";
import type { Proposer } from "./propose";
import { BENCH_PRODUCTS, BENCH_STOCK, type ScriptedKitchen, type ScriptedNeed, type Step, type Truth } from "./scenarios";
import { createMemoryService, type MemoryService } from "./service";
import type { WriteReport } from "./writer";

/**
 * Plays a scripted kitchen's three weeks through the real intake (createDock, the same flow the REST API and the
 * kitchen portal use), with memory off or on, and counts what the buyer had to do:
 *
 *   remember     "should I remember this?" asked by the writer (memory on only): asked once per thing, never again
 *   questions    typed questions the intake asked before showing options
 *   falseAlarms  a mistake check the buyer had to wave through as intended
 *   picks        option cards the buyer had to choose between because the agent could not choose alone
 *   corrections  the agent's result was not what the kitchen wanted: a wrong product, amount or day quoted, a
 *                pre-selected card the buyer had to override, no card that fits
 *   caught       a slip in the request that a check caught, the buyer taking the offered correction
 *   missed       a slip in the request that nothing caught
 *   unsafe       an option shown that breaks the kitchen's own safety needs (nuts, lactose for the daycare)
 *
 * Manual effort = remember + questions + falseAlarms + picks + corrections: every tap the buyer had to make
 * beyond saying what they need. A caught slip is not effort: it is the one tap that saves a wrong order.
 *
 * Memory off is Dock before this work: order history and rules stated through "remember" only.
 */

export type StepLog = {
  step: string;
  states: string[];
  concerns: { code: string; message: string; response: string }[];
  questions: string[];
  usage: string[];
  learned?: WriteReport;
  ordered?: string;
  notes: string[];
};

export type Counts = { remember: number; questions: number; falseAlarms: number; picks: number; corrections: number; caught: number; missed: number; unsafe: number };
export const effort = (c: Counts) => c.remember + c.questions + c.falseAlarms + c.picks + c.corrections;
export type KitchenRun = { kitchen: string; mode: "off" | "on"; counts: Counts; steps: StepLog[]; memory?: MemoryService; orgId: string; dock: Dock; session: () => AgentSession; mandate: () => Mandate };

const PRODUCTS = new Map(BENCH_PRODUCTS.map((p) => [p.id, p]));

export function satisfies(p: Product, t: Truth): boolean {
  if (t.productIds && !t.productIds.includes(p.id)) return false;
  if (t.attributes && !t.attributes.every((a) => p.attributes.includes(a))) return false;
  if (t.without && t.without.some((a) => p.attributes.includes(a))) return false;
  if (t.notAllergens && t.notAllergens.some((a) => p.allergens.includes(a))) return false;
  return true;
}
const safe = (p: Product, t: Truth) => !(t.notAllergens ?? []).some((a) => p.allergens.includes(a)) && !(t.attributes ?? []).filter((a) => a === "lactose_free").some((a) => !p.attributes.includes(a));

type Line = { productId: string; packs?: number; quantity?: number };
function fits(lines: Line[], deliveryDate: string | undefined, t: Truth): boolean {
  const ps = lines.map((l) => PRODUCTS.get(l.productId)).filter((p): p is Product => !!p);
  if (ps.length !== lines.length || !ps.every((p) => satisfies(p, t))) return false;
  if (t.deliverBy && deliveryDate && deliveryDate > t.deliverBy) return false;
  if (t.amount) {
    const total = lines.reduce((s, l) => s + (l.packs ?? l.quantity ?? 0) * (PRODUCTS.get(l.productId)?.packSize ?? 0), 0);
    if (Math.abs(total - t.amount) > t.amount * 0.15) return false;
  }
  return true;
}

export async function runKitchen(k: ScriptedKitchen, mode: "off" | "on", opts: { proposer?: Proposer } = {}): Promise<KitchenRun> {
  let clock = new Date(k.steps[0].at);
  const now = () => clock;
  const ledger = new Ledger(undefined, now);
  const kitchens = new InMemoryKitchenRepository([k.profile()]);
  const key = await generateEd25519KeyPair(`${k.orgId}-key`);
  const dock = createDock({
    catalog: new MeteredCatalog(new InMemoryCatalog(BENCH_PRODUCTS, BENCH_STOCK, now)),
    repo: new InMemoryDockRepository(),
    ledger,
    trustedIssuers: createTrustRegistry([{ kid: key.kid, orgId: k.orgId, publicKey: key.publicKey }]),
    wholesalerKey: await generateEd25519KeyPair("bench-wholesaler"),
    notifier: new InMemoryOutbox(),
    now,
    kitchens,
  });
  const start = new Date(k.steps[0].at);
  let mandate: Mandate = {
    mandateId: `mnd_${k.orgId}`,
    issuer: { orgId: k.orgId, name: k.name },
    agentId: k.agentId,
    validFrom: addDays(start, -1).toISOString(),
    validUntil: addDays(start, 40).toISOString(),
    currency: "EUR",
    perOrderLimitCents: k.limits.perOrderLimitCents,
    weeklyBudgetCents: k.limits.weeklyBudgetCents,
    allowedCategories: k.limits.categories,
    requiredAttributes: [],
    forbiddenAllergens: [],
    requiredCertificates: [],
    delivery: { maxLeadDays: 7 },
    substitution: { rule: "within_preferences", maxPriceIncreasePct: 10 },
    approvers: [{ role: "manager", name: k.person, maxApprovalCents: 1_000_000 }],
  };
  let session = await dock.authenticate(await signMandate(mandate, key), k.agentId);
  const memory = mode === "on" ? createMemoryService({ kitchens, ledger, now, proposer: opts.proposer }) : undefined;
  const counts: Counts = { remember: 0, questions: 0, falseAlarms: 0, picks: 0, corrections: 0, caught: 0, missed: 0, unsafe: 0 };
  const steps: StepLog[] = [];

  for (const step of k.steps) {
    clock = new Date(step.at);
    const log: StepLog = { step: step.label, states: [], concerns: [], questions: [], usage: [], notes: [] };
    const events: InteractionEvent[] = [...(step.events ?? [])];
    let requestId: string | undefined;
    for (const sn of step.needs) {
      const r = await playNeed(dock, session, k, step, sn, memory, counts, log);
      events.push(...r.events);
      requestId ??= r.requestId;
    }
    if (memory) {
      const report = await memory.write(k.orgId, {
        door: step.door === "substitute" ? "substitute" : step.door,
        by: k.person,
        ...(step.site ? { site: step.site } : {}),
        ...(requestId ? { requestId } : {}),
        segments: step.text ? [{ id: "s1", source: step.source ?? "buyer", text: step.text }] : [],
        events,
      });
      log.learned = report;
      for (const q of report.questions) {
        counts.remember++;
        log.questions.push(`${q.question} -> ${step.confirm === false ? "no" : "yes"}`);
        await memory.confirm(k.orgId, q.itemId, step.confirm !== false, k.person);
      }
      if (step.acceptMandateOffers) {
        const offers = await memory.mandateOffers(k.orgId, mandate);
        for (const o of offers) {
          mandate = { ...mandate, forbiddenAllergens: [...new Set([...mandate.forbiddenAllergens, ...(o.patch.forbiddenAllergens ?? [])])], requiredAttributes: [...new Set([...mandate.requiredAttributes, ...(o.patch.requiredAttributes ?? [])])] };
          await memory.decideMandate(k.orgId, o.itemId, "added", k.person);
          log.notes.push(`Mandate re-signed by ${k.person}: ${o.text} is now enforced by the gate.`);
        }
        if (offers.length) session = await dock.authenticate(await signMandate(mandate, key), k.agentId);
      }
    }
    steps.push(log);
  }
  return { kitchen: k.name, mode, counts, steps, memory, orgId: k.orgId, dock, session: () => session, mandate: () => mandate };
}

async function playNeed(dock: Dock, session: AgentSession, k: ScriptedKitchen, step: Step, sn: ScriptedNeed, memory: MemoryService | undefined, counts: Counts, log: StepLog): Promise<{ events: InteractionEvent[]; requestId?: string }> {
  const events: InteractionEvent[] = [];
  let need = NeedSchema.parse({ ...sn.need, ...(step.text ? { text: step.text } : {}) });
  if (memory && step.site) {
    const scoped = await memory.applyScoped(k.orgId, need, { site: step.site });
    need = scoped.need;
    log.usage.push(...scoped.applied.map((a) => a.text));
  }
  let v = await dock.intake.open(session, { need, by: k.person });
  const requestId = v.requestId;
  let caught = false;
  for (let guard = 0; guard < 8; guard++) {
    log.states.push(v.state);
    if (memory) {
      const lines = await memory.usage(k.orgId, v);
      for (const l of lines) if (!log.usage.includes(l.text)) log.usage.push(l.text);
    }
    if (v.state === "needs_confirmation") {
      const responses = v.concerns.map((c) => {
        const fix = sn.fix ? c.corrections.find((x) => x.id.startsWith(sn.fix!)) : undefined;
        const cancel = sn.cancel ? c.corrections.find((x) => x.cancel) : undefined;
        const choice = cancel?.id ?? fix?.id ?? (c.confirmable ? "confirm" : c.corrections[0]?.id);
        if (fix || cancel) {
          counts.caught++;
          caught = true;
        } else if (choice === "confirm") counts.falseAlarms++; // the buyer had to wave it through
        else counts.corrections++;
        log.concerns.push({ code: c.code, message: c.message, response: cancel ? "cancelled" : fix ? `corrected: ${fix.label}` : choice === "confirm" ? "confirmed as intended (false alarm)" : `took ${choice}` });
        if (c.memoryItemIds?.length) events.push({ type: "concern_response", code: c.code, memoryItemIds: c.memoryItemIds, action: cancel ? "cancelled" : choice === "confirm" ? "confirmed" : "corrected" });
        return { key: c.key, choice: choice ?? "confirm" };
      });
      v = await dock.intake.respondToConcerns(session, v.requestId, { by: k.person, responses });
      continue;
    }
    if (v.state === "needs_input") {
      counts.questions += v.questions.length;
      const answers = v.questions.map((q) => ({ questionId: q.id, optionId: q.options.find((o) => (sn.truth.attributes ?? []).includes(o.id))?.id ?? q.options.at(-1)!.id }));
      v = await dock.intake.answer(session, v.requestId, { by: k.person, answers });
      continue;
    }
    if (v.state === "options_ready") {
      const product = (id: string) => PRODUCTS.get(id);
      if (v.options.some((o) => o.lines.some((l) => product(l.productId) && !safe(product(l.productId)!, sn.truth)))) {
        counts.unsafe++;
        log.notes.push("An option broke the kitchen's own safety needs.");
      }
      const ok = v.options.filter((o) => fits(o.lines, o.deliveryDate, sn.truth));
      const pre = v.preselected && v.options.find((o) => o.optionId === v.preselected!.optionId);
      const pick = pre && ok.includes(pre) ? pre : ok[0];
      if (!pick) {
        counts.corrections++;
        log.notes.push("No option was what the kitchen wanted: the buyer has to start again.");
        break;
      }
      if (pre && pre !== pick) counts.corrections++;
      else counts.picks++;
      v = await dock.intake.choose(session, v.requestId, { by: k.person, optionId: pick.optionId });
      continue;
    }
    if (v.state === "quoted") {
      const q = v.quote!.quote;
      const lines = q.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
      const deliveryDate = q.lines.map((l) => l.deliveryDate).sort().at(-1);
      if (!fits(lines, deliveryDate, sn.truth)) {
        counts.corrections++;
        log.notes.push("The order was not what the kitchen wanted: the buyer has to correct it.");
      }
      const order = await dock.placeOrder(session, { requestId: v.requestId, quoteToken: v.quote!.quoteToken, lines: q.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) });
      log.ordered = `${q.lines.map((l) => `${l.quantity} x ${l.productId}`).join(" + ")} for ${deliveryDate} (${order.status})`;
      const main = q.lines[0];
      const p = PRODUCTS.get(main.productId);
      if (p) events.push({ type: "option_chosen", family: p.category, productId: p.id, name: p.name, brand: p.brand, packSize: p.packSize, unit: p.unit, labels: v.chosen?.labels ?? [] });
      if (order.status === "committed") events.push({ type: "order_committed", orderId: order.orderId });
      break;
    }
    break; // no_options, cancelled
  }
  log.states.push(v.state);
  if ((sn.fix || sn.cancel) && !caught) {
    counts.missed++;
    log.notes.push("A slip in this request went through unnoticed.");
  }
  return { events, requestId };
}

export async function runBench(kitchens: ScriptedKitchen[], opts: { proposer?: Proposer } = {}) {
  const out: { kitchen: string; off: KitchenRun; on: KitchenRun }[] = [];
  for (const k of kitchens) out.push({ kitchen: k.name, off: await runKitchen(k, "off"), on: await runKitchen(k, "on", opts) });
  return out;
}
