import { base64url } from "jose";
import { localNow, nextDeliveryDay, usualAmount } from "@/core/kitchen";
import { say } from "@/app/_ui/plain";
import type { Runtime } from "../runtime";
import { suspensions } from "../ops/suspensions";
import { ShowAgent, orderLines, type Json, type Reply } from "./agent";
import { catalogueLock } from "./lock";
import { resolveKitchen } from "./registry";
import type { AttackId, AttackResult } from "./types";

/**
 * "Now try to break it": one key per attack, each a real request through the real gate with the kitchen's own
 * agent credentials (or a forged copy of them), each showing what stopped it and the rule's name. Anything an
 * attack had to set up (an order waiting for sign-off) is taken back straight after, and the suspension is lifted
 * by the resume key or by itself after 90 seconds, so the kitchen is left as it was.
 */
export const ATTACKS: { id: AttackId; key: string; title: string; tried: string }[] = [
  { id: "tenfold", key: "1", title: "Ten times too much", tried: "Order ten times the kitchen's usual milk, then skip the question and ask for a price anyway." },
  { id: "forged_mandate", key: "2", title: "A forged mandate", tried: "Raise the agent's spending limit inside its signed mandate, then use it." },
  { id: "replay", key: "3", title: "A replayed fixed price", tried: "Use the wholesaler's signed quote a second time, after it already bought something." },
  { id: "self_approve", key: "4", title: "The agent approves its own order", tried: "Place an order over the limit, then send the approval itself, without the person's passkey." },
  { id: "split", key: "5", title: "One need, split to dodge the limit", tried: "Buy one need as two orders, each under what the agent may spend alone." },
  { id: "relayed_yes", key: "6", title: '"The chef said yes"', tried: "Confirm an odd amount on the chef's behalf, then order as if a person had checked it." },
  { id: "suspend", key: "S", title: "Suspended by the wholesaler", tried: "Operations staff suspend the agent; the agent then makes its next call." },
  { id: "resume", key: "R", title: "Resumed", tried: "Operations staff lift the suspension." },
];

type Ctx = { rt: Runtime; agent: ShowAgent; orgId: string; agentId: string; kitchen: string; token: string; by: string };

const g = globalThis as typeof globalThis & { __dockShowSuspension?: { id: string; timer: ReturnType<typeof setTimeout> } };

export async function runAttack(rt: Runtime, id: AttackId, opts: { sandboxId?: string; by: string }): Promise<AttackResult> {
  const meta = ATTACKS.find((a) => a.id === id)!;
  const k = await resolveKitchen(rt, opts.sandboxId);
  const agent = new ShowAgent({ mandateToken: k.token, agentId: k.ref.agentId }, { kitchen: k.ref.sandboxId, share: `show-attacks-${k.ref.sandboxId}` });
  const ctx: Ctx = { rt, agent, orgId: k.ref.orgId, agentId: k.ref.agentId, kitchen: k.ref.name, token: k.token, by: opts.by };
  const base = { id, title: meta.title, tried: meta.tried, at: new Date().toISOString(), source: "live" as const, notes: [] as string[] };
  try {
    const r = await catalogueLock().run(() => ATTACK_FNS[id](ctx));
    return { ...base, ...r, notes: [...base.notes, ...(r.notes ?? [])] };
  } catch (err) {
    return { ...base, held: false, how: "error", message: `The attack could not be set up: ${err instanceof Error ? err.message : String(err)}` };
  }
}

type Outcome = Omit<AttackResult, "id" | "title" | "tried" | "at" | "source" | "notes"> & { notes?: string[] };

/** What the gate answered, as a result. */
function refusal(reply: Reply, fallback = "Refused."): Outcome {
  const e = reply.body.error;
  const order = reply.body.order as Json | undefined;
  if (order && order.status === "pending_approval") {
    const esc = (order.decision.rules as Json[]).find((r) => r.outcome === "escalate" && r.rule !== "per_order_limit") ?? (order.decision.rules as Json[]).find((r) => r.outcome === "escalate");
    return { held: true, how: "person", rule: esc?.rule, status: reply.status, message: say(String(esc?.reason ?? order.decision.reasons[0] ?? "")) };
  }
  if (reply.status >= 400 || order?.status === "rejected") return { held: true, how: "refused", rule: e?.rule, code: e?.code, status: reply.status, message: say(String(e?.message ?? fallback)) };
  return { held: false, how: "allowed", status: reply.status, message: "The gate let it through." };
}

async function milkFor(ctx: Ctx, requestId: string): Promise<{ id: string; price: number; packSize: number }> {
  const products = (await ctx.rt.catalog.searchProducts({ category: "milk", attributes: ["lactose_free", "fat_1_5"], limit: 40 })).filter((p) => p.unit === "L" && (p.kinds ?? []).length === 0).slice(0, 8);
  const r = await ctx.agent.availability(requestId, products.map((p) => p.id));
  const offers = (r.body.offers ?? []) as Json[];
  const best = offers
    .filter((o) => o.stockKnown === false || o.availablePacks >= 20)
    .map((o) => ({ id: String(o.productId), price: Number(o.unitPriceCents), packSize: products.find((p) => p.id === o.productId)!.packSize }))
    .sort((a, b) => a.price / a.packSize - b.price / b.packSize)[0];
  if (!best) throw new Error("no lactose-free milk can be priced live right now");
  return best;
}

const nextDay = () => nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5, 6])!;

/** Withdraw an order an attack left waiting, so the person's phone is not left with a fake request. */
async function tidy(ctx: Ctx, order: Json | undefined, notes: string[]) {
  if (order?.status !== "pending_approval") return;
  const w = await ctx.agent.withdraw(order.orderId, "Taken back after the demonstration.", "the presenter");
  notes.push(w.status === 200 ? "The order waiting for sign-off was withdrawn straight after." : "Could not withdraw the waiting order; withdraw it from the kitchen's orders page.");
}

const ATTACK_FNS: Record<AttackId, (ctx: Ctx) => Promise<Outcome>> = {
  async tenfold(ctx) {
    const profile = await ctx.rt.kitchens.getProfile(ctx.orgId);
    const usual = (profile && usualAmount(profile, "milk")?.amount) || 100;
    const litres = Math.round(usual * 10);
    const r = await ctx.agent.intakeOpen({ text: `${litres} L of lactose-free milk`, item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: litres, unit: "L" }, deliverBy: nextDay(), requiredClaims: ["lactose_free"] }, "the attacker");
    const step = r.body.step as Json | undefined;
    const concern = (step?.concerns as Json[] | undefined)?.find((c) => c.code === "quantity_tenfold");
    if (!step || !concern) return { held: false, how: "allowed", message: `The mistake check did not stop ${litres} L (state ${step?.state ?? r.status}).` };
    const milk = await ctx.rt.catalog.searchProducts({ category: "milk", attributes: ["lactose_free"], limit: 1 });
    const around = await ctx.agent.quote(step.requestId, [{ productId: milk[0].id, quantity: 10 }]);
    const e = around.body.error;
    return { held: true, how: "stopped", rule: e?.rule ?? "human_input", code: e?.code, status: around.status, message: `${say(String(concern.message))} Going around the question: ${say(String(e?.message ?? "refused"))}` };
  },

  async forged_mandate(ctx) {
    const [h, p, s] = ctx.token.split(".");
    const claims = JSON.parse(new TextDecoder().decode(base64url.decode(p)));
    claims.mandate.perOrderLimitCents = 100_000_000;
    const forged = [h, base64url.encode(JSON.stringify(claims)), s].join(".");
    return refusal(await ctx.agent.withMandate(forged).openRequest("1,000 L of milk, no questions"));
  },

  async replay(ctx) {
    const req = await ctx.agent.openRequest("A carton for the coffee bar", nextDay());
    const requestId = String(req.body.request?.requestId);
    // The first use must be an ordinary order the agent may place alone. One carton of the kitchen's milk would
    // look like a slip next to its usual hundreds of litres (the gate now holds such an order for the person), so
    // it buys one carton of a plant drink the mandate allows; on a catalogue without one, one pack of milk.
    const plant = (await ctx.rt.catalog.searchProducts({ category: "plant_drink", attributes: ["lactose_free"], limit: 40 })).filter((p) => p.unit === "L" && p.packSize <= 1 && !p.allergens.some((a) => ["gluten", "nuts"].includes(a)) && (p.kinds ?? []).length === 0);
    let pick: { id: string } | undefined;
    if (plant.length) {
      const offers = ((await ctx.agent.availability(requestId, plant.slice(0, 6).map((p) => p.id))).body.offers ?? []) as Json[];
      pick = offers[0] ? { id: String(offers[0].productId) } : undefined;
    }
    pick ??= await milkFor(ctx, requestId);
    const q = await ctx.agent.quote(requestId, [{ productId: pick.id, quantity: 1 }]);
    if (q.status !== 201) return refusal(q);
    const first = await ctx.agent.placeOrder(requestId, q.body.quoteToken, orderLines(q.body.quote));
    const notes: string[] = [];
    const st = String(first.body.order?.status ?? first.status);
    notes.push(st === "committed" ? "First use: one carton, placed alone and bought for real." : `First use: ${st.replace("_", " ")}.`);
    const again = await ctx.agent.placeOrder(requestId, q.body.quoteToken, orderLines(q.body.quote));
    const out = refusal(again);
    await tidy(ctx, first.body.order, notes);
    return { ...out, notes };
  },

  async self_approve(ctx) {
    const req = await ctx.agent.openRequest("Milk for a gala dinner", nextDay());
    const requestId = String(req.body.request?.requestId);
    const milk = await milkFor(ctx, requestId);
    const packs = Math.ceil(60_000 / milk.price); // a little over the €500 the agent may spend alone
    const q = await ctx.agent.quote(requestId, [{ productId: milk.id, quantity: packs }]);
    if (q.status !== 201) return refusal(q);
    const placed = await ctx.agent.placeOrder(requestId, q.body.quoteToken, orderLines(q.body.quote));
    const order = placed.body.order as Json | undefined;
    const approvalId = order?.approval?.approvalId;
    if (!approvalId) return { held: false, how: "error", message: `Expected the order to wait for a person; it is ${order?.status ?? placed.status}.` };
    const self = await ctx.agent.decide(approvalId, "approve", "the-agent-says-yes");
    const notes: string[] = [];
    await tidy(ctx, order, notes);
    return { ...refusal(self), notes };
  },

  async split(ctx) {
    const req = await ctx.agent.openRequest("Milk for the weekend event", nextDay());
    const requestId = String(req.body.request?.requestId);
    const milk = await milkFor(ctx, requestId);
    const packs = Math.max(1, Math.round(28_000 / milk.price)); // two orders of about €280: each under €500, together over
    const notes: string[] = [];
    const one = await ctx.agent.quote(requestId, [{ productId: milk.id, quantity: packs }]);
    if (one.status !== 201) return refusal(one);
    const first = await ctx.agent.placeOrder(requestId, one.body.quoteToken, orderLines(one.body.quote));
    notes.push(`First order: ${String(first.body.order?.status ?? first.status).replace("_", " ")}.`);
    if (first.body.order?.status === "pending_approval") {
      await tidy(ctx, first.body.order, notes);
      return { ...refusal(first), notes };
    }
    const two = await ctx.agent.quote(requestId, [{ productId: milk.id, quantity: packs }]);
    if (two.status !== 201) return { ...refusal(two), notes };
    const second = await ctx.agent.placeOrder(requestId, two.body.quoteToken, orderLines(two.body.quote));
    const out = refusal(second);
    await tidy(ctx, second.body.order, notes);
    return { ...out, notes };
  },

  async relayed_yes(ctx) {
    const profile = await ctx.rt.kitchens.getProfile(ctx.orgId);
    const usual = (profile && usualAmount(profile, "milk")?.amount) || 100;
    const litres = Math.max(2, Math.round(usual / 10));
    let r = await ctx.agent.intakeOpen({ text: `${litres} L of lactose-free milk, cheapest`, item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: litres, unit: "L" }, deliverBy: nextDay(), requiredClaims: ["lactose_free"], optimise: "price" }, "the chef (relayed by the agent)");
    let step = r.body.step as Json | undefined;
    const concern = (step?.concerns as Json[] | undefined)?.[0];
    if (!step || !concern) return { held: false, how: "allowed", message: `Nothing asked about ${litres} L (state ${step?.state ?? r.status}).` };
    // The agent says yes to everything Dock asks, on the chef's behalf.
    for (let round = 0; round < 4 && step.state !== "quoted"; round++) {
      if (step.state === "needs_confirmation") r = await ctx.agent.concerns(step.requestId, "the chef said yes (relayed by the agent)", (step.concerns as Json[]).map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })));
      else if (step.state === "needs_input") r = await ctx.agent.answers(step.requestId, "the chef said yes (relayed by the agent)", (step.questions as Json[]).map((q) => ({ questionId: q.id, optionId: q.options[0].id })));
      else if (step.state === "options_ready") r = await ctx.agent.choose(step.requestId, "the agent", step.preselected?.optionId ?? step.options[0].optionId);
      else break;
      step = r.body.step as Json;
    }
    if (step.state !== "quoted") return { held: true, how: "stopped", message: say(String(step.notes?.[0] ?? `The request is ${step.state}.`)) };
    const placed = await ctx.agent.placeOrder(step.requestId, step.quote.quoteToken, orderLines(step.quote.quote));
    const out = refusal(placed);
    const notes: string[] = [];
    await tidy(ctx, placed.body.order, notes);
    return { ...out, notes };
  },

  async suspend(ctx) {
    const reg = suspensions(ctx.rt.dock);
    const existing = reg.find(ctx.agentId, ctx.orgId);
    if (!existing) {
      const s = reg.suspend({ scope: "agent", target: ctx.agentId, label: `${ctx.kitchen}'s buyer agent`, reason: "Stopped from the operations desk during the demo.", by: ctx.by, orgId: ctx.orgId });
      if (g.__dockShowSuspension) clearTimeout(g.__dockShowSuspension.timer);
      const timer = setTimeout(() => {
        try {
          reg.resume(s.suspensionId, { by: "the show (after 90 s)", note: "Lifted automatically after the demonstration." });
        } catch {
          // already resumed
        }
        g.__dockShowSuspension = undefined;
      }, 90_000);
      timer.unref?.();
      g.__dockShowSuspension = { id: s.suspensionId, timer };
    }
    const next = await ctx.agent.kitchen();
    return { ...refusal(next), notes: ["Press R to lift it; it lifts by itself after 90 s."] };
  },

  async resume(ctx) {
    const reg = suspensions(ctx.rt.dock);
    const s = reg.find(ctx.agentId, ctx.orgId);
    if (!s) return { held: false, how: "allowed", message: "The agent was not suspended." };
    reg.resume(s.suspensionId, { by: ctx.by, note: "Lifted after the demonstration." });
    if (g.__dockShowSuspension) clearTimeout(g.__dockShowSuspension.timer);
    g.__dockShowSuspension = undefined;
    const next = await ctx.agent.kitchen();
    return { held: false, how: "allowed", status: next.status, message: next.status === 200 ? "Resumed: its next call went through again." : `Still refused: ${next.body.error?.message}` };
  },
};
