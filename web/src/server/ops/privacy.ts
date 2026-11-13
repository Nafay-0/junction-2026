import type { LedgerEntry } from "@/core/ledger";

/**
 * What the wholesaler's side may not see: a kitchen's private memory (its stated rules, the patterns Dock learned
 * from its history, its usual amounts). Those live in some intake entries of the shared ledger. The operations
 * views say THAT memory was used and what kind of check ran, never what it holds; exports and the chain check
 * withhold those entries' content and keep their hashes, so the chain still links through them.
 */
export type DisclosedEntry = LedgerEntry & { withheld?: "kitchen_memory" };

const MEMORY_STEPS = new Set(["concerns"]); // concern messages quote the kitchen's usual amounts and its own rules

export function memoryParts(e: Pick<LedgerEntry, "type" | "data">): string[] {
  if (e.type !== "intake") return [];
  const d = e.data;
  const parts: string[] = [];
  if (typeof d.step === "string" && MEMORY_STEPS.has(d.step)) parts.push("mistake checks against the kitchen's history");
  const reasons = Array.isArray(d.reasons) ? d.reasons : [];
  if (reasons.some((r) => typeof r === "string" && /^From memory:/i.test(r))) parts.push("answers from the kitchen's memory");
  for (const k of ["preferenceIds", "suspendedPreferenceIds"]) {
    const v = d[k];
    if (Array.isArray(v) && v.length) parts.push("the kitchen's stated rules");
  }
  return [...new Set(parts)];
}

/** Intake steps the wholesaler's record keeps whole: what was asked, and the option chosen. */
const PUBLIC_INTAKE_STEPS = new Set(["need", "choice", "compromise"]);

/**
 * For exports and the chain check: an intake entry is kept with the kitchen unless it is the structured need or
 * the choice (the same line the core's wholesaler audit view draws, core/audit.ts on the data branch).
 */
export function isPrivate(e: Pick<LedgerEntry, "type" | "data">): boolean {
  if (e.type !== "intake") return false;
  return !PUBLIC_INTAKE_STEPS.has(String(e.data.step ?? "")) || memoryParts(e).length > 0;
}

/** The entry as the wholesaler's side may see it: whole, or with its content withheld and its hashes kept. */
export function disclose(e: LedgerEntry): DisclosedEntry {
  if (!isPrivate(e)) return e;
  return {
    ...e,
    summary: "Kept with the kitchen: a buyer-side step of the intake.",
    data: { step: e.data.step },
    withheld: "kitchen_memory",
  };
}

/** Reasons a step may show: the ones that are not the kitchen's memory. */
export function publicReasons(reasons: unknown): string[] {
  return (Array.isArray(reasons) ? reasons : []).filter((r): r is string => typeof r === "string" && !/^From memory:/i.test(r));
}

export function memoryCount(reasons: unknown): number {
  return (Array.isArray(reasons) ? reasons : []).filter((r) => typeof r === "string" && /^From memory:/i.test(r)).length;
}
