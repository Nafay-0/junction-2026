import { addFacts, checkText, emptyFacts, type Violation } from "@/core/grounding";
import { recordGrounding } from "@/server/grounding";
import { EVIDENCE_SOURCES, type Candidate, type Interaction } from "./model";

/**
 * Memory proposals through the grounding check (core/grounding.ts). The no-evidence rule (evidence.ts) already ties
 * each model candidate's fact to a quote of the person's words; this checks the free text the model wrote around
 * it, which the memory page shows: its reason, a note's text, a season's description, a substitute's reason, a
 * product's name. Evidence: the person's own words in this interaction (what memory records is what they said) and
 * the interaction's events (the option chosen, the substitute offered). A reason with a figure, date, claim or
 * allergen statement the person did not give is dropped; a note or description that rests on one is not kept at all.
 */
export function groundProposals(candidates: Candidate[], interaction: Interaction): { kept: Candidate[]; removed: Violation[] } {
  const facts = emptyFacts();
  for (const s of interaction.segments) if (EVIDENCE_SOURCES.includes(s.source)) addFacts(facts, s.text);
  addFacts(facts, interaction.events);
  // Product names may come from anywhere in the interaction (the catalogue's text, Dock's cards), never from nowhere.
  const anywhere = `${interaction.segments.map((s) => s.text).join(" ")} ${JSON.stringify(interaction.events)}`.toLowerCase();
  const removed: Violation[] = [];
  const kept: Candidate[] = [];
  const bad = (t: string | undefined) => {
    if (!t) return false;
    const v = checkText(t, facts, { final: true });
    removed.push(...v);
    return v.length > 0;
  };
  for (const c of candidates) {
    const f = c.fact as unknown as Record<string, unknown>;
    if ((f.kind === "note" && bad(f.text as string)) || (f.kind === "seasonal" && bad(f.description as string))) continue;
    if ((f.kind === "product" || f.kind === "substitute") && typeof f.name === "string" && f.name && !anywhere.includes(f.name.toLowerCase().trim())) {
      removed.push({ kind: "product", said: f.name });
      continue;
    }
    let next = c;
    if (bad(c.reason)) next = { ...next, reason: undefined };
    if (f.kind === "substitute" && bad(f.reason as string | undefined)) next = { ...next, fact: { ...(next.fact as object), reason: undefined } as Candidate["fact"] };
    kept.push(next);
  }
  recordGrounding("memory", removed, `interaction ${interaction.id}`);
  return { kept, removed };
}
