import { weekdayL } from "@/app/_i18n/format";
import type { Lang } from "@/app/_i18n/lang";
import { money, num } from "@/app/_ui/plain";
import type { Product } from "@/core/catalog";
import type { AgentSession, PublicOrder } from "@/core/orders";
import type { RenewalChoice } from "@/core/watch";
import { yesOrNo } from "../channels/speech";
import type { Runtime } from "../runtime";
import { WATCH_SAY_TEXT } from "./say.text";
import { answerFinding, answerRenewal, markSaid, setAutoRenew, watchForOrg, type Finding, type Renewal, type Who } from "./service";

/**
 * The watch as the kitchen's own conversation uses it: data and actions, no card. The thread (owned by the
 * conversation engineer) decides where it is said; this module gives it the facts for one or two sentences and a
 * question (en, fi, sv), the steps and proof for the closed "steps" view, the reading of the buyer's words, and the
 * action on them.
 *
 *   watchMomentForThread(rt, session, lang)        at most one moment now, or undefined:
 *        { id, kind, say, ask?, steps, proof?, facts, staged }
 *        kinds: "stock_out" (asks: switch?), "renewal_held" (asks: new amount, usual, or skip),
 *               "renewal_placed" and "substitute_placed" (a one-sentence report, no question)
 *   watchAnswerOf(kind, words)                     the buyer's words as an answer, or undefined
 *   answerWatchMoment(rt, session, id, answer, who)  acts (through the gate) and returns the reply line
 *   markWatchSaid(rt, id)                          after the thread said a moment, so it is not said again
 *   autoRenewIntentOf(words) / setAutoRenewFromThread(...)  "renew the milk automatically" and its opposite
 */

export type WatchMomentKind = "stock_out" | "renewal_held" | "renewal_placed" | "substitute_placed";

export type WatchMoment = {
  id: string;
  kind: WatchMomentKind;
  say: string;
  /** The question it ends on (undefined for a report). */
  ask?: string;
  /** What an answer can be (watchAnswerOf returns one of these). */
  answers: string[];
  /** Lines for the closed steps view: what was checked, the figures, the rule that decides, the proof. */
  steps: string[];
  /** The signed availability statement it rests on, checkable in the browser against /.well-known/jwks.json. */
  proof?: { token: string; keysUrl: string; claimId: string; simulated: boolean };
  /** For grounding the agent's own line (core/grounding factsFrom). */
  facts: Record<string, unknown>;
  staged: boolean;
};

const nameIn = (p: Product | undefined, fallback: string, lang: Lang) => (p?.names?.[lang] ?? (lang === "en" ? p?.names?.en : undefined) ?? p?.name ?? fallback);
const amountL = (n: number, unit: string) => `${num(n, 2)} ${unit === "L" ? "l" : unit}`;
const dayWord = (date: string, lang: Lang) => (lang === "en" ? weekdayL(date, lang) : weekdayL(date, lang).toLowerCase());
/** The day it can come again: the weekday (en, sv), the date in Finnish ("19.11.", no case ending needed). */
const backWord = (d: string | null, lang: Lang) => (!d ? "" : lang === "fi" ? `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.` : weekdayL(d, lang));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDay = (date: string, lang: Lang) => `${weekdayL(date, lang)} ${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.`;

async function productsOf(rt: Runtime, ids: string[]): Promise<Map<string, Product>> {
  const ps = await rt.catalog.searchProducts({ ids: [...new Set(ids)], limit: 20 });
  return new Map(ps.map((p) => [p.id, p]));
}

function figures(f: FindingWithRule, lang: Lang): string {
  const t = WATCH_SAY_TEXT[lang];
  const s = f.substitutes[0];
  const to = s.tradeOff;
  const per = to.unit === "kg" ? t.kilo : t.litre;
  const parts: string[] = [];
  if (to.perUnitDiffCents !== null) parts.push(to.perUnitDiffCents === 0 ? `${t.same} ${per}` : `${(to.perUnitDiffCents > 0 ? t.more : t.less)(money(Math.abs(Math.round(to.perUnitDiffCents))))} ${per}`);
  parts.push(t.packs(String(to.packs), amountL(to.packSize, to.unit)));
  if (to.sameMaker) parts.push(t.sameMaker);
  else if (to.maker) parts.push(t.otherMaker(to.maker));
  if (!s.insidePreferences) parts.push(t.signOff(f.approver ?? "a person"));
  return parts.join(", ");
}

function stepsOfFinding(f: FindingWithRule): string[] {
  return [
    `Watched the kitchen's key products (its recurring orders and the orders on their way) with one live availability call, cached ten minutes.`,
    `${f.product.name} for ${f.need.date} (${f.need.source === "order" ? `order ${f.need.orderId}` : "recurring order"}, ${f.need.amount} ${f.need.unit}): ${f.message || f.problems.join(", ")}${f.shortfall.backOn ? `; earliest ${f.shortfall.backOn}` : ""}.`,
    `Substitutes from the knowledge map (${f.search.mapCandidates}), the wholesaler's list and the product search (${f.search.searchCandidates}${f.search.path ? `, ${f.search.path}` : ""}); ${f.search.priced} priced in one more live call for ${f.need.date}.`,
    ...f.substitutes.map((s) => `${s.rank}: ${s.name}: ${s.why}. ${s.insidePreferences ? "Inside the kitchen's preferences: the agent may order it alone." : `Needs a person: ${s.outside.join("; ")}.`}`),
    `Ordering one goes through the gate like any order: the mandate's substitution rule (${f.mandateRule ?? "per the mandate"}) and limits decide; anything beyond them goes to the person the mandate names, on their phone.`,
    f.claim ? `Signed availability claim ${f.claim.claimId} (vc+jwt, Ed25519${f.claim.simulated ? ", simulated: true" : ""}), checkable against /.well-known/jwks.json.` : "No signed availability claim: the wholesaler returned no offer for it.",
    ...(f.staged ? ["STAGED: the stock-out was staged by operations staff for the demo; the partner's live figures are unchanged."] : []),
  ];
}

function stepsOfRenewal(r: Renewal): string[] {
  const u = r.amounts.unit;
  return [
    `Learned from ${r.basedOn.orders} orders over ${r.basedOn.weeks.length} weeks (${r.basedOn.from} to ${r.basedOn.to}): usually ${r.amounts.usual} ${u} of ${r.product.name}.`,
    ...(r.drift.portions ? [`Portions: ${r.drift.portions.points.map((p) => `${p.date} ${p.amount}${p.staged ? " (staged)" : ""}`).join(", ")}: ${r.drift.portions.pct > 0 ? "+" : ""}${r.drift.portions.pct} % since ${r.drift.portions.since}, ${r.drift.portions.perWeek} ${u} a week (fit r² ${r.drift.portions.r2}).`] : []),
    ...(r.drift.cost ? [`Cost: ${r.drift.cost.points.map((p) => `${p.date} ${p.perUnitCents} c`).join(", ")} per ${u}: ${r.drift.cost.pct > 0 ? "+" : ""}${r.drift.cost.pct} % since ${r.drift.cost.since}.`] : []),
    ...(r.drift.basket ? [`The usual ${r.drift.basket.amount} ${u} at today's live price: ${r.drift.basket.nowCents / 100} € against ${r.drift.basket.usualCents / 100} € (${r.drift.basket.pct > 0 ? "+" : ""}${r.drift.basket.pct} %).`] : []),
    `Decision (plain code): ${r.decision.reason}`,
    `Auto-renew ${r.autoRenew.on ? `on since ${r.autoRenew.at.slice(0, 10)}, by ${r.autoRenew.by} (${r.autoRenew.via})` : "off"}.`,
    ...(r.outcome?.orderId ? [`Order ${r.outcome.orderId}: ${r.outcome.status}; the gate: ${(r.outcome.reasons ?? []).join(" ")}`] : []),
    ...(r.outcome?.refused ? [`Refused by the gate (${r.outcome.refused.rule ?? r.outcome.refused.code}): ${r.outcome.refused.message}`] : []),
    ...(r.staged ? ["STAGED: the trend was staged by operations staff for the demo."] : []),
  ];
}

type FindingWithRule = Finding & { approver?: string; mandateRule?: string };

/**
 * At most one moment for the conversation now: a held renewal first (it waits for an answer before the cut-off),
 * then an open stock-out, then one report of what the agent did alone. Moments already said are not repeated.
 */
export async function watchMomentForThread(rt: Runtime, session: AgentSession, lang: Lang = "en", opts: { asked?: boolean } = {}): Promise<WatchMoment | undefined> {
  // Asked ("anything I should know about this week's orders?"): an open question is said again, even if said before.
  const unsaid = (x: { saidAt?: string | null }) => opts.asked || !x.saidAt;
  const orgId = session.mandate.issuer.orgId;
  const w = await watchForOrg(rt, orgId);
  const t = WATCH_SAY_TEXT[lang];
  const approver = session.mandate.approvers[0]?.name;
  const held = w.renewals.find((r) => r.state === "held" && unsaid(r));
  if (held) {
    const ps = await productsOf(rt, [held.product.productId]);
    const what = nameIn(ps.get(held.product.productId), held.product.name, lang);
    const day = dayWord(held.deliveryDate, lang);
    const u = held.amounts.unit;
    const sentences: string[] = [];
    const d = held.drift;
    if (d.portions) sentences.push((d.portions.direction === "up" ? t.crept : t.fell)(day, what, amountL(d.portions.from, u), amountL(d.portions.to, u), d.portions.weeks));
    if (d.cost) sentences.push(t.dearer(what, money(Math.round(d.cost.from)), money(Math.round(d.cost.to)), shortDay(d.cost.since, lang)));
    if (d.basket) sentences.push(t.basket(amountL(d.basket.amount, u), money(d.basket.nowCents), money(d.basket.usualCents)));
    // The usual product cannot come for the day either: say so, and what a renewal would order instead.
    const short = held.decision.action === "hold" && held.decision.because.includes("stock") ? w.findings.find((x) => x.need.productId === held.product.productId && x.need.date === held.deliveryDate && x.state !== "resolved") : undefined;
    if (short) sentences.push(sentences.length ? t.cannotToo(backWord(short.shortfall.backOn, lang)) : t.cannot(day, what, backWord(short.shortfall.backOn, lang), false));
    sentences.push(t.held);
    if (short?.substitutes[0]) {
      const sp = await productsOf(rt, [short.substitutes[0].productId]);
      sentences.push(t.instead(nameIn(sp.get(short.substitutes[0].productId), short.substitutes[0].name, lang)));
    }
    const choices = held.decision.action === "hold" ? held.decision.choices : ["usual", "skip"];
    return {
      id: held.renewalId,
      kind: "renewal_held",
      say: cap(`${sentences.join(" ")}${held.staged ? ` ${t.stagedTrend}` : ""}`),
      ask: choices.includes("renew_new") ? t.askThree(amountL(held.amounts.latest, u), amountL(held.amounts.usual, u)) : t.askTwo(amountL(held.amounts.usual, u)),
      answers: choices,
      steps: stepsOfRenewal(held),
      facts: { renewal: held },
      staged: held.staged,
    };
  }
  const open = (w.findings.find((f) => f.state === "open" && f.staged && unsaid(f)) ?? w.findings.find((f) => f.state === "open" && unsaid(f))) as FindingWithRule | undefined;
  if (open) {
    const f: FindingWithRule = { ...open, ...(approver ? { approver } : {}), mandateRule: session.mandate.substitution.rule };
    const ps = await productsOf(rt, [f.product.productId, ...f.substitutes.map((s) => s.productId)]);
    const what = nameIn(ps.get(f.product.productId), f.product.name, lang);
    const back = backWord(f.shortfall.backOn, lang);
    const order = f.need.source === "order";
    const best = f.substitutes[0];
    const say = [t.cannot(dayWord(f.need.date, lang), what, back, order), best ? t.closest(nameIn(ps.get(best.productId), best.name, lang), figures(f, lang)) : t.noneCloser, f.staged ? t.staged : ""].filter(Boolean).join(" ");
    return {
      id: f.findingId,
      kind: "stock_out",
      say: cap(say),
      ask: best ? t.askSwitch(order) : t.askNone,
      answers: best ? ["switch", "keep", ...f.substitutes.slice(1).map((s) => `switch:${s.productId}`)] : ["keep"],
      steps: stepsOfFinding(f),
      ...(f.claim ? { proof: { token: f.claim.token, keysUrl: "/.well-known/jwks.json", claimId: f.claim.claimId, simulated: f.claim.simulated } } : {}),
      facts: { finding: { ...f, claim: f.claim ? { claimId: f.claim.claimId, statement: f.claim.statement, simulated: f.claim.simulated } : undefined } },
      staged: f.staged,
    };
  }
  const placed = w.renewals.find((r) => (r.state === "placed" || r.state === "failed") && !r.saidAt && r.outcome?.orderId);
  if (placed) {
    const o = placed.outcome!;
    const ps = await productsOf(rt, [placed.product.productId, ...(o.substitute ? [o.substitute.productId] : [])]);
    const what = nameIn(ps.get(placed.product.productId), placed.product.name, lang);
    const day = dayWord(placed.deliveryDate, lang);
    const who = o.approver ?? approver ?? "a person";
    const sub = o.substitute ? nameIn(ps.get(o.substitute.productId), o.substitute.name, lang) : undefined;
    const say = sub
      ? o.status === "committed" ? t.replaced(day, what, sub, money(o.totalCents ?? 0)) : t.replacedSignOff(day, what, sub, who)
      : o.status === "committed" ? t.renewed(day, what, money(o.totalCents ?? 0)) : t.renewedSignOff(day, what, money(o.totalCents ?? 0), who);
    return { id: placed.renewalId, kind: sub ? "substitute_placed" : "renewal_placed", say: cap(say), answers: [], steps: stepsOfRenewal(placed), facts: { renewal: placed }, staged: placed.staged };
  }
  return undefined;
}

export const markWatchSaid = (rt: Runtime, id: string) => markSaid(rt, id);

// ---------- the buyer's words ----------

const KEEP = /\b(no|nope|keep|leave it|as it is|don'?t switch|ei|älä vaihda|jätä|anna olla|nej|låt (den )?vara|byt inte)\b/iu;
const SECOND = /\b(second|the other one|better one|toinen|toista|andra)\b/iu;
const THIRD = /\b(third|kolmas|kolmatta|tredje)\b/iu;
const SKIP = /(skip|not this week|no order this week|nothing this week|ohita|jätä väliin|väliin|ei tällä viikolla|hoppa över|inte den här veckan)/iu;
const USUAL = /(usual|normal|as before|as always|back to|tavallinen|tavalliseen|tavallista|normaali|kuten ennen|vanliga|som vanligt|som förut)/iu;
const NEWER = /(new amount|the new|keep (it )?at|renew at|more|the higher|uusi määrä|uudella määrällä|isompi|nykyinen määrä|nya mängden|den nya|mer)/iu;

/**
 * The buyer's words as an answer to the moment: for a stock-out "switch" (yes, the best), "switch:<productId>" (the
 * second or third named), or "keep"; for a held renewal "renew_new", "usual" or "skip". A number in the words
 * picks the amount it equals. Undefined when the words do not answer it.
 */
export function watchAnswerOf(m: Pick<WatchMoment, "kind" | "answers"> & { facts?: Record<string, unknown> }, words: string): string | undefined {
  const w = words.trim();
  if (!w) return undefined;
  if (m.kind === "stock_out") {
    const alts = m.answers.filter((a) => a.startsWith("switch:"));
    if (THIRD.test(w) && alts[1]) return alts[1];
    if (SECOND.test(w) && alts[0]) return alts[0];
    const yn = yesOrNo(w);
    if (yn === "yes" && m.answers.includes("switch")) return "switch";
    if (yn === "no" || KEEP.test(w)) return "keep";
    if (/\b(switch|swap|change it|vaihda|byt)\b/iu.test(w) && m.answers.includes("switch")) return "switch";
    return undefined;
  }
  if (m.kind === "renewal_held") {
    if (SKIP.test(w)) return "skip";
    const r = m.facts?.renewal as Renewal | undefined;
    const n = Number(w.match(/(\d+(?:[.,]\d+)?)/)?.[1]?.replace(",", "."));
    if (r && Number.isFinite(n)) {
      if (n === r.amounts.latest && m.answers.includes("renew_new")) return "renew_new";
      if (n === r.amounts.usual) return "usual";
    }
    if (USUAL.test(w)) return "usual";
    if (NEWER.test(w) && m.answers.includes("renew_new")) return "renew_new";
    const yn = yesOrNo(w);
    if (yn === "no") return "skip";
    if (yn === "yes") return m.answers.includes("renew_new") ? "renew_new" : "usual";
  }
  return undefined;
}

/**
 * Act on the answer: a switch or a renewal is an ordinary order through the gate (alone within the mandate and the
 * kitchen's preferences, else to the person the mandate names); keep and skip are recorded. `reply`: the agent's
 * line back, in the kitchen's language. `who.signedIn`: the kitchen's own signed-in person answered (then an order
 * already placed can be taken back before the cut-off when it is replaced).
 */
export async function answerWatchMoment(rt: Runtime, session: AgentSession, id: string, answer: string, who: Who & { lang?: Lang }): Promise<{ reply: string; order?: PublicOrder; refused?: { code: string; rule?: string; message: string } }> {
  const t = WATCH_SAY_TEXT[who.lang ?? "en"];
  const lang = who.lang ?? "en";
  const signer = (o: PublicOrder) => o.approval?.approver.name ?? session.mandate.approvers[0]?.name ?? "a person";
  if (id.startsWith("wr")) {
    const r = await answerRenewal(rt, session, id, answer as RenewalChoice, who);
    await markSaid(rt, id);
    if (answer === "skip") return { reply: t.skipped };
    if (!r.order) return { reply: t.refused(r.refused?.message ?? ""), ...(r.refused ? { refused: r.refused } : {}) };
    const amount = amountL(answer === "renew_new" ? r.renewal.amounts.latest : r.renewal.amounts.usual, r.renewal.amounts.unit);
    return { reply: r.order.status === "committed" ? t.renewedAt(amount, money(r.order.totalCents)) : r.order.status === "pending_approval" ? t.renewedAtSignOff(amount, signer(r.order)) : t.refused(r.order.decision.reasons.join(" ")), order: r.order };
  }
  const choice = answer === "keep" ? "keep" : "switch";
  const productId = answer.startsWith("switch:") ? answer.slice(7) : undefined;
  const r = await answerFinding(rt, session, id, { choice, ...(productId ? { productId } : {}) }, who);
  await markSaid(rt, id);
  if (choice === "keep") return { reply: t.kept };
  if (!r.order) return { reply: t.refused(r.refused?.message ?? ""), ...(r.refused ? { refused: r.refused } : {}) };
  const subId = r.order.lines[0]?.productId;
  const ps = await productsOf(rt, [subId]);
  const sub = nameIn(ps.get(subId), r.order.lines[0]?.name ?? subId, lang);
  return { reply: r.order.status === "committed" ? t.switched(sub, money(r.order.totalCents)) : r.order.status === "pending_approval" ? t.switchedSignOff(sub, signer(r.order)) : t.refused(r.order.decision.reasons.join(" ")), order: r.order };
}

// ---------- auto-renew from the conversation ----------

const AUTO_ON = /((renew|order|place)\b.{0,40}\b(automatically|by itself|on its own)|auto-?renew|(uusi|tilaa|uusitaan)\b.{0,40}automaattisesti|automaattinen uusinta päälle|(förnya|beställ)\b.{0,40}automatiskt)/iu;
const AUTO_OFF = /(stop (the )?auto-?renew|auto-?renew off|don'?t renew (it )?automatically|lopeta automaattinen|automaattinen uusinta pois|älä uusi automaattisesti|sluta förnya automatiskt|automatisk förnyelse av)/iu;

/** "Renew the milk automatically" / "stop auto-renewing it": on, off, or undefined. */
export function autoRenewIntentOf(words: string): "on" | "off" | undefined {
  if (AUTO_OFF.test(words)) return "off";
  if (AUTO_ON.test(words)) return "on";
  return undefined;
}

/** Switch auto-renew for a family from the conversation: the person's explicit choice, recorded with who. */
export async function setAutoRenewFromThread(rt: Runtime, session: AgentSession, family: string, on: boolean, who: Who & { lang?: Lang; what?: string }): Promise<{ reply: string }> {
  const a = await setAutoRenew(rt, session, { family, on, by: who.by, via: who.via });
  const t = WATCH_SAY_TEXT[who.lang ?? "en"];
  const what = who.what ?? family.replaceAll("_", " ");
  return { reply: a.on ? t.autoOn(what, who.by) : t.autoOff(what) };
}
