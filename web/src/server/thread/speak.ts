import type { TurnRun } from "./pipeline";
import { subjectLine, subjectOf } from "./subject";
import type { Card, GatePreview } from "./types";

/**
 * What the agent may say this turn, as plain data from the cards the engine made (never from the model): the facts its
 * two to four sentences are written from, and checked against. Short, in units a person says (euros with cents,
 * litres, days as dates), with the decision that is open now so the reply can end on it.
 */

const eur = (cents: number) => (cents / 100).toFixed(2);

function gateWords(g: Partial<GatePreview> | undefined, totalCents?: number): Record<string, unknown> | undefined {
  if (!g?.outcome) return undefined;
  const rules = g.rules ?? [];
  const limit = rules.find((r) => r.rule === "per_order_limit")?.details?.limitCents;
  const deciding = rules.find((r) => r.outcome === "fail") ?? rules.find((r) => r.outcome === "escalate");
  return {
    outcome: g.outcome === "auto_approve" ? "inside the kitchen's rules: the agent may order it alone" : g.outcome === "needs_human_approval" ? `needs ${g.approver?.name ?? "a named person"}'s OK on their phone` : "the kitchen's rules do not allow it",
    ...(typeof limit === "number" ? { spendAloneLimitEur: eur(limit) } : {}),
    ...(g.outcome !== "auto_approve" && (g.reasons?.[0] ?? deciding?.rule) ? { because: g.reasons?.[0] ?? deciding?.rule } : {}),
    ...(totalCents !== undefined ? { totalEur: eur(totalCents) } : {}),
  };
}

/** The deposit on an option's packs (refunded on return, no VAT), said as one clause on the total. */
const deposit = (o: { lines: { quantity: number; depositCents?: number }[] }) => o.lines.reduce((n, l) => n + (l.depositCents ?? 0) * l.quantity, 0);

/** "before VAT, 14 %", once for the options when they share the rate. */
function vatOf(options: { lines: { taxRatePct?: number }[] }[]): string | undefined {
  const rates = [...new Set(options.flatMap((o) => o.lines.map((l) => l.taxRatePct)).filter((x): x is number => x !== undefined))];
  return rates.length === 1 ? `${rates[0]} % VAT on top` : rates.length > 1 ? `VAT on top (${rates.join(" %, ")} %)` : undefined;
}

function cardFacts(c: Card): Record<string, unknown> | undefined {
  switch (c.type) {
    case "understood":
      return { read: { item: c.item, ...(c.amount ? { amount: `${c.amount.amount} ${c.amount.unit}` } : {}), ...(c.deliverOn ? { deliverOn: c.deliverOn } : c.deliverBy ? { deliverBy: c.deliverBy } : {}), ...(c.claims.length ? { mustBe: c.claims } : {}) } };
    case "anomaly":
      return c.answered ? undefined : { check: c.concerns.map((k) => k.message), ask: "a yes, or one of the corrections" };
    case "question":
      return { ask: c.questions.filter((q) => !c.answered?.[q.id]).slice(0, 1).map((q) => ({ question: q.text, choices: q.options.map((o) => o.label) })) };
    case "options": {
      if (c.chosen || c.adjusted) return undefined;
      // Only what can be ordered is a choice; one the rules refuse is said as missing, with why.
      const can = c.options.filter((o) => o.gate?.outcome !== "reject").slice(0, 3);
      const cannot = c.options.filter((o) => o.gate?.outcome === "reject").slice(0, 2);
      return {
        options: can.map((o, i) => {
          const usual = o.reasons.find((r) => r.code === "instead_of_usual");
          return {
            n: i + 1,
            title: o.title,
            packs: o.lines.map((l) => `${l.quantity} × ${l.packSize ?? 1} ${l.unit ?? ""}`.trim()).join(" + "),
            totalEur: eur(o.totalCents),
            delivery: o.deliveryDate,
            ...(o.orderBy ? { orderBy: o.orderBy } : {}),
            ...(o.match === "compromise" ? { notExactly: o.givesUp.join("; ") } : {}),
            ...(usual ? { insteadOfUsual: usual.params } : {}),
            ...(deposit(o) ? { plusDepositEur: eur(deposit(o)) } : {}),
            ...(o.reasons.find((r) => r.code === "nutrition_vs") ? { nutritionAgainstUsual: o.reasons.find((r) => r.code === "nutrition_vs")!.params } : {}),
            ...(o.reasons.find((r) => r.code === "wholesaler_lists") ? { wholesalerListsItAsSubstitute: true } : {}),
            ...(o.reasons.find((r) => r.code === "label_missing") ? { lacksPreferredLabel: o.reasons.find((r) => r.code === "label_missing")!.params.labels } : {}),
            ...(o.gate ? { gate: gateWords(o.gate as Partial<GatePreview>) } : {}),
          };
        }),
        ...(vatOf(can) ? { pricesBeforeVat: vatOf(can) } : {}),
        ...(c.excluded.some((e) => e.code === "nutrition_rule") ? { leftOutByNutritionRules: c.excluded.filter((e) => e.code === "nutrition_rule").slice(0, 2).map((e) => `${e.count} × ${e.reason}`) } : {}),
        ...(cannot.length ? { cannotOrder: cannot.map((o) => ({ title: o.title, because: o.gate?.reasons?.[0] ?? o.gate?.rule ?? "the kitchen's rules" })) } : {}),
        ...(c.insteadOf ? { askedKindNotOffered: c.insteadOf } : {}),
        ...(c.askedDay ? { askedDay: c.askedDay } : {}),
        ...(c.notes.length ? { notes: c.notes.slice(0, 2) } : {}),
        ask: can.length > 1 ? `which one: ${can.length} can be ordered (one product per option, each with its own price)` : can.length === 1 ? "only one can be ordered: ask 'Shall I order it?', never 'which one'" : "none can be ordered: say why, and what would make it possible",
      };
    }
    case "price":
      return { fixedPrice: { totalEur: eur(c.totalCents), heldUntil: c.expiresAt, delivery: c.deliveryDate } };
    case "gate":
      return { decided: { outcome: c.outcome, ...(c.approver ? { who: c.approver.name } : {}), ...(c.said ? { sayThis: c.said.en } : c.reasons.length ? { because: c.reasons[0] } : {}) } };
    case "order":
      return { order: { status: c.status, totalEur: eur(c.totalCents), delivery: c.deliveryDate, lines: c.lines.slice(0, 4).map((l) => `${l.quantity} × ${l.name}`), ...(c.authorised.by !== "agent" ? { who: c.authorised.name } : {}), ...(c.takeBackUntil ? { canTakeBackUntil: c.takeBackUntil } : {}) } };
    case "sheet":
      return {
        orderToConfirm: c.state === "placed" ? undefined : { lines: c.lines.map((l) => `${l.packs} × ${l.name}`), totalEur: eur(c.totalCents), delivery: c.deliveryDate, gate: gateWords(c.gate, c.totalCents), ...(c.check?.length ? { noticed: c.check } : {}), ask: "shall I order it?" },
      };
    case "menu": {
      // The day asked for cannot be had: the first thing said, with the earliest day that can.
      const day = c.dayProblem ? { sayFirst: `nothing can arrive on ${c.dayProblem.asked}${c.dayProblem.earliest ? `; the earliest is ${c.dayProblem.earliest}` : ""}` } : {};
      if (c.stage === "choose") return { menus: c.proposals.slice(0, 3).map((p, i) => ({ n: i + 1, title: p.title, dishes: p.dishes, ...(p.costPerCoverCents ? { perCoverEur: eur(p.costPerCoverCents) } : {}) })), ...(c.serviceDate ? { dayAsked: c.serviceDate } : {}), ...day, ...(c.covers ? { covers: c.covers } : {}), ask: c.dayProblem?.earliest ? `which menu: the one chosen is planned for ${c.dayProblem.earliest}` : "which menu" };
      // No promise about a person's OK here: the order the menu becomes is judged when it is placed, and said then.
      // The kitchen's rules stop the menu as it stands: said by name the first time, with the next step.
      const stop = c.gate?.outcome === "reject" ? (c.gate.rules ?? []).find((r) => r.outcome === "fail") : undefined;
      if (c.stage === "ready" && !c.sheetId && stop) return { menu: { dishes: c.dishes.map((d) => d.name), covers: c.covers, day: c.serviceDate }, rulesStopIt: { rule: stop.rule.replaceAll("_", " "), why: c.gate?.reasons?.[0] ?? stop.rule }, ...day, ask: "say which rule stops it and why, then offer the dish without what breaks it, or another day" };
      if (c.stage === "ready" && !c.sheetId) return { menu: { dishes: c.dishes.map((d) => d.name), covers: c.covers, day: c.serviceDate, ...(c.days.length ? { deliveryDaysPossible: c.days.filter((d) => d.available).map((d) => d.date).slice(0, 3) } : {}), totalEur: eur(c.totalCents), ...(c.costPerCoverCents ? { perCoverEur: eur(c.costPerCoverCents) } : {}), ...(c.blockers.length ? { cannotOrderYet: c.blockers } : {}) }, ...day, ask: !c.covers ? "how many covers" : c.dayProblem?.earliest ? `shall I plan it for ${c.dayProblem.earliest}?` : "shall I order it?" };
      if (c.stage === "declined") return { menu: { cannot: c.blockers } };
      return undefined;
    }
    case "records":
      return { records: c.rows.slice(0, 5).map((r) => ({ what: r.label, ...(r.date ? { date: r.date } : {}), ...(r.totalCents !== undefined ? { totalEur: eur(r.totalCents) } : {}) })) };
    case "rules":
      return c.proposal ? { rulesChange: { changes: c.diff.map((d) => `${d.field}: ${d.before || "none"} → ${d.after || "none"}`), state: c.proposal.state, canConfirmHere: c.proposal.canSign, ...(c.proposal.why ? { whyNot: c.proposal.why } : {}) }, ask: c.proposal.state === "open" && c.proposal.canSign ? "shall I change it?" : undefined } : { rules: { perOrderLimitEur: eur(c.current.perOrderLimitCents), weeklyBudgetEur: eur(c.current.weeklyBudgetCents), ...(c.week ? { thisWeek: { spentEur: eur(c.week.spentCents), ...(c.week.heldCents ? { heldWaitingForOkEur: eur(c.week.heldCents) } : {}), leftEur: eur(c.week.leftCents) } } : {}), whoGivesTheOk: c.current.approvers.map((a) => `${a.name} (${a.role.replaceAll("_", " ")}), up to ${eur(a.maxApprovalCents)}`), groups: (c.current.groups ?? []).map((g) => g.name).slice(0, 6) } };
    case "scenario":
      return c.state === "open" ? { scenarioSaid: c.text.en.say, ask: c.text.en.ask } : { scenario: c.kind, answered: true };
    case "watch":
      return c.state === "open" ? { watchSaid: c.text.en.say, ask: c.text.en.ask } : { watch: c.kind, ...(c.reply ? { reply: c.reply } : {}) };
    case "offer":
      return c.state === "open" ? { wholesalerOffer: { product: c.name, said: c.text.en.say, ask: "yes (put it on an order), no, or don't suggest this kind again" } } : { wholesalerOffer: { product: c.name, answered: c.state, ...(c.reply ? { reply: c.reply } : {}) } };
    case "notice":
      return { notice: c.message, ...(c.said ? { sayItLikeThis: "first person, the groups in words, ending on the next step, as in notice" } : {}), ...(c.kind === "incomplete" ? { missing: c.missing, ...(c.usual ? { usualAmount: c.usual, ask: `offer the usual ${c.usual} as a yes/no question` } : {}) } : {}) };
    case "today":
      return { today: c.items.slice(0, 3).map((i) => i.kind) };
    default:
      return undefined;
  }
}

/** This turn's facts: the cards it made or changed, newest last, at most a few kilobytes. */
export function speakFacts(run: TurnRun): Record<string, unknown>[] {
  const turn = run.store.agentTurn(run.thread, run.turnId);
  const seen = new Set<string>();
  const cards: Card[] = [];
  for (const c of [...(turn?.cards ?? []), ...(run.facts.filter((x): x is Card => !!x && typeof x === "object" && "cardId" in x && "type" in x) as Card[])]) {
    if (seen.has(c.cardId)) continue;
    seen.add(c.cardId);
    // The newest version of a card changed in place (a sheet, a menu) is the one in the thread.
    const now = run.store.cards(run.thread).find((x) => x.card.cardId === c.cardId)?.card ?? c;
    cards.push(now);
  }
  const out = cards.map(cardFacts).filter((x): x is Record<string, unknown> => !!x).map((x) => plainFacts(x) as Record<string, unknown>);
  // Items of the same message that are not on the order (each with why): said, never dropped.
  for (const f of run.facts) if (f && typeof f === "object" && "notOnTheOrder" in f) out.push(plainFacts(f) as Record<string, unknown>);
  // A clarification asked once already and not settled by the answer: not asked again in other words; the best
  // reading from what is on the table, as a question a yes answers.
  const incomplete = cards.find((c) => c.type === "notice" && c.kind === "incomplete");
  if (incomplete) {
    const prev = [...run.thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId);
    if (prev?.role === "agent" && prev.cards.some((c) => c.type === "notice" && c.kind === "incomplete")) {
      const s = subjectOf(run);
      const all = run.store.cards(run.thread).map((x) => x.card);
      const menu = all.filter((c) => c.type === "menu").at(-1);
      const u = all.filter((c) => c.type === "understood").at(-1);
      const table = menu?.type === "menu" ? `the menu ${menu.dishes.map((d) => `${d.name} (${d.lines.map((l) => `${l.ingredient} ${l.need.amount} ${l.need.unit}`).slice(0, 6).join(", ")})`).join("; ").slice(0, 600)}` : u?.type === "understood" ? u.item : s ? subjectLine(s).replace(/^TALKING ABOUT NOW: /, "").split(". ")[0] : undefined;
      out.push({ askedAlready: "you asked this last turn: do not ask it again; offer your best reading of their words from what is on the table, as one yes/no question", ...(table ? { onTheTable: table } : {}) });
    }
  }
  return out;
}

/** Facts the reply is written from carry no codes: category codes, product ids and snake_case words come out as words. */
function plainFacts(v: unknown): unknown {
  if (typeof v === "string")
    return v
      .replace(/\s*\((?:[A-Z]{2}-\d{3,}|\d{6})\)/g, "")
      .replace(/\bcat[ _]\d{3,}\b,?\s*/gi, "")
      .replace(/\b([a-z]+)_([a-z_]+)\b/g, (m) => (/^\d{4}-\d{2}-\d{2}/.test(m) ? m : m.replaceAll("_", " ")));
  if (Array.isArray(v)) return v.map(plainFacts);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainFacts(x)]));
  return v;
}
