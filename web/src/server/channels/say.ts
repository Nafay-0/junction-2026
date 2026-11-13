import type { IntakeView } from "@/core/intake";
import { isoWeekday } from "@/core/kitchen";
import { formatAmount } from "@/core/need";
import { LABEL_TEXT, formatCutoff } from "@/core/options";
import type { PublicOrder } from "@/core/orders";
import { formatEur } from "@/core/util";

/**
 * What the voice agent is told to say, composed by plain code from Dock's replies. The model translates these
 * sentences into the caller's language and adds nothing; the grounding check compares what it actually said
 * with the figures in these objects.
 */

const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 2026-11-16 -> "Monday 16 November". */
export function spokenDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${WEEKDAY[isoWeekday(iso.slice(0, 10)) - 1]} ${d} ${MONTH[m - 1]}`;
}

export type ForModel = { ok: boolean; state: string; say: string; ask?: string; [k: string]: unknown };

export function stepForModel(step: IntakeView): ForModel {
  switch (step.state) {
    case "needs_confirmation": {
      const checks = step.concerns.map((c) => ({
        key: c.key,
        message: c.message,
        choices: [...(c.confirmable ? [{ id: "confirm", label: "Yes, it is intended" }] : []), ...c.corrections.map((x) => ({ id: x.id, label: x.label }))],
      }));
      const first = checks[0];
      return {
        ok: true,
        state: step.state,
        say: `Before looking anything up, Dock wants to check: ${first.message}`,
        ask: `Ask the caller which they want: ${first.choices.map((c) => `"${c.label}"`).join(" or ")}.`,
        checks,
      };
    }
    case "needs_input": {
      const questions = step.questions.map((q) => ({ questionId: q.id, text: q.text, options: q.options.map((o) => ({ optionId: o.id, label: o.label })) }));
      const q = questions[0];
      return { ok: true, state: step.state, say: "Dock needs one answer before it can show options.", ask: `${q.text} ${q.options.map((o) => o.label).join(", or ")}?`, questions };
    }
    case "options_ready": {
      const options = step.options.slice(0, 3).map((o, i) => ({
        optionId: o.optionId,
        number: i + 1,
        labels: o.labels.map((l) => LABEL_TEXT[l]),
        products: o.lines.map((l) => `${l.packs} x ${formatAmount(l.packSize, l.unit)} ${l.name}${l.substituteFor ? " (a substitute)" : ""}`),
        total: formatEur(o.totalCents),
        delivery: spokenDate(o.deliveryDate),
        ...(o.orderBy ? { orderBy: formatCutoff(o.orderBy) } : {}),
        tradeOff: o.match === "full" ? (o.cons[0] ?? "meets the whole request") : `gives up: ${o.givesUp.map((g) => g.text).join("; ")}`,
        needsSignOff: o.signOff.length > 0,
      }));
      const lines = options.map((o) => `Option ${o.number}${o.labels.length ? ` (${o.labels.join(", ")})` : ""}: ${o.products.join(" plus ")}, ${o.total}, delivered ${o.delivery}; ${o.tradeOff}.`);
      const pre = step.preselected && options.find((o) => o.optionId === step.preselected!.optionId);
      return {
        ok: true,
        state: step.state,
        say: `Dock found ${options.length} option${options.length > 1 ? "s" : ""}, shown on the screen. ${lines.join(" ")}${pre ? ` Dock suggests option ${pre.number}: ${step.preselected!.reason}` : ""}`,
        ask: "Ask which option the caller wants.",
        options,
      };
    }
    case "quoted": {
      const q = step.quote!;
      const d = q.policyPreview;
      const gate =
        d.outcome === "auto_approve"
          ? "It is within what the agent may spend alone, so the gate would place it straight away."
          : d.outcome === "needs_human_approval"
            ? `It is beyond what the agent may spend alone, so it would wait for ${d.approver.name}, ${d.approver.role}, to sign off on their phone.`
            : `Dock's gate would refuse it: ${d.reasons.join(" ")}`;
      return {
        ok: true,
        state: step.state,
        say: `The wholesaler fixed the price: ${formatEur(q.quote.totalCents)}, valid until ${formatCutoff(q.quote.expiresAt)} UTC. ${gate}`,
        ask: d.outcome === "reject" ? undefined : "Ask whether to place the order.",
        total: formatEur(q.quote.totalCents),
        lines: q.quote.lines.map((l) => ({ product: l.name, packs: l.quantity, delivery: spokenDate(l.deliveryDate) })),
        gate: d.outcome,
        ...(d.outcome === "needs_human_approval" ? { approver: d.approver.name } : {}),
      };
    }
    case "no_options":
      return { ok: true, state: step.state, say: `Dock found nothing it can offer: ${step.notes[0] ?? "no product fits."}`, ask: "Ask whether the caller wants to change the request." };
    case "cancelled":
      return { ok: true, state: step.state, say: "The request is cancelled; nothing was ordered." };
  }
}

export function orderForModel(o: PublicOrder): ForModel {
  const total = formatEur(o.totalCents);
  const delivery = spokenDate(o.lines.map((l) => l.deliveryDate).sort().at(-1)!);
  switch (o.status) {
    case "committed":
      return { ok: true, state: "committed", say: `The order is placed: ${total}, delivered ${delivery}.`, total, delivery };
    case "pending_approval": {
      const who = o.approval?.approver ?? (o.decision.outcome === "needs_human_approval" ? o.decision.approver : undefined);
      return {
        ok: true,
        state: "pending_approval",
        say: `The order for ${total} is waiting for ${who ? `${who.name}, ${who.role},` : "the named approver"} to sign off on their phone. Nothing is ordered until they do.`,
        total,
        ...(who ? { approver: who.name } : {}),
      };
    }
    case "rejected":
      return { ok: true, state: "rejected", say: `Dock's gate refused the order: ${o.decision.reasons.join(" ")}`, total };
    case "declined":
      return { ok: true, state: "declined", say: `${o.approval?.approver.name ?? "The approver"} declined the order; nothing was ordered.`, total };
  }
}
