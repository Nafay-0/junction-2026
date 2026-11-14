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
            ...(o.match === "compromise" ? { notExactly: o.givesUp.join("; ") } : {}),
            ...(usual ? { insteadOfUsual: usual.params } : {}),
            ...(o.gate ? { gate: gateWords(o.gate as Partial<GatePreview>) } : {}),
          };
        }),
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
      return { decided: { outcome: c.outcome, ...(c.approver ? { who: c.approver.name } : {}), ...(c.reasons.length ? { because: c.reasons[0] } : {}) } };
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
      if (c.stage === "ready" && !c.sheetId) return { menu: { dishes: c.dishes.map((d) => d.name), covers: c.covers, day: c.serviceDate, ...(c.days.length ? { deliveryDaysPossible: c.days.filter((d) => d.available).map((d) => d.date).slice(0, 3) } : {}), totalEur: eur(c.totalCents), ...(c.costPerCoverCents ? { perCoverEur: eur(c.costPerCoverCents) } : {}), ...(c.blockers.length ? { cannotOrderYet: c.blockers } : {}) }, ...day, ask: !c.covers ? "how many covers" : c.dayProblem?.earliest ? `shall I plan it for ${c.dayProblem.earliest}?` : "shall I order it?" };
      if (c.stage === "declined") return { menu: { cannot: c.blockers } };
      return undefined;
    }
    case "records":
      return { records: c.rows.slice(0, 5).map((r) => ({ what: r.label, ...(r.date ? { date: r.date } : {}), ...(r.totalCents !== undefined ? { totalEur: eur(r.totalCents) } : {}) })) };
    case "rules":
      return c.proposal ? { rulesChange: { changes: c.diff.map((d) => `${d.field}: ${d.before || "none"} → ${d.after || "none"}`), state: c.proposal.state, canConfirmHere: c.proposal.canSign, ...(c.proposal.why ? { whyNot: c.proposal.why } : {}) }, ask: c.proposal.state === "open" && c.proposal.canSign ? "shall I change it?" : undefined } : { rules: { perOrderLimitEur: eur(c.current.perOrderLimitCents), weeklyBudgetEur: eur(c.current.weeklyBudgetCents) } };
    case "notice":
      return { notice: c.message, ...(c.kind === "incomplete" ? { missing: c.missing } : {}) };
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
  const out = cards.map(cardFacts).filter((x): x is Record<string, unknown> => !!x);
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
