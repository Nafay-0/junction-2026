import { clock, fullDate, money, moneyShort, num } from "../_ui/plain";
import type { Lang } from "./lang";

const NBSP_SAFE = "\u00a0";

/**
 * Dates, units and the gate's fixed words in the buyer's language. Numbers and money keep the Finnish conventions in
 * every language ("1 280,50 €", "2,5 kg", "14.05", "ti 17.11."), as a Finnish wholesaler writes them; only the
 * words change. Pure functions; `useFormat()` in `provider.tsx` binds them to the current language.
 */

const WEEKDAY_SHORT: Record<Lang, string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  fi: ["su", "ma", "ti", "ke", "to", "pe", "la"],
  sv: ["sön", "mån", "tis", "ons", "tors", "fre", "lör"],
};

/** Monday first, index 1..7 as the kitchen data counts weekdays (1 = Monday). Index 0 is unused. */
export const WEEKDAY_ISO_SHORT: Record<Lang, string[]> = {
  en: ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  fi: ["", "ma", "ti", "ke", "to", "pe", "la", "su"],
  sv: ["", "mån", "tis", "ons", "tors", "fre", "lör", "sön"],
};

export const WEEKDAY_LONG: Record<Lang, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  fi: ["sunnuntai", "maanantai", "tiistai", "keskiviikko", "torstai", "perjantai", "lauantai"],
  sv: ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"],
};

/** "Tue 17.11.", "ti 17.11.", "tis 17.11." for a calendar date (YYYY-MM-DD). */
export function dayL(isoDate: string, lang: Lang): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return `${WEEKDAY_SHORT[lang][d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/** "Tuesday", "tiistai", "tisdag". */
export function weekdayL(isoDate: string, lang: Lang): string {
  return WEEKDAY_LONG[lang][new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

/** "Mon–Fri" / "ma–pe" / "mån–fre" for a run of three or more weekdays (1 = Monday), else "Mon and Wed". */
export function weekdaysL(days: number[], lang: Lang): string {
  const s = [...days].sort((a, b) => a - b);
  const w = WEEKDAY_ISO_SHORT[lang];
  if (s.length >= 3 && s.every((d, i) => i === 0 || d === s[i - 1] + 1)) return `${w[s[0]]}–${w[s.at(-1)!]}`;
  const and = lang === "fi" ? " ja " : lang === "sv" ? " och " : " and ";
  return s.length <= 2 ? s.map((d) => w[d]).join(and) : `${s.slice(0, -1).map((d) => w[d]).join(", ")}${and}${w[s.at(-1)!]}`;
}

/** "12 pcs" / "12 kpl" / "12 st"; "3 packs" / "3 pakkausta" / "3 förpackningar"; "2,5 kg" in every language. */
export function measureL(n: number, unit: string, lang: Lang): string {
  const v = num(n, 2);
  if (unit === "pack") return `${v} ${packWord(n, lang)}`;
  if (unit === "pcs") return `${v}${NBSP_SAFE}${lang === "fi" ? "kpl" : lang === "sv" ? "st" : "pcs"}`;
  return `${v}${NBSP_SAFE}${unit}`;
}

export function packWord(n: number, lang: Lang): string {
  if (lang === "fi") return n === 1 ? "pakkaus" : "pakkausta";
  if (lang === "sv") return n === 1 ? "förpackning" : "förpackningar";
  return n === 1 ? "pack" : "packs";
}

/** "just now", "3 min ago" / "juuri nyt", "3 min sitten" / "nyss", "för 3 min sedan". */
export function agoL(iso: string, lang: Lang, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const m = Math.round(s / 60);
  const h = Math.round(m / 60);
  const q = s < 60 ? `${s} s` : m < 60 ? `${m} min` : `${h} h`;
  if (s < 10) return lang === "fi" ? "juuri nyt" : lang === "sv" ? "nyss" : "just now";
  return lang === "fi" ? `${q} sitten` : lang === "sv" ? `för ${q} sedan` : `${q} ago`;
}

// ---------- the gate's rules, roles and attributes ----------

const RULE_TITLE_FI: Record<string, string> = {
  mandate_agent: "Vain valtakirjassa nimetty agentti",
  mandate_window: "Valtakirjan on oltava voimassa",
  mandate_signature: "Keittiön on allekirjoitettava valtakirja",
  quote_binding: "Hinta on annettava tälle keittiölle",
  quote_expiry: "Kiinteän hinnan on oltava yhä voimassa",
  quote_replay: "Tarjouksella tilataan vain kerran",
  quote_signature: "Hinnassa on oltava tukun allekirjoitus",
  quote_availability: "Vain sitä, mitä on varastossa",
  order_matches_quote: "Tilauksen on vastattava tarjousta tarkalleen",
  category_allowed: "Vain keittiön sallimia tuoteryhmiä",
  required_attributes: "Tuotteiden on täytettävä keittiön vaatimukset",
  forbidden_allergens: "Ei kiellettyjä allergeeneja",
  required_certificates: "Vaaditut sertifikaatit",
  delivery_deadline: "Toimituksen on ehdittävä ajoissa",
  substitution_rule: "Tuotteen vaihtamiseen tarvitaan ihminen",
  substitute_price: "Korvaava tuote saa maksaa vain vähän enemmän",
  weekly_budget: "Viikkobudjetti on ehdoton raja",
  per_order_limit: "Agentin oma ostoraja",
  order_splitting: "Yhtä tarvetta ei pilkota pieniksi tilauksiksi",
  human_confirmation: "Ihminen vahvistaa olennaisen",
  approver_authority: "Jonkun on saatava hyväksyä summa",
  live_lookup_limit: "Ajantasaiset hinnat vain lyhyelle listalle",
  approver_identity: "Vain nimetty henkilö voi hyväksyä",
  operator_suspension: "Tukun henkilökunta on keskeyttänyt agentin",
};

const RULE_TITLE_SV: Record<string, string> = {
  mandate_agent: "Endast agenten som fullmakten nämner",
  mandate_window: "Fullmakten måste vara i kraft",
  mandate_signature: "Fullmakten måste vara undertecknad av köket",
  quote_binding: "Priset måste vara offererat till detta kök",
  quote_expiry: "Det fasta priset måste fortfarande gälla",
  quote_replay: "En offert kan bara användas en gång",
  quote_signature: "Priset måste bära grossistens underskrift",
  quote_availability: "Endast det som finns i lager",
  order_matches_quote: "Beställningen måste motsvara offerten exakt",
  category_allowed: "Endast produktgrupper som köket tillåter",
  required_attributes: "Produkterna måste uppfylla kökets krav",
  forbidden_allergens: "Inga förbjudna allergener",
  required_certificates: "Krävda certifikat",
  delivery_deadline: "Leveransen måste hinna fram i tid",
  substitution_rule: "Byte av produkt kräver en person",
  substitute_price: "En ersättande produkt får kosta bara lite mer",
  weekly_budget: "Veckobudgeten är en fast gräns",
  per_order_limit: "Agentens egen beloppsgräns",
  order_splitting: "Ett behov delas inte upp i små beställningar",
  human_confirmation: "En person bekräftar det som spelar roll",
  approver_authority: "Någon måste få godkänna beloppet",
  live_lookup_limit: "Aktuella priser bara för en kort lista",
  approver_identity: "Endast den namngivna personen kan godkänna",
  operator_suspension: "Avstängd av grossistens personal",
};

const RULE_TITLE_EN: Record<string, string> = {
  mandate_agent: "Only the agent named in the mandate",
  mandate_window: "The mandate must be in force",
  mandate_signature: "The mandate must be signed by the kitchen",
  quote_binding: "The price must be quoted to this kitchen",
  quote_expiry: "The fixed price must still hold",
  quote_replay: "A quote buys only once",
  quote_signature: "The price must carry the wholesaler's signature",
  quote_availability: "Only what is in stock",
  order_matches_quote: "The order must match the quote exactly",
  category_allowed: "Only product groups the kitchen allows",
  required_attributes: "Products must meet the kitchen's requirements",
  forbidden_allergens: "No forbidden allergens",
  required_certificates: "Required certificates",
  delivery_deadline: "Must arrive in time",
  substitution_rule: "Swapping products needs a person",
  substitute_price: "A swap may cost only a little more",
  weekly_budget: "The weekly budget is a hard limit",
  per_order_limit: "The agent's own spending limit",
  order_splitting: "No splitting one need into small orders",
  human_confirmation: "A person confirms what matters",
  approver_authority: "Someone must be allowed to sign the amount",
  live_lookup_limit: "Live price checks for a short list only",
  approver_identity: "Only the named person can sign off",
  operator_suspension: "Suspended by the wholesaler's staff",
};

const RULE_TITLES: Record<Lang, Record<string, string>> = { en: RULE_TITLE_EN, fi: RULE_TITLE_FI, sv: RULE_TITLE_SV };
const RULE_FALLBACK: Record<Lang, string> = { en: "A rule of the gate", fi: "Portin sääntö", sv: "En regel i grinden" };

export function ruleTitleL(rule: string | undefined, lang: Lang): string {
  return (rule && RULE_TITLES[lang][rule]) || RULE_FALLBACK[lang];
}

const ROLES: Record<Lang, Record<string, string>> = {
  en: { head_chef: "head chef", owner: "owner", kitchen_manager: "kitchen manager", finance_director: "finance director", purchasing_manager: "purchasing manager" },
  fi: { head_chef: "keittiömestari", owner: "omistaja", kitchen_manager: "keittiöpäällikkö", finance_director: "talousjohtaja", purchasing_manager: "hankintapäällikkö" },
  sv: { head_chef: "köksmästare", owner: "ägare", kitchen_manager: "kökschef", finance_director: "ekonomidirektör", purchasing_manager: "inköpschef" },
};

export function roleLabelL(role: string, lang: Lang): string {
  return ROLES[lang][role] ?? role.replaceAll("_", " ");
}

const ATTRS: Record<Lang, Record<string, string>> = {
  en: { lactose_free: "lactose-free", fat_free: "fat-free", fat_1_5: "semi-skimmed 1.5 %", fat_3_5: "whole 3.5 %", organic: "organic", vegan: "vegan", gluten: "gluten", nuts: "nuts", plant_drink: "plant drinks" },
  fi: { lactose_free: "laktoositon", fat_free: "rasvaton", fat_1_5: "kevyt 1,5 %", fat_3_5: "täysi 3,5 %", organic: "luomu", vegan: "vegaaninen", gluten: "gluteeni", nuts: "pähkinät", plant_drink: "kasvijuomat" },
  sv: { lactose_free: "laktosfri", fat_free: "fettfri", fat_1_5: "lätt 1,5 %", fat_3_5: "hel 3,5 %", organic: "ekologisk", vegan: "vegansk", gluten: "gluten", nuts: "nötter", plant_drink: "växtdrycker" },
};

export function attrL(a: string, lang: Lang): string {
  return ATTRS[lang][a] ?? a.replaceAll("_", " ");
}

/** Who did it, in words, for the buyer's own record. */
export function actorLabelL(actor: string, lang: Lang, names: { agent?: string } = {}): string {
  if (actor === "dock") return "AimoPilot";
  if (actor.startsWith("agent:")) return names.agent ?? (lang === "fi" ? "Ostoagentti" : lang === "sv" ? "Inköpsagent" : "Buyer agent");
  if (actor.startsWith("buyer:")) return actor.slice(6);
  if (actor.startsWith("approver:")) {
    const r = roleLabelL(actor.slice(9), lang);
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  return lang === "fi" ? "Tuntematon kutsuja" : lang === "sv" ? "Okänd anropare" : "Unknown caller";
}

export { clock, fullDate, money, moneyShort, num };
