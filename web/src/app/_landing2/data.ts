import attacks from "@/server/show/recordings/attacks.json";
import { RULES } from "@/core/policy";
import search from "../_landing/search-eval.json";
import { CRASH, crashRows } from "../_landing/crash";
import reel from "./reel.json";
import thread from "./reel-thread.json";

/**
 * Everything the second landing page shows as a figure or as the product's own words, read at build time from
 * where it was measured or captured. Nothing here is typed by hand.
 */

/** The product's markup in agent lines: **bold** and {{a date}}, as plain text. */
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\{\{(.+?)\}\}/g, "$1");

type Turn = { role?: string; text?: string; line?: string };
const turns = (thread.turns as Turn[]).map((t) => ({ role: t.role, text: t.text ?? t.line ?? "" })).filter((t) => t.text);
const agentTurns = turns.filter((t) => t.role === "agent").map((t) => plain(t.text));
const views = thread.stepsViewAsShown as { after: string; steps: string[] }[];
const first = views[0].steps;
const second = views[1]?.steps ?? [];

/** "Read your request. 1 000 L, …" -> head "Read your request", rest "1 000 L, …". */
function split(step: string) {
  const i = step.indexOf(". ");
  return i < 0 ? { head: step.replace(/\.$/, ""), rest: "" } : { head: step.slice(0, i), rest: step.slice(i + 2) };
}

const priced = Number(/live price and delivery for (\d+)/.exec(first.find((s) => /live price/.test(s)) ?? "")?.[1] ?? 0);

/** The replies the agent wrote, split at their sentences: the exception first, then the gate, then the order. */
const reply = agentTurns[0] ?? "";
const gateLine = (agentTurns[1] ?? "").split("\n")[0];
const placedLine = (agentTurns[1] ?? "").split("\n").slice(1).join(" ");

export type StoryStep = { frame: string; kicker: string; head: string; rest: string; extra?: string; who: "buyer" | "agent" | "code" | "person"; counter?: "priced" | "rules" };

/** The first reply, sentence by sentence (its own full stops followed by a space). */
const sentences = reply.split(/(?<=[.?])\s+/);

const s = (i: number, list = first) => split(list[i] ?? "");

/** The ten moments of the partner's example, in the product's own words. `kicker` is ours: what kind of step it is. */
export const STORY: StoryStep[] = [
  { frame: "r01-typed", kicker: "The chef asks", head: "I need 1,000 litres of lactose-free milk by Monday", rest: "", who: "buyer" },
  { frame: "r02-reading", kicker: "Reads", ...s(0), who: "agent" },
  { frame: "r03-working", kicker: "Remembers the kitchen", ...s(1), who: "agent" },
  { frame: "r05-steps", kicker: "Searches 17,546 products by meaning", ...s(2), extra: first[4], who: "agent" },
  { frame: "r05-steps", kicker: "Asks the live price for only those", ...s(3), who: "agent", counter: "priced" },
  { frame: "r04-reply", kicker: "Says the exception first", head: sentences[0] ?? "", rest: "", who: "agent" },
  { frame: "r06-options", kicker: "Three ways, priced live", head: sentences[1] ?? "", rest: sentences.slice(2).join(" "), who: "agent" },
  { frame: "r07-choice", kicker: "The buyer picks", head: "the first one", rest: second[0] ?? "", who: "buyer" },
  { frame: "r08-gate", kicker: "Plain code checks", ...s(1, second), rest: gateLine, who: "code", counter: "rules" },
  { frame: "r09-ok-given", kicker: "A named person signs", head: "OK'd by Kitchen manager", rest: "With a passkey on their own phone, bound to this exact order.", who: "person" },
  { frame: "r11-thread-signed", kicker: "Placed, receipt signed", head: split(second[2] ?? "Sent the order").head, rest: placedLine, who: "agent" },
];

export const FRAMES = (reel.frames as { key: string; src: string; w: number; h: number; caption: string }[]).reduce<Record<string, { src: string; w: number; h: number; caption: string }>>(
  (m, f) => ((m[f.key] = f), m),
  {},
);
export const REEL = reel.frames as { key: string; src: string; w: number; h: number; caption: string }[];

export const COUNTS = { priced, products: search.products, rules: RULES.length };

/** The presenter's "Now try to break it", as recorded through the real gate (the last frame holds every result). */
type Attack = { id: string; title: string; held: boolean; how: string; rule?: string };
const recorded = (attacks.frames.at(-1)?.data as { results: Attack[] }).results;
export const ATTACKS = recorded.filter((a) => a.id !== "resume");
export const ATTACKS_HELD = ATTACKS.filter((a) => a.held).length;
export const ATTACKS_CAPTURED = attacks.capturedAt;

export const SEARCH = search;
export const searchRow = (key: string) => search.rows.find((r) => r.key === key)!;

export { CRASH, crashRows, RULES };
