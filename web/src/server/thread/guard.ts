import { concernText, fmtFor } from "@/app/k/[kitchen]/thread-words";
import { THREAD_WORDS } from "@/app/k/[kitchen]/thread-words.text";
import { yesOrNo } from "@/server/channels/speech";
import { englishDays } from "./refusal";
import type { AnomalyCard, ThreadAction } from "./types";

/**
 * The mistake check, said: when the agent pauses on a guard, the sentence carries the comparison that triggered it,
 * with both figures and where the usual one comes from, then one plain question offering the likely intended value.
 * The reason comes from the finding's own data (core/concerns.ts, the concern's evidence and its correction), never
 * from the model. Answered in words: "yes, 1 000", "100", "it's for an event" (a yes, its reason recorded).
 */

type Lang = "en" | "fi" | "sv";

const QUESTION: Record<Lang, { either: (asked: string, fix: string) => string; right: string; which: string }> = {
  en: { either: (asked, fix) => `Is ${asked} right, or did you mean ${fix}?`, right: "Is that right?", which: "Which did you mean?" },
  fi: { either: (asked, fix) => `Onko ${asked} oikein, vai tarkoititko ${fix}?`, right: "Onko se oikein?", which: "Kumpaa tarkoitit?" },
  sv: { either: (asked, fix) => `Stämmer ${asked}, eller menade du ${fix}?`, right: "Stämmer det?", which: "Vilket menade du?" },
};

/** The reason of one concern in the buyer's language, with its figures; ids and codes never in it. */
function reasonOf(k: AnomalyCard["concerns"][number], lang: Lang): string {
  const w = THREAD_WORDS[lang];
  const f = fmtFor(lang);
  // An amount against the usual: both figures, and where the usual comes from ("your last 8 orders").
  const e = (k.evidence ?? {}) as { usualAmount?: number; unit?: string; basedOnOrders?: number; asked?: { amount?: number; unit?: string } };
  if ((k.code === "quantity_tenfold" || k.code === "quantity_unusual" || k.code === "amount_above_usual" || k.code === "amount_below_usual" || k.code === "unit_confusion") && e.usualAmount && e.asked?.amount !== undefined) {
    const asked = f.measure(e.asked.amount, e.asked.unit ?? e.unit ?? "");
    const usual = f.measure(e.usualAmount, e.unit ?? "");
    const n = e.basedOnOrders;
    if (lang === "fi") return `Se on ${asked}. Tilaatte tätä yleensä noin ${usual}${n ? ` (viimeiset ${n} tilausta)` : ""}.`;
    if (lang === "sv") return `Det är ${asked}. Ni brukar beställa ungefär ${usual}${n ? ` (de senaste ${n} beställningarna)` : ""}.`;
    return `That's ${asked}. You usually order about ${usual} of this${n ? ` (your last ${n} orders)` : ""}.`;
  }
  // A unit the product is not sold in: the figures from the finding's key ("unit_unclear:50:kg") and its sentence.
  const fromKey = /^[a-z_]+:([\d.]+):(\w+)/.exec(k.key);
  const askedU = e.asked?.unit ? e.asked : fromKey ? { amount: Number(fromKey[1]), unit: fromKey[2] } : undefined;
  if (k.code === "unit_unclear" && askedU?.unit) {
    const sold = /sold by (\w+)/.exec(k.message)?.[1];
    if (sold) {
      const asked = f.measure(askedU.amount ?? 0, askedU.unit);
      e.asked = askedU;
      if (lang === "fi") return `${asked}: tätä myydään yksikössä ${sold}, ei ${askedU.unit}.`;
      if (lang === "sv") return `${asked}: det här säljs per ${sold}, inte per ${askedU.unit}.`;
      return `${asked}: this is sold by the ${sold === "L" ? "litre" : sold === "kg" ? "kilo" : "piece"}, not by the ${askedU.unit === "L" ? "litre" : askedU.unit === "kg" ? "kilo" : "piece"}.`;
    }
  }
  // These say little in the short wording: the finding's own sentence carries the figures (the date, the amount, the rule).
  const rich = ["duplicate_recent", "contradicts_preference", "breaks_remembered_rule", "standing_order_drift", "unrelated_first_order"];
  let text = rich.includes(k.code) && lang === "en" ? k.message : concernText(k, w, f, lang);
  if (rich.includes(k.code) && lang !== "en") {
    const rule = /"([^"]+)"/.exec(k.message)?.[1];
    if (rule) text = `${text.replace(/\.$/, "")}: "${rule}".`;
    const when = typeof k.evidence?.placedAt === "string" ? f.day(String(k.evidence.placedAt).slice(0, 10)) : "";
    if (k.code === "duplicate_recent" && when) text = lang === "fi" ? `Tilasit saman jo ${when.replace(/\.$/, "")}.` : `Du beställde samma sak redan ${when.replace(/\.$/, "")}.`;
  }
  return text
    .replace(/\s*\((?:order|tilaus|beställning) [a-z]+_[0-9a-z]+\)/gi, "")
    // A product family's slug ("cat_10632", "plant_drink") is never said: "this".
    .replace(/\bof cat_\d+\b/g, "of this").replace(/\bcat_\d+\b/g, "this").replace(/\b([a-z]+)_([a-z_]+)\b/g, (m) => m.replaceAll("_", " "))
    .replace(/\s*(Order again\?|Order it anyway\?|Please check the amount\.)\s*$/i, "")
    .trim();
}

/** The guard's sentence and question, in the buyer's language. */
export function guardWords(card: AnomalyCard, lang: Lang): string {
  const k = card.concerns[0];
  if (!k) return "";
  const f = fmtFor(lang);
  // Pieces counted into packs: the count, the packs and the weight, and one yes-or-no question.
  const pc = k.evidence as { pieces?: number; perPack?: number; packs?: number } | undefined;
  const fix = k.corrections[0] ? /^use_([\d.]+)_(\w+)$/.exec(k.corrections[0].id) : null;
  if (k.code === "unit_unclear" && pc?.pieces && pc.perPack && pc.packs && fix) {
    const w = f.measure(Number(fix[1]), fix[2]);
    return {
      en: `${pc.pieces} pieces: a pack holds ${pc.perPack}, so that is ${pc.packs} ${pc.packs === 1 ? "pack" : "packs"} (${w}). Shall I order ${pc.packs === 1 ? "it" : "them"}?`,
      fi: `${pc.pieces} kappaletta: pakkauksessa on ${pc.perPack}, eli ${pc.packs} pakkausta (${w}). Tilaanko ne?`,
      sv: `${pc.pieces} stycken: en förpackning har ${pc.perPack}, alltså ${pc.packs} förpackningar (${w}). Ska jag beställa dem?`,
    }[lang];
  }
  // A count of packs whose size is not known: the readings by pack, the first one named as the one to take, so a
  // plain yes settles it ("Shall I take 2 packs of 0,5 kg (1 kg), or 2 packs of 1 kg (2 kg)?").
  const packReadings = packReadingsOf(k);
  if (packReadings.length >= 2) {
    // Amounts with a decimal comma, as every amount in the thread ("0,11 kg").
    const r = packReadings.slice(0, 3).map((x) => x.label.replace(/(\d)\.(\d)/g, "$1,$2").replace(/ = /, " (").replace(/$/, ")"));
    const or = { en: ", or ", fi: ", vai ", sv: ", eller " }[lang];
    return { en: `The packs come in several sizes. Shall I take ${r.join(or)}?`, fi: `Pakkauksia on eri kokoisia. Otanko ${r.join(or)}?`, sv: `Förpackningarna finns i olika storlekar. Ska jag ta ${r.join(or)}?` }[lang];
  }
  let reason = reasonOf(k, lang);
  const use = k.corrections.map((x) => /^use_([\d.]+)_(\w+)$/.exec(x.id)).find(Boolean);
  const asked = (k.evidence?.asked as { amount?: number; unit?: string } | undefined) ?? (/^[a-z_]+:([\d.]+):(\w+)/.exec(k.key) ? { amount: Number(/^[a-z_]+:([\d.]+):(\w+)/.exec(k.key)![1]), unit: /^[a-z_]+:([\d.]+):(\w+)/.exec(k.key)![2] } : undefined);
  let question: string;
  if (use && asked?.amount !== undefined) {
    // The finding's own question ("did you mean 100 L?") becomes the one plain question with both figures.
    reason = reason.replace(/[,:;]?\s*(did you mean|tarkoititko|menade du)[^?]*\?\s*$/i, ".").replace(/\.\.$/, ".");
    // "20 packs" alone hides what the pack is: said with its size and the total ("20 packs of 20 l, 400 l").
    const pack = Number((k.evidence as { packSize?: number } | undefined)?.packSize);
    const unit = String((k.evidence as { unit?: string } | undefined)?.unit ?? "");
    const fix = use[2] === "pack" && pack > 0 && unit ? `${f.measure(Number(use[1]), "pack")} ${{ en: "of", fi: "à", sv: "à" }[lang]} ${f.measure(pack, unit)} (${f.measure(Number(use[1]) * pack, unit)})` : f.measure(Number(use[1]), use[2]);
    question = QUESTION[lang].either(f.measure(asked.amount, asked.unit ?? ""), fix);
  } else if (k.corrections.some((x) => /^deliver_\d{4}-\d{2}-\d{2}$/.test(x.id))) {
    // A day the kitchen cannot receive: the next one it can, as the question.
    const days = k.corrections.map((x) => /^deliver_(\d{4}-\d{2}-\d{2})$/.exec(x.id)?.[1]).filter((x): x is string => !!x);
    const next = days.at(-1)!;
    const dayName = (lang === "en" ? englishDays(f.day(next)) : f.day(next)).replace(/\.$/, "");
    question = { en: `Shall I make it ${dayName}?`, fi: `Teenkö sen päivälle ${dayName}?`, sv: `Ska jag göra det till ${dayName}?` }[lang];
  } else if (k.code === "duplicate_recent") question = { en: "Shall I order it again on top of it?", fi: "Tilaanko sen uudelleen sen lisäksi?", sv: "Ska jag beställa den igen utöver den?" }[lang];
  else question = k.confirmable ? QUESTION[lang].right : QUESTION[lang].which;
  if (/\?\s*$/.test(reason)) return lang === "en" ? englishDays(reason) : reason;
  const text = `${reason.replace(/\s*$/, "")}${/[.!]$/.test(reason) ? "" : "."} ${question}`;
  return lang === "en" ? englishDays(text) : text;
}

/** The readings of a pack count by pack size ("2 packs of 0.5 kg = 1 kg"), in the concern's own order. */
function packReadingsOf(k: AnomalyCard["concerns"][number]): { id: string; label: string }[] {
  if (k.code !== "unit_unclear" || k.confirmable) return [];
  return k.corrections.filter((x) => / of .+ = /.test(x.label));
}

/** "it's for an event", "we have a party", "that's right": a yes that gives its reason. */
const REASON_YES = /\b(it'?s for|for an? (event|party|banquet|wedding|function)|we have (a|an)|extra guests|big group|that'?s right|correct|on purpose|tapahtuma|juhla|juhliin|tilaisuus|oikein|tarkoituksella|ylimääräisiä vieraita|för ett evenemang|fest|stämmer)\b/i;

/**
 * The buyer's words as an answer to the open guard: a correction by its figure ("100"), a yes ("yes, 1 000"), or a
 * reason that means yes ("it's for an event"). The action is the same as the tap; `reason` is recorded with it.
 */
export function guardAnswerOf(card: AnomalyCard, words: string): { action: ThreadAction; reason?: string } | undefined {
  const k = card.concerns[0];
  if (!k) return undefined;
  const w = words.trim();
  const nums = [...w.matchAll(/\d[\d\s.,]*/g)].map((m) => Number(m[0].replace(/\s/g, "").replace(",", "."))).filter((n) => Number.isFinite(n));
  const asked = (k.evidence?.asked as { amount?: number } | undefined)?.amount ?? Number(/^[a-z_]+:([\d.]+)/.exec(k.key)?.[1] ?? NaN);
  // "5 packs of 400 g", "2 x 2,5 kg": the total names one of the readings offered (5 × 0,4 kg = 2 kg).
  const packs = /(\d+(?:[.,]\d+)?)\s*(?:packs?|pakkaus\w*|förpackning\w*|x|×|kpl|st)\s*(?:of|à|á)?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|ml)\b/i.exec(w);
  if (packs) {
    const n = Number(packs[1].replace(",", "."));
    const size = Number(packs[2].replace(",", "."));
    const u = packs[3].toLowerCase();
    const total = u === "g" ? (n * size) / 1000 : u === "ml" ? (n * size) / 1000 : u === "dl" ? (n * size) / 10 : n * size;
    const unit = u === "g" || u === "kg" ? "kg" : "L";
    const hit = k.corrections.find((x) => {
      const m = /^use_([\d.]+)_(\w+)$/.exec(x.id);
      return m && m[2].toLowerCase() === unit.toLowerCase() && Math.abs(Number(m[1]) - total) < 1e-6 + total * 0.01;
    });
    if (hit) return { action: { type: "concern", requestId: card.requestId, key: k.key, choice: hit.id } };
  }
  for (const x of k.corrections) {
    const use = /^use_([\d.]+)_(\w+)$/.exec(x.id);
    const unitSaid = use && (use[2] === "L" ? /\d\s*(l|litr|liter|litre)/i : use[2] === "kg" ? /\d\s*(kg|kilo)/i : /\d\s*(pcs|kpl|st|pieces?|packs?)/i).test(w);
    if (use && nums.includes(Number(use[1])) && (Number(use[1]) !== asked || unitSaid)) return { action: { type: "concern", requestId: card.requestId, key: k.key, choice: x.id } };
  }
  const yes = yesOrNo(w) === "yes" || (Number.isFinite(asked) && nums.includes(asked));
  // The pack readings offered, the first named as the one to take: a plain yes takes it.
  const readings = packReadingsOf(k);
  if (readings.length >= 2 && yesOrNo(w) === "yes" && !nums.some((n) => n !== asked)) return { action: { type: "concern", requestId: card.requestId, key: k.key, choice: readings[0].id } };
  // A question with one reading to take (pieces counted into packs): a yes, or the figure said again, takes it.
  const pc = k.evidence as { pieces?: number } | undefined;
  if (!k.confirmable && pc?.pieces && k.corrections.length === 1 && (yes || /\b(pcs|pieces|buns|kpl|kappale\w*|st|stycken)\b/i.test(w))) return { action: { type: "concern", requestId: card.requestId, key: k.key, choice: k.corrections[0].id } };
  const reason = REASON_YES.test(w) ? w.slice(0, 200) : undefined;
  if (k.confirmable && (yes || reason)) return { action: { type: "concern", requestId: card.requestId, key: k.key, choice: "confirm" }, ...(reason ? { reason } : {}) };
  if (yesOrNo(w) === "no" && k.corrections.some((x) => /^use_/.test(x.id)) && nums.length === 0) return undefined; // "no" alone: the agent asks what instead
  return undefined;
}
