import type { StructuredNeed } from "./need";

/**
 * Nothing the buyer asked for may vanish silently. A request is one product family; a message often names several
 * ("100 L milk plus 20 kg yoghurt", "40 L maitoa ja 15 kg voita", "30 L oat drink on Wednesday and the same again
 * next Monday"). The interpreter (a model) builds the need for one of them. This module is plain code: it reads the
 * buyer's own words, finds every item they name, and says which ones the structured need does not cover, so the
 * step can say so plainly and offer them next. The model's word is never taken for what was dropped.
 *
 * Items are found with a small lexicon of the wholesaler's main families in English, Finnish and Swedish (stems,
 * so Finnish case endings match), plus any clause that carries its own amount, plus "the same again" for a second
 * delivery. A clause the lexicon does not know but which has its own amount still counts, so an unknown product is
 * reported rather than lost.
 */

export type AlsoAsked = {
  /** The buyer's own words for it, as written. */
  text: string;
  /** The family word the lexicon recognised, or "item" (an amount with an unknown product) or "repeat" (a second delivery). */
  group: string;
  amount?: { amount: number; unit: string };
};

/** Longest first: "kauramaito" is oat drink, not milk; "matlagningsgrädde" is cream. */
const GROUPS: { group: string; words: RegExp }[] = [
  { group: "cheese", words: /\b(cream ?cheese|tuore ?juust\w*|färskost\w*)/i },
  { group: "oat drink", words: /\b(oat ?(drink|milk)s?|kaura ?(juoma|maito)\w*|havre ?dryck\w*|havre ?mjölk\w*|plant drinks?|kasvi ?juoma\w*|växt ?dryck\w*)/i },
  { group: "plant cream", words: /\b(plant ?cream|oat ?cream|kasvi ?kerm\w*|kaura ?kerm\w*|växt ?grädd\w*|havre ?grädd\w*)/i },
  { group: "plant spread", words: /\b(plant ?butter|margarine?|kasvi ?(voi|rasva)\w*|margariini\w*|växt ?smör\w*)/i },
  { group: "cream", words: /\b(\w*cream|\w*kerm(a|aa|an|oja|at)\b|\w*kerma\w*|\w*grädd\w*)/i },
  { group: "yoghurt", words: /\b(yogh?urts?|jogh?urt\w*|jugurt\w*|yoghurt\w*)/i },
  { group: "quark", words: /\b(quark|rahka\w*|kvarg\w*)/i },
  { group: "butter", words: /\b(butter|voita|voin|voi(?=\s|,|\.|$)|smör\w*)/i },
  { group: "cheese", words: /\b(\w*cheese|\w*juust\w*|ost(en|ar)?\b|\w*riven ost|cheddar\w*|edam\w*|emmental\w*|gouda\w*|mozzarell\w*|feta\w*|parmesan\w*)/i },
  { group: "egg", words: /\b(eggs?|kanan ?mun\w*|munia|ägg\w*)/i },
  { group: "milk", words: /\b(\w*milk|\w*maito\w*|\w*maidon|\w*maitoa|\w*mjölk\w*)/i },
  { group: "flour", words: /\b(flour|jauh\w*|mjöl\b)/i },
  { group: "potato", words: /\b(potato\w*|peruna\w*|potatis\w*)/i },
  { group: "meat", words: /\b(beef|pork|chicken|minced meat|naudan\w*|sian\w*|broiler\w*|kana\w*|jauheliha\w*|nötkött\w*|fläsk\w*|kyckling\w*)/i },
  { group: "fish", words: /\b(salmon|fish|lohi\w*|lohta|kala\w*|lax\w*|fisk\w*)/i },
  { group: "juice", words: /\b(juice|mehu\w*|saft\w*)/i },
];

const REPEAT = /\b(the same again|same again|the same (on|for|next)|samat uudestaan|sama uudestaan|samat (myös|taas)|samma igen|samma sak)\b/i;
const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(?:-\s*)?(l|ltr|litr\w*|liter\w*|lit\w*|kg|kilo\w*|g|gr|dl|cl|pcs|pieces?|kpl|st|pack\w*|paket\w*|pkt|boxes|box|laatik\w*|lådor|låda|cases?)\b/i;
/** Clause boundaries: commas, plus, and, also in Finnish and Swedish. A full stop starts a new sentence. */
const SPLIT = /\s*(?:(?<!\d),|,(?!\d)|[;+&]|\.\s|\band\b|\bplus\b|\bas well as\b|\balso\b|\bja\b|\bsekä\b|\bmyös\b|\boch\b|\bsamt\b|\bäven\b)\s*/i;

/**
 * A clause that only qualifies or forbids ("no milk protein", "allergic to eggs", "the cow's milk kind", "ei saa olla
 * maitoa", "gjord på mjölk") names no item to order.
 */
const NOT_AN_ITEM = /\b(no|not|non|avoid\w*|without|allerg\w*|intoleran\w*|kind|type|based|made (from|with|of)|ei|eikä|ilman|älä|\w*allergi\w*|\w*tyyppi\w*|\w*pohjai\w*|inte|utan|gjord på|baserad|refund|wasted|sour|hyvitys|reklamation|arrive[ds]?|arrived|tuli(ko)?|kom)\b/i;

const UNIT: Record<string, string> = { l: "L", ltr: "L", kg: "kg", g: "g", gr: "g", dl: "dl", cl: "cl", kpl: "pcs", st: "pcs", pcs: "pcs" };
function unitOf(raw: string): string {
  const u = raw.toLowerCase();
  if (UNIT[u]) return UNIT[u];
  if (/^(litr|liter|lit)/.test(u)) return "L";
  if (/^kilo/.test(u)) return "kg";
  if (/^piece/.test(u)) return "pcs";
  return "packs";
}

export function groupsIn(text: string): string[] {
  const out: string[] = [];
  let rest = ` ${text} `;
  for (const g of GROUPS) {
    const m = rest.match(new RegExp(g.words.source, "gi"));
    if (!m) continue;
    out.push(g.group);
    for (const w of m) rest = rest.split(w).join(" ");
  }
  return out;
}

function amountIn(clause: string): AlsoAsked["amount"] {
  const m = clause.match(AMOUNT);
  return m ? { amount: Number(m[1].replace(",", ".")), unit: unitOf(m[2]) } : undefined;
}

function sameAmount(a: AlsoAsked["amount"], q: StructuredNeed["quantity"]): boolean {
  if (!a || !q) return false;
  const base = (x: { amount: number; unit: string }) => (x.unit === "dl" ? { amount: x.amount / 10, unit: "L" } : x.unit === "cl" ? { amount: x.amount / 100, unit: "L" } : x.unit === "g" ? { amount: x.amount / 1000, unit: "kg" } : x);
  const x = base(a);
  const y = base(q);
  return Math.abs(x.amount - y.amount) < 1e-6 && (x.unit === y.unit || x.unit === "packs" || y.unit === "packs");
}

/**
 * What the buyer's words ask for that the need does not cover. Empty when the text names one thing (or nothing the
 * lexicon knows), so a plain one-item request never gets a note.
 */
export function alsoAskedIn(text: string | undefined, need: Pick<StructuredNeed, "item" | "quantity" | "sameAsLastTime">): AlsoAsked[] {
  if (!text?.trim()) return [];
  const covered = new Set(groupsIn(`${need.item.text} ${need.item.category ?? ""}`));
  // Clauses, each with whether its sentence forbids or qualifies something ("We have a pupil with a milk allergy, so no
  // milk in the yoghurt either"): there a clause without its own amount names nothing to order.
  const clauses = text.split(/(?<=[.!?])\s+/).flatMap((sentence) => {
    const negative = NOT_AN_ITEM.test(sentence);
    return sentence.split(SPLIT).map((c) => c.trim()).filter(Boolean).map((c) => ({ c, negative }));
  });
  const out: AlsoAsked[] = [];
  const seen = new Set<string>();
  const sameFamily: { clause: string; amount: NonNullable<AlsoAsked["amount"]> }[] = [];
  for (const [i, { c: clause, negative }] of clauses.entries()) {
    if (REPEAT.test(clause) && i > 0 && !need.sameAsLastTime) {
      out.push({ text: clause, group: "repeat" });
      continue;
    }
    if (NOT_AN_ITEM.test(clause)) continue;
    const groups = groupsIn(clause);
    const amount = amountIn(clause);
    if (negative && !amount) continue;
    if (groups.some((g) => covered.has(g))) {
      if (amount && groups.every((g) => covered.has(g))) sameFamily.push({ clause, amount });
      continue;
    }
    for (const g of groups) {
      if (seen.has(g)) continue;
      seen.add(g);
      out.push({ text: clause, group: g, ...(amount ? { amount } : {}) });
    }
  }
  // Two clauses of the asked-for family, each with its own amount ("40 L skimmed and 40 L whole"): the need covers
  // one of them, or their sum ("8 kg edam and 4 kg emmental" as 12 kg cheese). Any other is a second item.
  if (sameFamily.length > 1 && need.quantity) {
    const sum = sameFamily.reduce((s, x) => s + x.amount.amount, 0);
    const summed = sameFamily.every((x) => x.amount.unit === sameFamily[0].amount.unit) && sameAmount({ amount: sum, unit: sameFamily[0].amount.unit }, need.quantity);
    if (!summed) {
      const mine = sameFamily.findIndex((x) => sameAmount(x.amount, need.quantity));
      sameFamily.forEach((x, j) => {
        if (j !== (mine < 0 ? 0 : mine)) out.push({ text: x.clause, group: groupsIn(x.clause)[0] ?? "item", amount: x.amount });
      });
    }
  }
  return out;
}

/** One plain line for the step, the card and the ledger. */
export function alsoAskedNote(items: AlsoAsked[]): string | undefined {
  if (!items.length) return undefined;
  const list = items.map((x) => (x.group === "repeat" ? `a second delivery ("${x.text}")` : `"${x.text}"`));
  const words = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
  return `You also asked for ${words}. This request covers one product family, so ${items.length === 1 ? "that is" : "those are"} not in it and nothing has been ordered for ${items.length === 1 ? "it" : "them"}: ask for ${items.length === 1 ? "it" : "each"} next.`;
}
