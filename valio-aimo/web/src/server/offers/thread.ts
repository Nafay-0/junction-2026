import { dayL, weekdayL } from "@/app/_i18n/format";
import type { Lang } from "@/app/_i18n/lang";
import { clock, money, num } from "@/app/_ui/plain";
import { localNow } from "@/core/kitchen";
import { OFFER_WEEKLY_CAP, PRIMARY_REASONS, type MuteScope, type OfferBody, type OfferReason } from "@/core/offers";
import type { AgentSession } from "@/core/orders";
import { SEASON } from "@/core/season";
import { yesOrNo } from "../channels/speech";
import type { Runtime } from "../runtime";
import { acceptOffer, acceptedInto, declineOffer, muteOffers, offerForToday, type BuyerOffer } from "./service";
import { OFFER_SAY_TEXT } from "./say.text";
import { familyL } from "@/app/k/[kitchen]/family.text";

const familyWord = (family: string, lang: Lang) => familyL(family, lang);

/**
 * The offer as the kitchen's own conversation uses it: data and actions, no card. The thread (owned by the
 * conversation engineer) decides where it is said; this module gives it what to say, what the steps view shows, and
 * what each answer in words does.
 *
 *   offerForThread(rt, session, kitchenName, lang)   at most one offer for this kitchen now, or undefined:
 *        { say, ask, steps, proof, sheet, ... }      verified against the wholesaler key and checked against the
 *                                                    kitchen's rules, memory, mutes and what it buys (plain code)
 *   offerAnswerOf(words)                             "yes" | "no" | "mute" | "off" | undefined, from the person's words
 *   answerOffer(rt, session, offerId, answer, who)   decline / mute / off are done here and return the reply line;
 *                                                    "yes" returns the sheet to open (the thread opens it with its own
 *                                                    createSheet) and the thread then calls offerOnSheet(…, requestId)
 *
 * Nothing here orders: a yes puts the product on the order sheet, and the sheet's own confirmation goes through the gate.
 */

export type ThreadOffer = {
  offerId: string;
  productId: string;
  name: string;
  family: string;
  /** One or two plain sentences: the suggestion, its reason with the figures, the price per pack. */
  say: string;
  /** The question it ends on, answered in words. */
  ask: string;
  /** Lines for the closed "steps" view: why this product, the guardrails it passed, the proof. */
  steps: string[];
  /** The signed offer and how to check it (in the browser: verifySigned against /.well-known/jwks.json). */
  proof: { token: string; keysUrl: string; verified: boolean; claimIds: string[] };
  /** What "yes" puts on the order sheet. */
  sheet: { productId: string; packs: number; deliveryDate?: string; text: string; category: string };
  reasons: OfferReason[];
  validUntil: string;
  /** The facts the agent's own line may be grounded against (core/grounding factsFrom). */
  facts: Record<string, unknown>;
};

const unitWord = (u: string) => (u === "kg" ? "kilo" : "litre");
const pct = (n: number) => `${num(n, 1)} %`;

/** The next day this kitchen usually orders this family for, if it orders it regularly. */
async function nextDay(rt: Runtime, orgId: string, family: string): Promise<string | undefined> {
  const { standing } = await import("../kitchen-portal");
  const profile = await rt.kitchens.getProfile(orgId);
  return standing(profile, localNow(new Date()).date).find((s) => s.family === family)?.nextDue;
}

function sentence(o: OfferBody, lang: Lang, sameMaker: boolean): string {
  const t = OFFER_SAY_TEXT[lang];
  const pack = money(o.price.unitPriceCents);
  const main = o.reasons.find((r) => PRIMARY_REASONS.includes(r.kind));
  const name = o.product.name;
  let s: string;
  switch (main?.kind) {
    case "cheaper":
      s = t.cheaper(t.who, name, money(Math.round(main.theirPerUnitCents - main.perUnitCents)), unitWord(main.unit), sameMaker, pack);
      break;
    case "new_in_assortment":
      s = t.newIn(t.who, name, dayL(main.listedAt, lang), pack);
      break;
    case "in_season":
      s = t.inSeason(t.who, name, SEASON.find((e) => e.kind === main.season)?.label[lang] ?? main.label, pack);
      break;
    case "more_reliable":
      s = t.reliable(t.who, name, pct(main.reliabilityPct), pct(main.theirReliabilityPct), pack);
      break;
    case "lower_carbon":
      s = t.carbon(t.who, name, pct(main.lowerPct), pack);
      break;
    default:
      s = t.other(t.who, name, pack);
  }
  return o.reasons.some((r) => r.kind === "new_to_kitchen") && main?.kind !== "cheaper" ? `${s} ${t.newToYou}` : s;
}

/** What the steps view shows: the selection reasoning and the proof, in English like the rest of the steps. */
function steps(o: BuyerOffer, check: string): string[] {
  const b = o.offer;
  const why = b.reasons.map((r) => {
    switch (r.kind) {
      case "cheaper":
        return `Cheaper like-for-like: ${r.perUnitCents / 100} € per ${unitWord(r.unit)} against ${r.theirPerUnitCents / 100} € for ${r.comparedWith.name} (${r.savingPct} % less), both from live prices the wholesaler signed.`;
      case "new_in_assortment":
        return `New in the assortment: listed ${r.listedAt} (the wholesaler's listing record).`;
      case "in_season":
        return `In season in Finland: ${r.label}, months ${r.months.join(", ")}. Source: ${r.source.title}.`;
      case "more_reliable":
        return `More reliable: ${r.reliabilityPct} % on time against ${r.theirReliabilityPct} % for ${r.comparedWith.name} (the partner's delivery file).`;
      case "lower_carbon":
        return `Lower carbon: ${r.kgCo2e} against ${r.theirKgCo2e} kg CO2e (${r.basis === "group_average" ? "product-group averages" : "product figures"}).`;
      case "new_to_kitchen":
        return `New to this kitchen: never bought, in a family it has ordered ${r.familyOrders} times.`;
    }
  });
  return [
    ...why,
    `Guardrails passed on the wholesaler's side: the kitchen's rules, its mutes, offers on, at most ${OFFER_WEEKLY_CAP} offers a week, every figure backed by data.`,
    `Checked again by this agent: ${check}.`,
    `Signed offer ${b.offerId} (vc+jwt, Ed25519), ${o.verified ? "signature verified" : "signature NOT verified"} against /.well-known/jwks.json; it is an offer, not an order, and holds until ${b.validUntil}.`,
  ];
}

/**
 * At most one offer for the conversation now, worded in the kitchen's language, or undefined. Only offers that verify
 * and pass the kitchen's own check (core/offers.ts buyerCheck) come back.
 */
export async function offerForThread(rt: Runtime, session: AgentSession, kitchenName: string, lang: Lang = "en"): Promise<ThreadOffer | undefined> {
  const o = await offerForToday(rt, session, kitchenName);
  if (!o) return undefined;
  const b = o.offer;
  const cheaper = b.reasons.find((r) => r.kind === "cheaper");
  let sameMaker = false;
  if (cheaper?.kind === "cheaper") {
    const [mine, theirs] = await Promise.all([rt.catalog.searchProducts({ ids: [b.product.productId], limit: 1 }), rt.catalog.searchProducts({ ids: [cheaper.comparedWith.productId], limit: 1 })]);
    sameMaker = !!mine[0] && !!theirs[0] && mine[0].brand !== "unknown" && mine[0].brand === theirs[0].brand;
  }
  const day = await nextDay(rt, session.mandate.issuer.orgId, b.product.category);
  const t = OFFER_SAY_TEXT[lang];
  const packs = `${b.suggestedPacks} × ${b.product.packSize} ${b.product.unit === "L" ? "l" : b.product.unit}`;
  const until = `${dayL(localNow(new Date(b.validUntil)).date, lang)} ${clock(b.validUntil)}`;
  return {
    offerId: b.offerId,
    productId: b.product.productId,
    name: b.product.name,
    family: b.product.category,
    say: `${sentence(b, lang, sameMaker)} ${t.holds(until)}`,
    ask: day ? t.askDay(packs, weekdayL(day, lang)) : t.ask(packs),
    steps: steps(o, "allowed by the kitchen's signed rules, the rules its people stated and its memory; not muted; not something it already buys"),
    proof: { token: o.token, keysUrl: "/.well-known/jwks.json", verified: o.verified, claimIds: b.evidence.map((e) => e.claimId) },
    sheet: { productId: b.product.productId, packs: b.suggestedPacks, ...(day ? { deliveryDate: day } : {}), text: `From the wholesaler's offer: ${b.suggestedPacks} × ${b.product.name}`.slice(0, 2000), category: b.product.category },
    reasons: b.reasons,
    validUntil: b.validUntil,
    facts: { offer: b, nextDay: day },
  };
}

export type OfferAnswer = "yes" | "no" | "mute" | "off";

const MUTE = /(don'?t|do not|never|stop|no more)\s+(suggest|offer|propos|recommend)|not this kind|no more (suggestions|offers)|älä (enää )?ehdota|ei (enää )?(tällaisia|ehdotuksia)|föreslå (inte|aldrig)|inga fler förslag/iu;
const OFF = /(no|stop|turn off)\s+(all\s+)?(offers|suggestions)(\s+at all)?\b.*\b(at all|any more|anymore|ever)|turn (off|offers off)|never (any|send) (offers|suggestions)|ei mitään ehdotuksia|ei ehdotuksia ollenkaan|inga förslag alls|stäng av förslag/iu;

/** The person's words as an answer to the open offer: yes, no, "don't suggest this kind again", or offers off. */
export function offerAnswerOf(words: string): OfferAnswer | undefined {
  const t = words.trim();
  if (!t) return undefined;
  if (OFF.test(t)) return "off";
  if (MUTE.test(t)) return "mute";
  const yn = yesOrNo(t);
  return yn === "yes" ? "yes" : yn === "no" ? "no" : undefined;
}

export type Who = { by: string; via: string; words?: string };

/**
 * Act on the answer. "yes": the offer is checked again and its sheet returned, nothing recorded as accepted until
 * the thread has opened the sheet and calls offerOnSheet. The others are done here and recorded; `reply` is the
 * agent's line back, in the kitchen's language.
 */
export async function answerOffer(rt: Runtime, session: AgentSession, offerId: string, answer: OfferAnswer, who: Who & { name: string; lang?: Lang; scope?: Exclude<MuteScope, "all"> }): Promise<{ answer: OfferAnswer; reply?: string; sheet?: ThreadOffer["sheet"] }> {
  const t = OFFER_SAY_TEXT[who.lang ?? "en"];
  const a = { by: who.by, via: who.words ? `${who.via}: "${who.words.slice(0, 120)}"` : who.via };
  if (answer === "yes") {
    const { offer } = await acceptOffer(rt, session, offerId, { ...a, name: who.name });
    const day = await nextDay(rt, session.mandate.issuer.orgId, offer.product.category);
    return { answer, sheet: { productId: offer.product.productId, packs: offer.suggestedPacks, ...(day ? { deliveryDate: day } : {}), text: `From the wholesaler's offer: ${offer.suggestedPacks} × ${offer.product.name}`.slice(0, 2000), category: offer.product.category } };
  }
  if (answer === "no") {
    await declineOffer(rt, session, offerId, a);
    return { answer, reply: t.declined };
  }
  if (answer === "off") {
    await muteOffers(rt, session, { offerId, scope: "all" }, a);
    return { answer, reply: t.off };
  }
  const scope = who.scope ?? "family";
  const { offersForOrg } = await import("./service");
  const family = (await offersForOrg(rt, session.mandate.issuer.orgId)).find((o) => o.offerId === offerId)?.offer.product.category;
  await muteOffers(rt, session, { offerId, scope }, a);
  return { answer, reply: t.muted(scope === "family" && family ? familyWord(family, who.lang ?? "en") : (who.lang ?? "en") === "fi" ? "tällaiset" : who.lang === "sv" ? "sådant" : "this kind") };
}

/** After a yes: the thread opened the order sheet; this records the acceptance against the sheet's request. */
export async function offerOnSheet(rt: Runtime, session: AgentSession, offerId: string, who: Who & { name: string; lang?: Lang }, requestId: string): Promise<string> {
  const a = { by: who.by, via: who.via };
  const { record } = await acceptOffer(rt, session, offerId, { ...a, name: who.name });
  acceptedInto(rt, record, a, requestId);
  return OFFER_SAY_TEXT[who.lang ?? "en"].onSheet;
}
