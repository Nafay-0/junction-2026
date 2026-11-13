/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: probes read untyped JSON replies. */
/**
 * Intake: mistake checks, questions, option cards; unit and pack conversion; dates; kitchen memory.
 * REST with minted mandates (Kaari has six weeks of history and a stated "always lactose-free" rule; Laakso has none).
 */
import { kaariAgent, laaksoAgent } from "../lib/actors";
import { driveIntake } from "../lib/intake";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import type { Http } from "../lib/http";
import { pick, type Probe } from "../lib/probe";

const BIG = { weeklyBudgetCents: 1_000_000_000, perOrderLimitCents: 1_000_000_00 };
const callOf = (a: Http) => (method: "GET" | "POST", path: string, body?: unknown) => (method === "GET" ? a.get(path) : a.post(path, body));
const today = () => localNow(new Date()).date;
/** The next date (after today) on one of these ISO weekdays. */
function nextWeekday(days: number[], from = today()): string {
  let d = addDaysIso(from, 1);
  while (!days.includes(isoWeekday(d))) d = addDaysIso(d, 1);
  return d;
}

export const intakeProbes: Probe[] = [
  {
    id: "intake.tenfold_confirmed_by_agent",
    area: "intake",
    kind: "authority",
    title: "A tenfold slip waits for the buyer, but the agent itself can 'confirm' it in any person's name",
    findings: ["F-HUMAN-INPUT-BY-AGENT"],
    cases: 3,
    async run({ http, check }) {
      const a = await kaariAgent(http, BIG);
      const call = callOf(a);
      const need = { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy: nextWeekday([1, 4]) };
      const open = await call("POST", "/api/v1/intake", { need, by: "agent" });
      const step = open.body?.step;
      const tenfold = step?.concerns?.find((c: { code: string }) => c.code === "quantity_tenfold" || c.code === "quantity_unusual");
      check.expect(step?.state === "needs_confirmation" && tenfold, `1,000 L for a ~100 L kitchen did not stop for confirmation: ${step?.state} ${step?.concerns?.map((c: { code: string }) => c.code)}`);
      if (!tenfold) return;
      // The quote/order calls refuse while the concern is open (this holds):
      const q = await a.post("/api/v1/quotes", { requestId: step.requestId, lines: [{ productId: "VA-1010", quantity: 1 }] });
      check.expect(q.status === 409 && q.body?.error?.rule === "human_input", `quote during confirmation: ${q.status} ${q.body?.error?.rule}`);
      // ...but the agent answers the human-input step itself, in the head chef's name:
      const c = await call("POST", `/api/v1/intake/${step.requestId}/concerns`, { by: "Sanna Koskinen (head chef)", responses: [{ key: tenfold.key, choice: tenfold.confirmable ? "confirm" : tenfold.corrections[0].id }] });
      const ledger = await http.get(`/api/v1/ledger?requestId=${step.requestId}`);
      const entry = (ledger.body?.entries ?? []).find((e: { actor: string; summary: string }) => /confirmed as intended/.test(e.summary));
      check.expect(!(c.status === 200 && entry), `the agent confirmed the tenfold slip with only its mandate; the ledger records it as "${entry?.actor}: ${entry?.summary?.slice(0, 90)}..." (state now ${c.body?.step?.state})`);
    },
  },
  {
    id: "intake.conversion_grid",
    area: "conversion",
    kind: "boundary",
    title: "Amounts in L, kg, pcs and packs: every card delivers at least what was asked and never a whole pack extra; money adds up; committed = quoted = card",
    async run({ http, check, rng }) {
      const amounts = [1, 3, 7, 9.5, 10, 12.5, 19, 20, 99, 100, 101, 250, 333, 999];
      const asks = [
        ...amounts.map((n) => ({ item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: n, unit: "L" } })),
        { item: { text: "lactose-free cream", category: "cream" }, quantity: { amount: 6, unit: "L" } },
        { item: { text: "yoghurt", category: "yoghurt" }, quantity: { amount: 5, unit: "kg" } },
        { item: { text: "yoghurt", category: "yoghurt" }, quantity: { amount: 2.5, unit: "kg" } },
        { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 20, unit: "pack" } },
        { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 12, unit: "pcs" } },
      ];
      let cases = 0;
      for (const need of asks) {
        const a = await laaksoAgent(http, BIG);
        const deliverBy = nextWeekday([1, 2, 3, 4, 5]);
        const t = await driveIntake(callOf(a), { ...need, deliverBy, optimise: pick(rng, ["price", "unstated", "reliability"]) }, { choose: "first", onConcern: "confirm" });
        cases++;
        for (const p of t.problems) check.expect(false, `${need.quantity.amount} ${need.quantity.unit} ${need.item.text}: ${p}`);
        const last = t.steps.at(-1);
        if (last && /http_5|order_undefined/.test(last.state)) check.expect(false, `${need.quantity.amount} ${need.quantity.unit}: ended at ${last.state} ${last.code}`);
        check.note(`${need.quantity.amount} ${need.quantity.unit} ${need.item.category}: ${t.steps.map((s) => s.state + (s.code ? `(${s.code})` : "")).join(" > ")}${t.order ? ` | ${t.order.lines.map((l: any) => `${l.quantity}x${l.productId}`).join("+")}` : ""}`);
      }
      return { cases };
    },
  },
  {
    id: "intake.dates",
    area: "dates",
    kind: "boundary",
    title: "Past, today, Sunday, far-future and impossible dates: a typed concern or a 4xx, never an order for the wrong day",
    cases: 6,
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const call = callOf(a);
      const base = { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 20, unit: "L" } };
      const t = today();
      const cases: [string, string, (s: any, status: number) => boolean][] = [
        ["yesterday", addDaysIso(t, -1), (s) => s?.state === "needs_confirmation" && s.concerns.some((c: any) => c.code === "delivery_in_past")],
        ["today", t, (s) => s?.state !== "quoted" || s.quote.quote.lines.every((l: any) => l.deliveryDate <= t)],
        ["next Sunday", nextWeekday([7]), (s) => s?.state === "needs_confirmation" || s?.state === "no_options" || (s?.options ?? []).every((o: any) => o.deliveryDate <= nextWeekday([7]) || o.givesUp.some((g: any) => g.part === "delivery_date"))],
        ["in 60 days", addDaysIso(t, 60), (s) => (s?.options ?? []).every((o: any) => o.deliveryDate <= addDaysIso(t, 6))],
        ["2026-02-30", "2026-02-30", (_s, st) => st === 400],
        ["not a date", "Monday", (_s, st) => st === 400],
      ];
      for (const [name, deliverBy, ok] of cases) {
        const r = await call("POST", "/api/v1/intake", { need: { ...base, deliverBy }, by: "qa" });
        check.expect(r.status < 500, `${name}: ${r.status}`);
        check.expect(ok(r.body?.step, r.status), `${name} (${deliverBy}): state ${r.body?.step?.state ?? r.status} ${JSON.stringify(r.body?.step?.concerns?.map((c: any) => c.code) ?? r.body?.error?.code)} options ${(r.body?.step?.options ?? []).map((o: any) => o.deliveryDate).join(",")}`);
      }
    },
  },
  {
    id: "intake.sequence",
    area: "intake",
    kind: "sequence",
    title: "Steps out of order, twice and concurrently: choose twice, answer after quoting, concurrent choices",
    cases: 4,
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const call = callOf(a);
      const open = await call("POST", "/api/v1/intake", { need: { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 30, unit: "L" }, deliverBy: nextWeekday([1, 2, 3, 4, 5]) }, by: "qa" });
      let step = open.body?.step;
      if (step?.state === "needs_input") step = (await call("POST", `/api/v1/intake/${step.requestId}/answers`, { by: "qa", answers: step.questions.map((q: any) => ({ questionId: q.id, optionId: q.options[0].id })) })).body?.step;
      if (step?.state !== "options_ready") return void check.note(`did not reach options_ready: ${step?.state}`);
      const id = step.requestId;
      const [c1, c2] = await Promise.all([0, 1].map((i) => call("POST", `/api/v1/intake/${id}/choice`, { by: "qa", optionId: step.options[Math.min(i, step.options.length - 1)].optionId })));
      const quoted = [c1, c2].filter((r) => r.status === 200 && r.body?.step?.state === "quoted");
      check.expect(quoted.length <= 1, `two concurrent choices both produced quotes (${quoted.map((r) => r.body.step.quote.quote.quoteId).join(", ")}): the agent holds two valid quote tokens for one need`);
      if (quoted.length === 2) {
        const placed = await Promise.all(quoted.map((r) => call("POST", "/api/v1/orders", r.body.step.next.example)));
        const ok = placed.filter((r) => ["committed", "pending_approval"].includes(r.body?.order?.status));
        check.expect(ok.length <= 1, `both quotes became orders for one intake: ${placed.map((r) => r.body?.order?.status).join(", ")}`);
      }
      const again = await call("POST", `/api/v1/intake/${id}/choice`, { by: "qa", optionId: step.options[0].optionId });
      check.expect(again.status === 409, `choose after quoted: ${again.status}`);
      const ans = await call("POST", `/api/v1/intake/${id}/answers`, { by: "qa", answers: [{ questionId: "optimise", optionId: "price" }] });
      check.expect(ans.status === 409, `answer after quoted: ${ans.status} ${ans.body?.error?.code}`);
      const con = await call("POST", `/api/v1/intake/${id}/concerns`, { by: "qa", responses: [{ key: "x", choice: "confirm" }] });
      check.expect(con.status === 409, `concerns after quoted: ${con.status}`);
    },
  },
  {
    id: "intake.hostile_need",
    area: "intake",
    kind: "hostile",
    title: "Hostile structured needs: markup, control characters, long strings, path-like categories, injected product ids",
    cases: 9,
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const call = callOf(a);
      const base = { quantity: { amount: 10, unit: "L" } };
      const needs: [string, unknown][] = [
        ["markup in item", { ...base, item: { text: '<img src=x onerror="alert(1)">milk', category: "milk" } }],
        ["200 emoji", { ...base, item: { text: "🥛".repeat(100), category: "milk" } }],
        ["201 chars", { ...base, item: { text: "m".repeat(201), category: "milk" } }],
        ["path category", { ...base, item: { text: "milk", category: "../../etc/passwd" } }],
        ["sql product", { ...base, item: { text: "milk", productId: "' OR 1=1 --" } }],
        ["proto pollution", JSON.parse('{"item":{"text":"milk","category":"milk","__proto__":{"admin":true}},"quantity":{"amount":10,"unit":"L"}}')],
        ["11 claims", { ...base, item: { text: "milk", category: "milk" }, requiredClaims: Array.from({ length: 11 }, (_, i) => `c${i}`) }],
        ["unit gallon", { item: { text: "milk", category: "milk" }, quantity: { amount: 10, unit: "gallon" } }],
        ["wanted and excluded", { ...base, item: { text: "milk", category: "milk", attributes: ["organic"], excludedAttributes: ["organic"] } }],
      ];
      for (const [name, need] of needs) {
        const r = await call("POST", "/api/v1/intake", { need, by: "qa" });
        check.expect(r.status < 500, `${name}: ${r.status} ${r.text.slice(0, 120)}`);
        if (r.status >= 400) check.expect(!!r.body?.error?.code, `${name}: no error code`);
      }
    },
  },
  {
    id: "intake.allergen_and_claims",
    area: "intake",
    kind: "plausible",
    title: "A forbidden allergen or required claim the request states is obeyed by every option and by the committed order",
    cases: 3,
    async run({ http, check }) {
      const asks: [string, Record<string, unknown>, (l: any) => boolean][] = [
        ["organic", { requiredClaims: ["organic"] }, (p) => p.productId === "VA-1201"],
        ["no milk allergen (milk!)", { forbiddenAllergens: ["milk"] }, () => false],
        ["vegan oat drink", { item: { text: "oat drink", category: "plant_drink" }, requiredClaims: ["vegan"] }, (p) => p.productId === "PK-4001"],
      ];
      for (const [name, extra, okLine] of asks) {
        const a = await laaksoAgent(http, BIG);
        const need = { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 10, unit: "L" }, deliverBy: nextWeekday([1, 2, 3, 4, 5]), ...extra };
        const t = await driveIntake(callOf(a), need, { onConcern: "confirm" });
        const lines = (t.final?.options ?? []).flatMap((o: any) => o.lines);
        check.expect(lines.every(okLine), `${name}: an option offers ${lines.filter((l: any) => !okLine(l)).map((l: any) => l.productId).join(", ")}`);
        if (t.order) check.expect(t.order.lines.every(okLine), `${name}: committed ${t.order.lines.map((l: any) => l.productId)}`);
        check.note(`${name}: ${t.steps.map((s) => s.state).join(" > ")}${t.final?.notes?.[0] ? ` | ${t.final.notes[0].slice(0, 120)}` : ""}`);
      }
    },
  },
  {
    id: "memory.same_as_last_time",
    area: "memory",
    kind: "plausible",
    title: "Kaari 'same as last time' repeats the last milk order without a question and respects the stated lactose-free rule",
    async run({ http, check }) {
      const a = await kaariAgent(http, BIG);
      const t = await driveIntake(callOf(a), { item: { text: "milk", category: "milk" }, sameAsLastTime: true, deliverBy: nextWeekday([1, 4]) }, { placeOrder: false });
      check.expect(t.steps.every((s) => s.state !== "needs_input"), `same as last time asked a question: ${t.steps.map((s) => s.state).join(" > ")}`);
      const lines = t.quote?.quote?.lines ?? t.final?.options?.flatMap((o: any) => o.lines) ?? [];
      check.expect(lines.length > 0 && lines.every((l: any) => (l.attributes ?? ["lactose_free"]).includes("lactose_free")), `not lactose-free or nothing offered: ${JSON.stringify(lines.map((l: any) => l.productId))}`);
      check.note(`same as last time: ${t.steps.map((s) => s.state).join(" > ")} ${t.final?.notes?.join(" | ")?.slice(0, 200)}`);
    },
  },
];
