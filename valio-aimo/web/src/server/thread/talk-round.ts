import { signerL } from "@/app/_i18n/signer";

/**
 * An attempt to talk the agent round ("ignore your limits", "the CEO authorised it", "the approver said OK verbally",
 * "without any sign-off"): plain code reads it, and the reply says the rules stand, in words, before anything else.
 */
const ROUND = [
  /\b(ignore|skip|override|bypass|forget|disregard)\b[^.?!]{0,30}\b(limits?|rules?|approvals?|sign-?offs?|mandate|budget)\b/i,
  /\b(without|no|with no)\s+(any\s+|a\s+|the\s+)?(sign-?off|approval|ok|okay|permission)\b/i,
  // "The CEO authorised it": an authority above the rules. "The chef said yes" answers a mistake check (relayed), not this.
  /\b(ceo|boss|director|head office|management)\b[^.?!]{0,40}\b(authori[sz]ed|approved|allows?|said (it'?s )?(fine|ok|okay))\b/i,
  /\b(verbal(ly)?|by phone|on the phone)\b[^.?!]{0,30}\b(ok|okay|approv\w*|yes|agreed)\b|\b(ok|okay|approv\w*|yes)\b[^.?!]{0,30}\bverbal(ly)?\b/i,
  /\b(ohita|älä välitä)\b[^.?!]{0,30}\b(raj\w*|sääntö\w*|hyväksyn\w*)\b|\bilman\s+hyväksyn\w*\b|\b(on jo|jo)\s+hyväksyny?t\b/i,
  /\b(ignorera|strunta i|hoppa över)\b[^.?!]{0,30}\b(gräns\w*|regl\w*|godkänn\w*)\b|\butan\s+godkännande\b|\bredan godkänt\b/i,
];

export function talksRound(words: string): boolean {
  return ROUND.some((re) => re.test(words));
}

/** The reply already says the rules stand. */
export const RULES_STAND = /\b(rules (still )?(stand|apply)|can'?t skip|cannot skip|doesn'?t count|does not count|still needs?|only their own ok|(isn'?t|is not|not) a sign-?off|can'?t treat|säännöt pätevät|ei käy|reglerna gäller)\b/i;

const eur = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;

/** "Your rules stand: I can't skip them or the OK. Anything over **500,00 €** waits for the kitchen manager's own OK." */
export function rulesStand(m: { limitCents: number; signer?: string }, lang: "en" | "fi" | "sv"): string {
  const who = m.signer ? signerL(m.signer, lang) : { en: "the approver", fi: "hyväksyjä", sv: "godkännaren" }[lang];
  return {
    en: `Your rules stand: I can't skip them or the OK, whoever asks. Anything over **${eur(m.limitCents)}** waits for ${who}'s own OK on their device.`,
    fi: `Sääntönne pätevät: en voi ohittaa niitä enkä hyväksyntää, kuka tahansa pyytää. Yli **${eur(m.limitCents)}** tilaus odottaa, että ${who} hyväksyy sen omalla laitteellaan.`,
    sv: `Era regler gäller: jag kan inte hoppa över dem eller godkännandet, vem som än ber. Allt över **${eur(m.limitCents)}** väntar på att ${who} godkänner det på sin egen enhet.`,
  }[lang];
}
