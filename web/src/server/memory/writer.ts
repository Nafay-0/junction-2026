import type { KitchenProfile } from "@/core/kitchen";
import { answerConfirmation, decide, respondToCitedItems, type Outcome } from "./decide";
import type { Candidate, Interaction } from "./model";
import { toCandidate, worthReading, type Proposer } from "./propose";
import { fromEvents, fromHistory } from "./signals";

/**
 * The memory writer: after every interaction, through every door. Order of work:
 *   1. a mistake check that cited memory and was answered: confirm or weaken the cited items
 *   2. candidates made by code: taps, answers, substitutes, and patterns in the order history
 *   3. candidates proposed by the model from the person's words (only when there are words)
 *   4. plain code decides each one (decide.ts)
 * The model's failure is reported and changes nothing else.
 */

export type WriteReport = {
  interactionId: string;
  outcomes: Outcome[];
  /** One-line "should I remember this?" questions for the person, by item. */
  questions: { itemId: string; question: string }[];
  model?: { id: string; ms: number; costUsd: number | null; error?: string; proposed: number };
};

export async function writeMemory(profile: KitchenProfile, interaction: Interaction, opts: { proposer?: Proposer; now: Date }): Promise<{ profile: KitchenProfile; report: WriteReport }> {
  const outcomes: Outcome[] = [];
  let p = profile;
  for (const e of interaction.events) {
    if (e.type !== "concern_response" || !e.memoryItemIds.length) continue;
    const r = respondToCitedItems(p, e.memoryItemIds, e.action !== "confirmed", interaction, opts.now);
    p = r.profile;
    outcomes.push(...r.outcomes);
  }
  const candidates: Candidate[] = [...fromEvents(interaction), ...fromHistory(p, opts.now)];
  let model: WriteReport["model"];
  if (opts.proposer && worthReading(interaction)) {
    const families = [...new Set(p.history.map((h) => h.family))];
    const res = await opts.proposer({ interaction, families });
    model = { id: res.model, ms: res.ms, costUsd: res.costUsd, ...(res.error ? { error: res.error } : {}), proposed: res.raw.candidates.length };
    candidates.push(...res.raw.candidates.map((c) => toCandidate(c)));
  }
  const d = decide(p, candidates, interaction, opts.now);
  outcomes.push(...d.outcomes);
  // History patterns that were already known say nothing new: keep the report to what changed.
  const report: WriteReport = {
    interactionId: interaction.id,
    outcomes: outcomes.filter((o) => !(o.action === "merged" && o.reason === "already known from the same record")),
    questions: outcomes.filter((o) => o.action === "confirm" && o.itemId && o.question).map((o) => ({ itemId: o.itemId!, question: o.question! })),
    ...(model ? { model } : {}),
  };
  return { profile: d.profile, report };
}

export { answerConfirmation };
