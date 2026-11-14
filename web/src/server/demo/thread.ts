import type { Lang } from "@/app/_i18n/lang";
import { GUIDE_TEXT } from "@/app/k/[kitchen]/guide.text";
import { isDockError } from "@/core/errors";
import type { Runtime } from "../runtime";
import { DEMO_SAY_TEXT } from "./say.text";
import { STAGE_KINDS, guideFor, stageForAccount, type GuideId, type StageKind, type Staged } from "./service";
import { guideWords } from "./words";

/**
 * The "Try everything" guide for the kitchen's own conversation (owned by the conversation's engineer; this file only
 * gives data and actions, no card). Plain code; no model.
 *
 *   demoAskOf(words)                      what the buyer's words ask of the guide, or undefined:
 *                                         "next" ("what can I try?", "what else can you do?", "mitä voin kokeilla?",
 *                                         "vad kan jag prova?") or a StageKind ("show me a stock-out", "stage a drift",
 *                                         "send me an offer", "a product with a poor delivery record")
 *   demoNextForThread(rt, kitchen, lang)  the next thing on the guide not yet tried, in one or two sentences with the
 *                                         words to say: { say, words?, rowId, done, of } | undefined (not a demo
 *                                         account's own kitchen)
 *   demoStageForThread(rt, kitchen, kind, lang)   stage it for THIS kitchen (as "Set it up" on the guide does: marked
 *                                         staged for the demo, a ledger entry, capped): { say, staged?, ok }
 *   DEMO_STAGE_NAMES                      the staging actions by name, for a tool's enum
 *
 * `kitchen` is the kitchen's slug (an account kitchen's slug is its username). Only a demo account's own kitchen
 * answers; the conversation must only call these for the kitchen's own signed-in person (the routes and the store do
 * the same check: authz.ts requireKitchenPerson).
 */

export const DEMO_STAGE_NAMES: readonly StageKind[] = STAGE_KINDS;

const NEXT = /\b(what (else )?can (i|we) (try|do|test)|what else can you do|what can you do|what should i try( next)?|show me what you can do|mitä (muuta )?(voin|voimme|osaat|sinä osaat) (kokeilla|tehdä)?|mitä muuta osaat|mitä voin kokeilla|vad (mer )?kan (jag|vi|du) (prova|göra|testa)|vad kan du (mer|göra))\b/iu;
const STAGES: [StageKind, RegExp][] = [
  ["stock_out", /\b(stock[- ]?out|out of stock|sold out|loppuunmyy\w*|loppu varastosta|ei varastossa|slut i lager|slutsåld)\b/iu],
  ["drift", /\b(drift\w*|creep\w*|crept|kasvanut tilaus|hiipi\w*|krupit|smygande)\b/iu],
  ["offer", /\b(an? offer|wholesaler'?s? (agent|offer)|tarjous\w*|ett erbjudande|erbjudande)\b/iu],
  ["poor_record", /\b(poor (delivery )?record|often (arrives )?short|unreliable|backup|heikko toimitus\w*|varatuote|dålig leverans\w*|reserv)\b/iu],
];
const SHOW = /\b(show me|stage|set up|simulate|make|give me|send me|näytä|lavasta|valmistele|simuloi|visa mig|iscensätt|förbered|simulera)\b/iu;

/** What the buyer's words ask of the guide: the next thing to try, a staging, or nothing. */
export function demoAskOf(words: string): "next" | StageKind | undefined {
  const w = words.trim();
  if (!w || w.length > 200) return undefined;
  if (NEXT.test(w)) return "next";
  if (!SHOW.test(w)) return undefined;
  return STAGES.find(([, re]) => re.test(w))?.[0];
}

async function accountOf(rt: Runtime, kitchen: string) {
  const a = await rt.accounts.get(kitchen);
  return a?.kind === "own" && a.demo && a.kitchen ? a : undefined;
}

export async function demoNextForThread(rt: Runtime, kitchen: string, lang: Lang = "en"): Promise<{ say: string; words?: string; rowId?: GuideId; done: number; of: number } | undefined> {
  const a = await accountOf(rt, kitchen);
  if (!a) return undefined;
  const g = await guideFor(rt, a);
  const t = DEMO_SAY_TEXT[lang];
  const gt = GUIDE_TEXT[lang];
  if (!g.next) return { say: `${t.allDone(g.of)} ${t.guide}`, done: g.done, of: g.of };
  const row = gt.rows[g.next];
  const words = row.say?.(guideWords(g.facts, lang))[0];
  const setup = g.rows.find((r) => r.id === g.next)?.setup;
  const stage = setup && (STAGE_KINDS as string[]).includes(setup.action) && setup.ready ? setup.action : undefined;
  const say = [t.next(row.title, row.shows(guideWords(g.facts, lang))), words ? t.tryWords(words) : row.do ? t.doThis(row.do) : "", stage ? "" : ""].filter(Boolean).join(" ");
  return { say, ...(words ? { words } : {}), rowId: g.next, done: g.done, of: g.of };
}

export async function demoStageForThread(rt: Runtime, kitchen: string, kind: StageKind, lang: Lang = "en"): Promise<{ ok: boolean; say: string; staged?: Staged }> {
  const t = DEMO_SAY_TEXT[lang];
  const a = await accountOf(rt, kitchen);
  if (!a) return { ok: false, say: t.notDemo };
  try {
    const staged = await stageForAccount(rt, a, kind);
    const g = await guideFor(rt, (await rt.accounts.get(kitchen))!);
    const rowId: GuideId = kind === "stock_out" ? "stockout" : kind === "drift" ? "drift" : kind === "offer" ? "offer" : "backup";
    const words = GUIDE_TEXT[lang].rows[rowId].say?.(guideWords(g.facts, lang, staged))[0];
    return { ok: true, say: [t.staged(staged.summary), words ? t.stagedThen(words) : ""].filter(Boolean).join(" "), staged };
  } catch (err) {
    return { ok: false, say: t.failed(isDockError(err) ? err.message : "something went wrong") };
  }
}
