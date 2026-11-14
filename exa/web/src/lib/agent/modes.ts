/**
 * Modes: what the user picks in place of a model. A mode says how the user wants the work done,
 * from the quickest answer to the most careful one, and the effort dial says how much thought to
 * put into each step. Which model stands behind a mode is the server's business
 * (`models.ts`, `MODE_MODEL`); nothing in this file names one, and nothing the interface shows
 * does either. The admin decides which modes an account may use.
 *
 * Shared by the server and the browser: no imports, no keys.
 */

export type ModeId = "ultrafast" | "fast" | "smart" | "expert";

export type ModeInfo = {
  id: ModeId;
  label: string;
  /** One line shown in the picker. */
  blurb: string;
  /** 0 is the quickest, 3 the most capable. */
  rank: number;
};

/** From the quickest to the most capable. */
export const MODES: ModeInfo[] = [
  { id: "ultrafast", label: "Ultra fast", blurb: "Quick answers for everyday things.", rank: 0 },
  { id: "fast", label: "Fast", blurb: "Fast, with a bit more care.", rank: 1 },
  { id: "smart", label: "Smart", blurb: "Thinks it through. Best for most tasks.", rank: 2 },
  { id: "expert", label: "Expert", blurb: "For the hard questions. Takes longer.", rank: 3 },
];

export const MODE_IDS = MODES.map((m) => m.id);

/** What a new account starts with, and what is used when nothing else is allowed. */
export const LOWEST_MODE: ModeId = "ultrafast";

export const isMode = (value: unknown): value is ModeId => typeof value === "string" && (MODE_IDS as string[]).includes(value);

export function getMode(id: ModeId | string | undefined | null): ModeInfo {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/** A list of modes as stored or sent, cleaned up: known ones only, in order, never empty. */
export function cleanModes(value: unknown): ModeId[] {
  const given = Array.isArray(value) ? value.filter(isMode) : [];
  const kept = MODE_IDS.filter((id) => given.includes(id));
  return kept.length ? kept : [LOWEST_MODE];
}

/**
 * The mode a request runs in: the one asked for when the account may use it, otherwise the most
 * capable one the account may use that is not above what was asked for, otherwise its lowest.
 */
export function pickMode(asked: unknown, allowed: ModeId[]): ModeId {
  const may = cleanModes(allowed);
  if (isMode(asked) && may.includes(asked)) return asked;
  const ceiling = isMode(asked) ? getMode(asked).rank : getMode(may[may.length - 1]).rank;
  const below = may.filter((id) => getMode(id).rank <= ceiling);
  return below.length ? below[below.length - 1] : may[0];
}

/* ───────────────────────── Effort ───────────────────────── */

/** How much thought goes into each step, 1 (least) to 4 (most). */
export type Effort = 1 | 2 | 3 | 4;

export const EFFORTS: Array<{ value: Effort; label: string; blurb: string }> = [
  { value: 1, label: "Quick", blurb: "Answers as soon as it can." },
  { value: 2, label: "Balanced", blurb: "Thinks a little first." },
  { value: 3, label: "Thorough", blurb: "Thinks carefully, checks more sources." },
  { value: 4, label: "Max", blurb: "Takes its time. Deepest thinking, widest research." },
];

export const DEFAULT_EFFORT: Effort = 1;

export function cleanEffort(value: unknown): Effort {
  const n = typeof value === "string" ? Number(value) : value;
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : DEFAULT_EFFORT;
}

export const getEffort = (value: Effort) => EFFORTS.find((e) => e.value === value) ?? EFFORTS[0];
