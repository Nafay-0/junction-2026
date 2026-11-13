import type { MemoryFact } from "@/core/kitchen";
import { EVIDENCE_SOURCES, type Candidate, type Interaction, type Segment } from "./model";

/**
 * The no-evidence rule, in plain code. A model's candidate is kept only when:
 *   1. it names a segment of THIS interaction,
 *   2. that segment holds a person's words (typed, spoken, or on their photographed list), never a product's
 *      description or Dock's own text,
 *   3. the quote it gives is really in that segment (case and spacing aside), and
 *   4. the quote supports the fact: a rule about nuts must quote a word for nuts, a delivery-day item a weekday.
 * And whatever the content says to "the system" is not obeyed: a segment that reads like an instruction to the
 * agent (photo text, a transcript, a product description) is not evidence for anything.
 */

export type EvidenceVerdict = { ok: true; segment: Segment; quote: string } | { ok: false; reason: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[“”„"'’`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Text that addresses the agent rather than describing the kitchen's needs. */
const INSTRUCTION =
  /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|earlier|all|every|instructions?|rules?|memory)\b|\bsystem prompt\b|\byou are (now|an?)\b|\bdeveloper mode\b|\bas an ai\b|\b(approve|auto-?approve)\b.{0,30}\b(all|every|any|this)\b|\b(raise|increase|remove|lift)\b.{0,30}\b(limit|budget|mandate|cap)\b|\bnew instructions?\b|\boverride\b|\b(assistant|agent|model)\s*[:,]\s*(please\s+)?(ignore|remember|store|save|set|add)\b/i;

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION.test(text);
}

/** Words that must appear in a quote for it to support the fact. Finnish and Swedish forms included where buyers use them. */
const ALLERGEN_WORDS: Record<string, string[]> = {
  nuts: ["nut", "pähkinä", "pahkina", "nöt", "mantel", "almond", "hazel", "cashew", "walnut"],
  peanuts: ["peanut", "maapähkinä", "jordnöt"],
  milk: ["milk", "dairy", "maito", "mjölk", "maidoton"],
  eggs: ["egg", "kanamuna", "muna", "ägg"],
  gluten: ["gluten", "glutee", "wheat", "vehnä", "coeliac", "celiac", "keliak"],
  fish: ["fish", "kala", "fisk"],
  soy: ["soy", "soija", "soja"],
  sesame: ["sesam", "seesam"],
  celery: ["celery", "selleri"],
  mustard: ["mustard", "sinappi", "senap"],
  crustaceans: ["shellfish", "crustacean", "shrimp", "prawn", "äyriäi", "skaldjur"],
  molluscs: ["mollus", "nilviäi", "mussel"],
  sulphites: ["sulphite", "sulfite", "sulfiit"],
  lupin: ["lupin", "lupiini"],
};
const CLAIM_WORDS: Record<string, string[]> = {
  lactose_free: ["lactose", "laktoos", "laktos"],
  low_lactose: ["lactose", "hyla", "vähälaktoos", "laktos"],
  gluten_free: ["gluten", "gluteeni", "keliak", "coeliac", "celiac"],
  wheat_free: ["wheat", "vehnä"],
  egg_free: ["egg", "muna", "ägg"],
  soy_free: ["soy", "soija", "soja"],
  vegan: ["vegan", "vegaan", "plant"],
  vegetarian: ["vegetar", "kasvis"],
  organic: ["organic", "luomu", "ekolog", "bio"],
};
const WEEKDAY_WORDS: string[][] = [
  [],
  ["monday", "mondays", "maanant", "månd"],
  ["tuesday", "tiistai", "tisdag"],
  ["wednesday", "keskiviik", "onsdag"],
  ["thursday", "torstai", "torsdag"],
  ["friday", "perjant", "fredag"],
  ["saturday", "lauant", "lördag"],
  ["sunday", "sunnunt", "söndag"],
];
const MONTH_WORDS: string[][] = [
  [],
  ["jan", "tammi"],
  ["feb", "helmi"],
  ["mar", "maalis"],
  ["apr", "huhti"],
  ["may", "touko", "maj"],
  ["jun", "kesä"],
  ["jul", "heinä"],
  ["aug", "elo"],
  ["sep", "syys"],
  ["oct", "loka", "okt"],
  ["nov", "marras"],
  ["dec", "joulu"],
];
const GOAL_WORDS: Record<string, string[]> = {
  price: ["price", "cheap", "cost", "halvin", "hinta", "edullis", "billig", "budget"],
  co2: ["co2", "carbon", "climate", "hiili", "ilmasto", "klimat", "emission"],
  reliability: ["reliab", "on time", "dependab", "varma", "luotett", "pålitlig"],
};
const FAT_WORDS: Record<string, string[]> = {
  fat_free: ["skim", "fat-free", "fat free", "rasvaton", "0.1", "0,1", "mager"],
  fat_1_5: ["semi", "1.5", "1,5", "kevyt", "mellanmjölk"],
  fat_3_5: ["whole", "full", "3.5", "3,5", "täysi", "standard", "helmjölk"],
};

const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
const digits = (n: number) => [String(n), String(n).replace(".", ",")];

/** Terms of which at least one must appear in the quote. `undefined`: the overlap test below decides. */
function supportTerms(f: MemoryFact): string[] | undefined {
  switch (f.kind) {
    case "allergen":
      return [f.allergen, ...(ALLERGEN_WORDS[f.allergen] ?? [])];
    case "diet":
      return CLAIM_WORDS[f.claim] ?? [f.claim.replaceAll("_", " ")];
    case "spec":
      return f.dimension === "lactose" ? CLAIM_WORDS.lactose_free : f.dimension === "organic" ? CLAIM_WORDS.organic : (FAT_WORDS[f.choice] ?? ["fat", "rasva"]);
    case "brand":
      return [f.brand];
    case "pack":
      return [...digits(f.packSize), "pack", "box", "carton", "litre", "liter", "pakkau", "laatikko"];
    case "delivery_days":
      return f.weekdays.flatMap((d) => WEEKDAY_WORDS[d]).concat(["weekday", "every day", "daily"]);
    case "receiving_hours":
      return [f.from.slice(0, 2).replace(/^0/, ""), f.to.slice(0, 2).replace(/^0/, "")];
    case "budget":
      return [...(f.weeklyCents ? digits(f.weeklyCents / 100) : []), ...(f.perOrderCents ? digits(f.perOrderCents / 100) : [])];
    case "standing_order":
      return [...digits(f.amount), ...digits(f.low), ...digits(f.high)];
    case "seasonal":
      return [...f.months.flatMap((m) => MONTH_WORDS[m]), "summer", "winter", "christmas", "easter", "kesä", "joulu", "camp", "event", "season"];
    case "goal":
      return GOAL_WORDS[f.goal];
    default:
      return undefined; // product, substitute, note: word overlap
  }
}

function overlapText(f: MemoryFact): string | undefined {
  if (f.kind === "product") return f.name;
  if (f.kind === "substitute") return f.name;
  if (f.kind === "note") return f.text;
  return undefined;
}

export function supports(quote: string, f: MemoryFact): boolean {
  const q = norm(quote);
  const terms = supportTerms(f);
  if (terms) return terms.some((t) => t.trim() && q.includes(norm(t)));
  const want = words(overlapText(f) ?? "");
  if (!want.length) return false;
  const have = new Set(words(q));
  const hit = want.filter((w) => have.has(w) || [...have].some((h) => h.startsWith(w.slice(0, 5)) && w.length >= 5)).length;
  // A product named by any one distinctive word; a note needs most of its words in the quote.
  return f.kind === "note" ? hit / want.length >= 0.6 : hit >= 1;
}

/** Check a model's candidate against the record. Code-made candidates (orders, events) do not come through here. */
export function checkEvidence(c: Candidate, interaction: Interaction): EvidenceVerdict {
  const { segmentId, quote } = c.evidence;
  if (!segmentId || !quote || norm(quote).length < 3) return { ok: false, reason: "no_evidence: no segment or quote given" };
  const segment = interaction.segments.find((s) => s.id === segmentId);
  if (!segment) return { ok: false, reason: `no_evidence: segment ${segmentId} is not in the record` };
  if (!EVIDENCE_SOURCES.includes(segment.source)) return { ok: false, reason: `not_a_person: ${segment.source} is not a person's words` };
  if (!norm(segment.text).includes(norm(quote))) return { ok: false, reason: "no_evidence: the quote is not in the segment" };
  if (looksLikeInstruction(segment.text) && segment.source !== "buyer") return { ok: false, reason: "instruction_in_content: the segment addresses the agent" };
  if (looksLikeInstruction(quote)) return { ok: false, reason: "instruction_in_content: the quote addresses the agent" };
  if (!supports(quote, c.fact)) return { ok: false, reason: "no_evidence: the quote does not say this" };
  return { ok: true, segment, quote: quote.trim().slice(0, 300) };
}
