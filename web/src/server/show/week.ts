import type { DockEvent } from "@/core/events";
import { formatDay, isoWeekday, type KitchenProfile } from "@/core/kitchen";
import type { Mandate } from "@/core/mandate";
import { newId } from "@/core/util";
import { clock, day as dayText, moneyShort, roleLabel, say } from "@/app/_ui/plain";
import type { Runtime } from "../runtime";
import { ShowAgent, orderLines, type Json, type Send } from "./agent";
import { castWeek, planDates, type Cast, type DatePlan } from "./cast";
import { catalogueLock } from "./lock";
import { USUAL_MILK_LITRES, driftPlan, shortName, weekProfile, type DriftPlan } from "./past";
import { simulateStockOut, type Simulation } from "./simulate";
import type { ExcludedView, GateView, KitchenRef, OptionView, OrderView, StepKind, Tally, WeekRun, WeekStep } from "./types";

/**
 * "A week in a kitchen": the director. One call starts a compressed week in which the kitchen's agent handles the
 * partner's own example scenarios one after another, each as real requests through Dock's REST API and its gate:
 *
 *   Monday     the standing order, placed by the agent alone ("same as last time", from memory)
 *   Tuesday    a slip in the amount (ten times the usual): the mistake check stops it before any price lookup
 *   Wednesday  the usual milk has run out (SIMULATED stock-out): good, better, best alternatives, all lactose-free
 *   Thursday   a last-minute booking over the agent's limit: stopped at the gate for the named person's passkey
 *   Friday     a standing order that crept up: the standing-order check queries it before renewing
 *   Saturday   a product that breaks the kitchen's allergen rule, sent straight to the gate: refused, rule named
 *
 * Where a person would answer a question, the answer is scripted and labelled (the ledger records it as relayed by
 * the agent, not verified). The sign-off is never scripted: it waits for the real person, and after a timeout the
 * agent withdraws the order, so nothing is bought without them and the show never hangs. When the week ends (or is
 * stopped), the kitchen is put back: waiting orders withdrawn, its own past restored, simulations cleared.
 */

export type Pace = { introMs: number; beatMs: number; dwellMs: number; gateDwellMs: number };
export const LIVE_PACE: Pace = { introMs: 1200, beatMs: 1800, dwellMs: 5200, gateDwellMs: 6000 };
export const TEST_PACE: Pace = { introMs: 0, beatMs: 0, dwellMs: 0, gateDwellMs: 0 };

export type DirectorOptions = {
  rt: Runtime;
  kitchen: KitchenRef;
  mandateToken: string;
  mandate: Mandate;
  send?: Send;
  pace?: Pace;
  /** How long the Thursday sign-off waits for the person before the agent withdraws the order. */
  signOffTimeoutMs?: number;
  /** An unexpected sign-off on another day (the gate may ask for one) waits this long. */
  sideSignOffTimeoutMs?: number;
  onChange?: (run: WeekRun) => void;
  now?: () => Date;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export const SIGNOFF_TIMEOUT_MS = 40_000;

const DAYS: Record<StepKind, { day: string; title: string }> = {
  standing: { day: "Monday", title: "The standing order" },
  slip: { day: "Tuesday", title: "A slip in the amount" },
  stockout: { day: "Wednesday", title: "The usual milk has run out" },
  lastminute: { day: "Thursday", title: "A last-minute booking" },
  drift: { day: "Friday", title: "A standing order that crept up" },
  refusal: { day: "Saturday", title: "A swap that breaks the allergen rule" },
};
export const STEP_ORDER: StepKind[] = ["standing", "slip", "stockout", "lastminute", "drift", "refusal"];

function blankStep(kind: StepKind): WeekStep {
  return { kind, ...DAYS[kind], status: "ahead", asked: "", did: [], memory: [], options: [], excluded: [], simulated: [], decisions: 0, askedPerson: 0, refused: 0, requestIds: [], orderIds: [], liveCalls: 0 };
}

export function emptyTally(): Tally {
  return { decisions: 0, askedPerson: 0, refused: 0, wrongOrders: 0, committed: 0, spentCents: 0 };
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

class Stopped extends Error {}

/** Per organisation, the kitchen's own past from before its first week, so every week puts back the same thing. */
const g = globalThis as typeof globalThis & { __dockShowOriginals?: Map<string, KitchenProfile | null> };
const originals = (g.__dockShowOriginals ??= new Map());

export class WeekDirector {
  readonly run: WeekRun;
  private readonly agent: ShowAgent;
  private readonly pace: Pace;
  private readonly now: () => Date;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly controller = new AbortController();
  private readonly products = new Map<string, string>();
  private sims: Simulation[] = [];
  private cast?: Cast;
  private dates?: DatePlan;
  private drift?: DriftPlan;
  /** The amount each step's person meant in the end, to check no committed order is wrong. */
  private meant = new Map<string, number>();
  private done?: Promise<WeekRun>;

  constructor(private readonly o: DirectorOptions) {
    this.pace = o.pace ?? LIVE_PACE;
    this.now = o.now ?? (() => new Date());
    this.sleep = o.sleep ?? defaultSleep;
    const runId = newId("week");
    this.agent = new ShowAgent({ mandateToken: o.mandateToken, agentId: o.kitchen.agentId }, { kitchen: o.kitchen.sandboxId, share: `show-${runId}` }, o.send);
    this.run = {
      runId,
      version: 0,
      kitchen: o.kitchen,
      state: "preparing",
      startedAt: this.now().toISOString(),
      current: -1,
      steps: STEP_ORDER.map(blankStep),
      tally: emptyTally(),
      simulated: [],
      liveCalls: 0,
      catalogue: o.rt.catalogSource.kind === "valio" ? "partner" : "seed",
      source: "live",
    };
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Start playing; resolves with the finished run. Calling it again returns the same promise. */
  play(): Promise<WeekRun> {
    this.done ??= this.playAll();
    return this.done;
  }

  /** Stop the week: the current call finishes, nothing more is asked, and the kitchen is cleaned up. */
  stop(): Promise<WeekRun> {
    this.controller.abort();
    return this.play();
  }

  private changed() {
    this.run.version += 1;
    this.run.tally = this.computeTally();
    this.o.onChange?.(structuredClone(this.run));
  }

  private check() {
    if (this.controller.signal.aborted) throw new Stopped();
  }

  private async pause(ms: number) {
    await this.sleep(ms, this.controller.signal);
    this.check();
  }

  private by(): string {
    return `${this.o.kitchen.approverName} (answer scripted for the demo)`;
  }

  private async playAll(): Promise<WeekRun> {
    try {
      await this.prepare();
      this.run.state = "running";
      this.changed();
      for (let i = 0; i < this.run.steps.length; i++) {
        this.check();
        this.run.current = i;
        const step = this.run.steps[i];
        step.status = "running";
        step.startedAt = this.now().toISOString();
        this.changed();
        await this.pause(this.pace.introMs);
        try {
          await this.playStep(step);
          if (step.status === "running") step.status = "done";
        } catch (err) {
          if (err instanceof Stopped) throw err;
          step.status = "failed";
          step.note = describe(err);
        }
        step.endedAt = this.now().toISOString();
        step.liveCalls = this.liveCallsOf(step.requestIds);
        this.run.liveCalls = this.run.steps.reduce((s, x) => s + x.liveCalls, 0) + (this.cast?.liveCalls ?? 0);
        this.changed();
        await this.pause(step.kind === "lastminute" || step.kind === "refusal" ? this.pace.gateDwellMs : this.pace.dwellMs);
      }
      this.run.state = "finished";
    } catch (err) {
      if (err instanceof Stopped) {
        this.run.state = "cancelled";
        const s = this.run.steps[this.run.current];
        if (s && (s.status === "running" || s.status === "waiting")) {
          s.status = "skipped";
          s.note = "The week was stopped here.";
        }
      } else {
        this.run.state = "failed";
        this.run.error = describe(err);
      }
    } finally {
      for (const s of this.sims) s.undo();
      this.sims = [];
      this.run.cleanup = await this.cleanup().catch((e) => [`Clean-up did not finish: ${describe(e)}`]);
      this.run.endedAt = this.now().toISOString();
      this.changed();
    }
    return structuredClone(this.run);
  }

  // ---------- setting up ----------

  private async prepare() {
    const { rt, kitchen, mandate } = this.o;
    if (!originals.has(kitchen.orgId)) originals.set(kitchen.orgId, structuredClone((await rt.kitchens.getProfile(kitchen.orgId)) ?? null));
    const seed = rt.catalogSource.kind === "seed";
    this.cast = await catalogueLock().run(() => castWeek({ agent: this.agent, catalog: rt.catalog, mandate, now: this.now(), seed, weekdays: [1, 2, 3, 4, 5, 6], by: this.by() }));
    const driftIsMilk = this.cast.drift.id === this.cast.milk.id;
    this.dates = planDates(this.cast.dates, driftIsMilk);
    const driftDate = this.dates.drift;
    this.drift = driftPlan(this.cast.drift.category, this.cast.drift, isoWeekday(driftDate ?? this.dates.stockout));
    for (const p of [this.cast.milk, this.cast.drift, ...this.cast.refusal]) this.products.set(p.id, p.name);
    await rt.kitchens.saveProfile(
      weekProfile({ orgId: kitchen.orgId, name: `${kitchen.name}, ${kitchen.city}`, now: this.now(), milk: this.cast.milk, milkPriceCents: this.cast.milkPriceCents, drift: this.drift, driftPriceCents: this.cast.driftPriceCents, statedBy: `${kitchen.approverName} (${kitchen.roleLabel})` }),
    );
    this.changed();
  }

  // ---------- the days ----------

  private async playStep(step: WeekStep) {
    const d = this.dates!;
    switch (step.kind) {
      case "standing":
        return this.standing(step, d.standing);
      case "slip":
        return this.slip(step, d.slip);
      case "stockout":
        return this.stockout(step, d.stockout);
      case "lastminute":
        return this.lastminute(step, d.lastminute);
      case "drift":
        return this.driftStep(step, d.drift);
      case "refusal":
        return this.refusal(step, d.refusal);
    }
  }

  private async standing(step: WeekStep, date: string | undefined) {
    if (!date) return this.skip(step, "No free delivery day is left inside the kitchen's five-day window today.");
    const milk = this.cast!.milk;
    step.delivery = date;
    step.asked = `Standing order for ${formatDay(date)}: ${USUAL_MILK_LITRES} L of lactose-free milk, same as last time.`;
    this.changed();
    const v = await this.locked(() =>
      this.agent.intakeOpen({ text: step.asked, item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: USUAL_MILK_LITRES, unit: "L" }, deliverBy: date, requiredClaims: ["lactose_free"], optimise: "price", sameAsLastTime: true }, this.by()),
    );
    const view = this.viewOf(v, step);
    this.meant.set(view.requestId, USUAL_MILK_LITRES);
    this.readIntake(step, view);
    step.did.push(view.state === "quoted" ? `Repeated the last order: ${shortName(milk.name)}, from the kitchen's memory, without asking.` : "Read the request against the kitchen's memory.");
    await this.finishIntake(step, view);
  }

  private async slip(step: WeekStep, date: string | undefined) {
    const amount = USUAL_MILK_LITRES * 10;
    const at = date ?? this.dates!.standing ?? this.dates!.lastminute;
    step.delivery = at;
    step.asked = `${amount} L of lactose-free milk for ${formatDay(at)}, cheapest.`;
    this.changed();
    let view = this.viewOf(
      await this.locked(() => this.agent.intakeOpen({ text: step.asked, item: { text: "lactose-free milk", category: "milk" }, quantity: { amount, unit: "L" }, deliverBy: at, requiredClaims: ["lactose_free"], optimise: "price" }, this.by())),
      step,
    );
    const concern = (view.concerns as Json[]).find((c) => c.code === "quantity_tenfold") ?? (view.concerns as Json[])[0];
    if (view.state !== "needs_confirmation" || !concern) {
      step.note = "The mistake check did not stop this one; see the reason below.";
      this.readIntake(step, view);
      return this.finishIntake(step, view);
    }
    const fix = (concern.corrections as Json[])[0];
    step.decisions += 1;
    step.askedPerson += 1;
    step.did.push("Stopped before any price lookup: the amount is ten times the kitchen's usual.");
    step.concern = { code: String(concern.code), message: say(String(concern.message), this.names()), answer: fix ? String(fix.label) : "Confirmed as asked", answeredBy: this.o.kitchen.approverName, scripted: true };
    this.changed();
    await this.pause(this.pace.beatMs);
    if (!date) {
      step.note = "Corrected; not placed, because no other free delivery day is left inside the kitchen's five-day window today.";
      this.meant.set(view.requestId, USUAL_MILK_LITRES);
      return;
    }
    view = this.viewOf(await this.locked(() => this.agent.concerns(view.requestId, this.by(), [{ key: concern.key, choice: fix ? fix.id : "confirm" }])), step);
    this.meant.set(view.requestId, Number(view.need?.quantity?.amount ?? USUAL_MILK_LITRES));
    step.did.push(`Took the answer: ${String(fix?.label ?? "as asked").replace(/^Make it /, "")}.`);
    this.readIntake(step, view);
    await this.finishIntake(step, view);
  }

  private async stockout(step: WeekStep, date: string) {
    const milk = this.cast!.milk;
    step.delivery = date;
    step.asked = `${USUAL_MILK_LITRES} L of lactose-free milk for ${formatDay(date)}, cheapest.`;
    this.changed();
    const view = await this.locked(async () => {
      const sim = simulateStockOut(this.o.rt, { productId: milk.id, productName: shortName(milk.name), kitchenName: this.o.kitchen.name, orgId: this.o.kitchen.orgId, runId: this.run.runId });
      this.sims.push(sim);
      step.simulated.push(sim.label);
      if (!this.run.simulated.includes(sim.label)) this.run.simulated.push(sim.label);
      this.changed();
      try {
        return this.viewOf(
          await this.agent.intakeOpen({ text: step.asked, item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: USUAL_MILK_LITRES, unit: "L" }, deliverBy: date, requiredClaims: ["lactose_free"], optimise: "price" }, this.by()),
          step,
        );
      } finally {
        sim.undo();
        this.sims = this.sims.filter((s) => s !== sim);
      }
    });
    this.meant.set(view.requestId, USUAL_MILK_LITRES);
    const out = (view.excluded as Json[]).some((e) => e.productId === milk.id);
    step.did.push(out ? `Found the usual ${shortName(milk.name)} out of stock (simulated).` : "Looked up the short list live.");
    if ((view.options as Json[]).length) {
      step.decisions += 1;
      step.did.push(`Ranked ${(view.options as Json[]).length} alternatives good, better, best; every one keeps the kitchen's rule (lactose-free).`);
    }
    this.readIntake(step, view);
    await this.finishIntake(step, view);
  }

  private async lastminute(step: WeekStep, date: string) {
    // Big enough to be over the €500 the agent may spend alone at the cheapest live price seen (about €1 a litre),
    // and under eight times the usual, so it is not mistaken for a slip of a zero.
    const litres = Math.round(USUAL_MILK_LITRES * 7.75);
    step.delivery = date;
    step.asked = `A conference just booked breakfast for 300 guests: ${litres} L of lactose-free milk for ${formatDay(date)}, cheapest that can make it.`;
    this.changed();
    const view = this.viewOf(
      await this.locked(() => this.agent.intakeOpen({ text: step.asked, item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: litres, unit: "L" }, deliverBy: date, requiredClaims: ["lactose_free"], optimise: "price" }, this.by())),
      step,
    );
    this.meant.set(view.requestId, litres);
    const late = (view.excluded as Json[]).filter((e) => e.code === "cutoff_passed" || e.code === "too_late");
    step.did.push(late.length ? `Dropped ${late.length} product${late.length === 1 ? "" : "s"} whose order cut-off for ${dayText(date)} has passed.` : `Checked what can still arrive by ${dayText(date)}.`);
    this.readIntake(step, view);
    await this.finishIntake(step, view, this.o.signOffTimeoutMs ?? SIGNOFF_TIMEOUT_MS);
  }

  private async driftStep(step: WeekStep, date: string | undefined) {
    const drift = this.drift!;
    const at = date ?? this.dates!.stockout;
    const last = drift.amounts.at(-1)!;
    const name = shortName(drift.product.name);
    step.delivery = at;
    step.asked = `Renew the ${weekdayName(drift.weekday)} standing order: ${last} L of ${name}, same as last time.`;
    step.memory.push(`Agreed with ${this.o.kitchen.approverName}: about ${drift.agreed} L every ${weekdayName(drift.weekday)}.`, `The last orders: ${drift.amounts.map((a) => `${a} L`).join(", ")}.`);
    this.changed();
    let view = this.viewOf(
      await this.locked(() => this.agent.intakeOpen({ text: step.asked, item: { text: name, category: drift.family }, quantity: { amount: last, unit: drift.product.unit }, deliverBy: at, requiredClaims: this.o.mandate.requiredAttributes, optimise: "price", sameAsLastTime: true }, this.by())),
      step,
    );
    const concern = (view.concerns as Json[]).find((c) => c.code === "standing_order_range") ?? (view.concerns as Json[])[0];
    if (view.state !== "needs_confirmation" || !concern) {
      step.note = "The standing-order check did not stop this renewal; see the reason below.";
      this.meant.set(view.requestId, last);
      this.readIntake(step, view);
      return this.finishIntake(step, view);
    }
    const fix = (concern.corrections as Json[])[0];
    step.decisions += 1;
    step.askedPerson += 1;
    step.did.push(`Did not renew: the order has crept from ${drift.agreed} L to ${last} L, outside the standing order's range.`);
    step.concern = { code: String(concern.code), message: say(String(concern.message), this.names()), answer: fix ? String(fix.label) : "Renew as asked", answeredBy: this.o.kitchen.approverName, scripted: true };
    this.changed();
    await this.pause(this.pace.beatMs);
    if (!date) {
      step.note = "Asked; not placed, because no free delivery day is left inside the kitchen's five-day window today.";
      this.meant.set(view.requestId, drift.agreed);
      return;
    }
    view = this.viewOf(await this.locked(() => this.agent.concerns(view.requestId, this.by(), [{ key: concern.key, choice: fix ? fix.id : "confirm" }])), step);
    this.meant.set(view.requestId, Number(view.need?.quantity?.amount ?? drift.agreed));
    step.did.push(`Renewed at the agreed amount: ${String(fix?.label ?? "").replace(/^Make it (the usual )?/, "") || `${drift.agreed} L`}.`);
    this.readIntake(step, view);
    await this.finishIntake(step, view);
  }

  private async refusal(step: WeekStep, date: string) {
    const products = this.cast!.refusal;
    step.delivery = date;
    const forbidden = this.o.mandate.forbiddenAllergens;
    if (!products.length) return this.skip(step, "The catalogue has no product in an allowed group with a forbidden allergen today.");
    for (const p of products) {
      const bad = p.allergens.filter((a) => forbidden.includes(a));
      step.asked = `The ${shortName(this.cast!.drift.name)} is short: send ${shortName(p.name)} instead, 12 L for ${formatDay(date)}.`;
      step.did = [`A deliberate test: the script sends ${shortName(p.name)}, which contains ${bad.join(" and ")}, straight to the gate, skipping the agent's own checks.`];
      this.changed();
      const done = await this.locked(async () => {
        const req = await this.agent.openRequest(step.asked, date, [this.cast!.drift.id]);
        if (req.status !== 201) throw new Error(req.body.error?.message ?? `HTTP ${req.status}`);
        const requestId = String(req.body.request.requestId);
        step.requestIds.push(requestId);
        const q = await this.agent.quote(requestId, [{ productId: p.id, quantity: Math.max(1, Math.round(12 / p.packSize)) }]);
        if (q.status !== 201) return { quoteRefused: q };
        const placed = await this.agent.placeOrder(requestId, q.body.quoteToken, orderLines(q.body.quote));
        return { placed };
      });
      if ("quoteRefused" in done && done.quoteRefused) {
        if (p !== products.at(-1) && done.quoteRefused.body.error?.rule === "quote_availability") continue; // not in stock today: try the next one
        step.refused += 1;
        step.decisions += 1;
        step.gate = refusalGate(done.quoteRefused.body.error, this.o.kitchen.perOrderLimitCents);
        return;
      }
      const order = done.placed!.body.order as Json | undefined;
      if (!order) throw new Error(done.placed!.body.error?.message ?? `HTTP ${done.placed!.status}`);
      this.readOrder(step, order);
      step.decisions += 1;
      if (order.status === "rejected") step.refused += 1;
      return;
    }
  }

  // ---------- shared mechanics ----------

  private skip(step: WeekStep, why: string) {
    step.status = "skipped";
    step.note = why;
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    this.check();
    return catalogueLock().run(fn);
  }

  private viewOf(reply: { status: number; body: Json }, step: WeekStep): Json {
    const v = reply.body.step as Json | undefined;
    if (!v) throw new Error(reply.body.error?.message ?? `HTTP ${reply.status}`);
    if (!step.requestIds.includes(v.requestId)) step.requestIds.push(v.requestId);
    return v;
  }

  private names(): Record<string, string> {
    return Object.fromEntries(this.products);
  }

  /** Copy what the intake decided onto the step: memory, options, what was left out and why. */
  private readIntake(step: WeekStep, v: Json) {
    for (const p of [...(v.options as Json[]).flatMap((o) => o.lines as Json[]), ...(v.excluded as Json[])]) if (p.name) this.products.set(p.productId, p.name);
    const memory = [
      ...(v.rules as Json[]).filter((r) => r.source === "stated").map((r) => String(r.text)),
      ...(v.fromMemory as Json[]).map((m) => `${String(m.question?.text ?? "")} ${String(m.label ?? "")}`.trim()),
    ];
    for (const m of memory) if (!step.memory.includes(m)) step.memory.push(m);
    const chosen = v.chosen?.optionId;
    step.options = (v.options as Json[]).slice(0, 3).map(
      (o): OptionView => ({
        rank: o.rank,
        match: o.match,
        labels: o.labels,
        title: String(o.title),
        totalCents: o.totalCents,
        delivery: o.deliveryDate,
        lines: (o.lines as Json[]).map((l) => ({ name: shortName(String(l.name)), packs: l.packs, amount: `${Math.round(l.packs * l.packSize * 100) / 100} ${l.unit}` })),
        chosen: o.optionId === chosen,
        pros: (o.pros as string[]).slice(0, 2).map((t) => say(t, this.names())),
        cons: (o.cons as string[]).slice(0, 2).map((t) => say(t, this.names())),
      }),
    );
    const simulatedId = step.simulated.length ? this.cast!.milk.id : undefined;
    // What availability took away (sold out, cut-off passed, too late): the products of another kind are left out.
    step.excluded = (v.excluded as Json[])
      .filter((e) => e.code && e.code !== "compromise" && e.code !== "blocked")
      .slice(0, 4)
      .map((e): ExcludedView => ({ name: shortName(this.products.get(e.productId) ?? String(e.productId)), reason: say(String(e.reason), this.names()), code: e.code, simulated: e.productId === simulatedId }));
    this.changed();
  }

  /** From the intake's last state to a decided order: choose when the agent may, quote, place, wait if needed. */
  private async finishIntake(step: WeekStep, v: Json, signOffTimeoutMs = this.o.sideSignOffTimeoutMs ?? 12_000): Promise<void> {
    if (v.state === "needs_confirmation" && (v.concerns as Json[]).length) {
      // A check the plan did not expect (live prices moved, say): confirm it as asked, scripted and labelled. A
      // confirmation that matters, relayed by an agent, sends the order to the named person (policy human_confirmation).
      const c = (v.concerns as Json[])[0];
      step.concern ??= { code: String(c.code), message: say(String(c.message), this.names()), answer: c.confirmable ? "Yes, that is what we need" : String(c.corrections?.[0]?.label ?? ""), answeredBy: this.o.kitchen.approverName, scripted: true };
      step.askedPerson += 1;
      step.decisions += 1;
      step.did.push("Asked the kitchen to confirm before going on (answer scripted for the demo).");
      this.changed();
      await this.pause(this.pace.beatMs);
      v = this.viewOf(await this.locked(() => this.agent.concerns(v.requestId, this.by(), (v.concerns as Json[]).map((x) => ({ key: x.key, choice: x.confirmable ? "confirm" : (x.corrections?.[0]?.id ?? "confirm") })))), step);
      this.readIntake(step, v);
      return this.finishIntake(step, v, signOffTimeoutMs);
    }
    if (v.state === "options_ready") {
      const pick = v.preselected?.optionId ?? (v.options as Json[]).find((o) => o.match === "full")?.optionId ?? (v.options as Json[])[0]?.optionId;
      v = this.viewOf(await this.locked(() => this.agent.choose(v.requestId, this.by(), pick)), step);
      step.did.push("Chose the option the kitchen's goal ranks first (best price).");
      this.readIntake(step, v);
    } else if (v.state === "needs_input") {
      v = this.viewOf(await this.locked(() => this.agent.answers(v.requestId, this.by(), (v.questions as Json[]).map((q) => ({ questionId: q.id, optionId: q.options[0].id })))), step);
      step.askedPerson += 1;
      step.did.push("Asked the kitchen one question (answer scripted for the demo).");
      this.readIntake(step, v);
      if (v.state === "options_ready") return this.finishIntake(step, v, signOffTimeoutMs);
    }
    if (v.state !== "quoted" || !v.quote) {
      step.note = say((v.notes as string[])[0] ?? `The request ended as ${String(v.state).replaceAll("_", " ")}.`, this.names());
      return;
    }
    const q = v.quote as Json;
    step.did.push(`Got a fixed price, signed by the wholesaler: ${moneyShort(q.quote.totalCents)}.`);
    this.changed();
    const placed = await this.locked(() => this.agent.placeOrder(v.requestId, q.quoteToken, orderLines(q.quote)));
    const order = placed.body.order as Json | undefined;
    if (!order) {
      step.gate = refusalGate(placed.body.error, this.o.kitchen.perOrderLimitCents);
      step.refused += 1;
      step.decisions += 1;
      return;
    }
    this.readOrder(step, order);
    step.decisions += 1;
    if (order.status === "pending_approval") await this.waitForPerson(step, order, signOffTimeoutMs);
    if (order.status === "rejected") step.refused += 1;
  }

  private readOrder(step: WeekStep, order: Json) {
    if (!step.orderIds.includes(order.orderId)) step.orderIds.push(order.orderId);
    for (const l of order.lines as Json[]) this.products.set(l.productId, l.name);
    const d = order.decision as Json;
    const rules = (d.rules as Json[]).map((r) => ({ rule: String(r.rule), outcome: r.outcome as "pass" | "escalate" | "fail" }));
    const deciding = rules.find((r) => r.outcome === "fail") ?? rules.find((r) => r.outcome === "escalate");
    step.gate = { outcome: d.outcome, rule: deciding?.rule, reasons: (d.reasons as string[]).map((r) => say(r, this.names())), checks: rules, totalCents: d.totalCents, limitCents: this.o.kitchen.perOrderLimitCents };
    step.order = orderView(order);
    this.changed();
  }

  /** The gate stopped it for a person: wait for their decision (live event), or withdraw after the timeout. */
  private async waitForPerson(step: WeekStep, order: Json, timeoutMs: number) {
    const a = order.approval as Json;
    step.askedPerson += 1;
    const askedAt = this.now();
    step.status = "waiting";
    this.run.state = "waiting_signoff";
    step.signOff = {
      approverName: a.approver.name,
      roleLabel: roleLabel(a.approver.role),
      state: "waiting",
      askedAt: askedAt.toISOString(),
      deadline: new Date(askedAt.getTime() + timeoutMs).toISOString(),
      phone: this.o.kitchen.passkey,
    };
    step.did.push(`Sent to ${a.approver.name}'s phone. The agent cannot approve its own order.`);
    this.changed();
    const final = await this.decisionOf(String(order.orderId), timeoutMs);
    this.run.state = "running";
    step.status = "running";
    if (!final) {
      // Nobody signed: the agent takes the order back, so nothing is bought without the person.
      const w = await this.agent.withdraw(String(order.orderId), `Nobody signed within ${Math.round(timeoutMs / 1000)} s.`, "the show's timeout");
      const o = (w.body.order as Json | undefined) ?? (await this.agent.getOrder(String(order.orderId))).body.order;
      if (o && o.status !== "withdrawn") {
        // Decided in the last moment after all.
        this.applyDecision(step, o);
        return;
      }
      step.signOff.state = "timed_out";
      step.order = o ? orderView(o) : step.order;
      step.did.push(`Nobody signed within ${Math.round(timeoutMs / 1000)} s, so the agent withdrew the order. Nothing was bought without a person.`);
      this.changed();
      return;
    }
    this.applyDecision(step, final.order, final.seenAt);
  }

  private applyDecision(step: WeekStep, o: Json, seenAt = this.now().toISOString()) {
    const a = o.approval as Json | undefined;
    const so = step.signOff!;
    so.decidedAt = a?.decidedAt;
    so.seenAt = seenAt;
    so.method = a?.signOff?.method;
    so.verified = a?.signOff?.verified;
    so.state = o.status === "committed" ? "approved" : o.status === "declined" ? "declined" : o.status === "rejected" ? "rejected" : o.status === "withdrawn" ? "withdrawn" : o.status === "expired" ? "expired" : "approved";
    step.order = orderView(o);
    if (o.status === "committed") step.did.push(`${so.approverName} approved with ${so.method === "passkey" ? "a passkey" : so.method ?? "a sign-off"} at ${clock(so.decidedAt ?? seenAt)}. The wholesaler signed the order.`);
    else if (o.status === "declined") step.did.push(`${so.approverName} declined it. Nothing was ordered.`);
    else if (o.status === "rejected") {
      step.did.push("Approved, but the gate's re-check refused it: nothing was ordered.");
      this.readOrder(step, o);
    }
    this.changed();
  }

  /** The order's decided state, as soon as the person decides (live event), or undefined after the timeout. */
  private decisionOf(orderId: string, timeoutMs: number): Promise<{ order: Json; seenAt: string } | undefined> {
    const { rt } = this.o;
    return new Promise((resolve) => {
      let settled = false;
      let polling = false;
      const finish = (v: { order: Json; seenAt: string } | undefined) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        clearInterval(poll);
        clearTimeout(timer);
        resolve(v);
      };
      const look = async () => {
        if (polling || settled) return;
        polling = true;
        try {
          const o = (await this.agent.getOrder(orderId)).body.order as Json | undefined;
          if (o && o.status !== "pending_approval") finish({ order: o, seenAt: this.now().toISOString() });
        } finally {
          polling = false;
        }
      };
      const unsubscribe = rt.events.subscribe(
        (e: DockEvent) => e.orderId === orderId && e.type !== "approval_requested",
        () => void look(),
      );
      const poll = setInterval(() => void look(), 1000);
      const timer = setTimeout(() => finish(undefined), timeoutMs);
      this.controller.signal.addEventListener("abort", () => finish(undefined), { once: true });
    });
  }

  private liveCallsOf(requestIds: string[]): number {
    let n = 0;
    for (const id of requestIds) for (const e of this.o.rt.dock.ledger.entries({ requestId: id })) if (e.type === "lookup") n += Number((e.data as { liveCalls?: number }).liveCalls ?? 0);
    return n;
  }

  private computeTally(): Tally {
    const t = emptyTally();
    for (const s of this.run.steps) {
      t.decisions += s.decisions;
      t.askedPerson += s.askedPerson;
      t.refused += s.refused;
      if (s.order?.status === "committed") {
        t.committed += 1;
        t.spentCents += s.order.totalCents;
        const meant = s.requestIds.map((r) => this.meant.get(r)).find((x) => x !== undefined);
        const got = s.order.lines.reduce((sum, l) => sum + Number(l.amount.split(" ")[0]), 0);
        // Wrong: an order the gate should not have let through, or an amount other than what the person meant
        // (packs round up, so up to one pack over is right).
        const failed = s.gate?.checks.some((c) => c.outcome === "fail");
        const pack = Math.max(...s.order.lines.map((l) => Number(l.amount.split(" ")[0]) / Math.max(1, l.packs)));
        if (failed || (meant !== undefined && (got < meant - 0.01 || got > meant + pack + 0.01))) t.wrongOrders += 1;
      }
    }
    return t;
  }

  /** Put the kitchen back: withdraw what still waits, restore its own past, lift the show's simulations. */
  private async cleanup(): Promise<string[]> {
    const notes: string[] = [];
    for (const s of this.run.steps) {
      for (const id of s.orderIds) {
        const o = (await this.agent.getOrder(id)).body.order as Json | undefined;
        if (o?.status === "pending_approval") {
          const w = await this.agent.withdraw(id, "The week ended before anyone signed.", "the show's clean-up");
          if (w.status === 200) {
            notes.push(`Withdrew ${moneyShort(o.totalCents)} still waiting for sign-off.`);
            s.order = orderView(w.body.order as Json);
            if (s.signOff && s.signOff.state === "waiting") s.signOff.state = "withdrawn";
          }
        }
      }
    }
    const original = originals.get(this.o.kitchen.orgId);
    if (original) await this.o.rt.kitchens.saveProfile(structuredClone(original));
    notes.push(original ? "Put back the kitchen's own past orders and memory." : "The kitchen had no past of its own; the week's past stays.");
    return notes;
  }
}

function orderView(o: Json): OrderView {
  return {
    orderId: o.orderId,
    status: o.status,
    totalCents: o.totalCents,
    lines: (o.lines as Json[]).map((l) => ({ name: shortName(String(l.name)), packs: l.quantity, amount: `${Math.round(l.quantity * l.packSize * 100) / 100} ${l.unit}`, delivery: l.deliveryDate })),
  };
}

function refusalGate(error: Json | undefined, limitCents: number): GateView {
  return { outcome: "reject", rule: error?.rule, reasons: [say(String(error?.message ?? "Refused."))], checks: [], totalCents: 0, limitCents };
}

function weekdayName(d: number): string {
  return ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][d];
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
