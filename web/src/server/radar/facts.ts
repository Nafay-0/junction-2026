import type { Evidence, HazardKind, Lots, NoticeFacts, NoticeProduct } from "./types";
import { appearsIn, findDates, findGtins, fold, parsePack, sentences, validGtin } from "./text";

/**
 * From page text to facts. Two readers feed this, and code has the last word:
 *
 *   the model   Context.dev's JSON extraction reads the notice against NOTICE_SCHEMA and copies the sentence each
 *               fact came from. It proposes; nothing it says is used unless code finds it on the page.
 *   code        finds every GTIN with a valid check digit, every best-before date and batch code, the hazard by its
 *               words, and the labelled fields of the authority's format ("Tuote:", "EAN:", "Parasta ennen:").
 *
 * An EAN the model gives that is not in the page text, or fails its check digit, is dropped. A product name whose
 * sentence is not on the page is kept for people to read but marked unverified, and an unverified name never
 * confirms a match (see match.ts).
 */

/** What Context.dev's JSON extraction is asked for. Nullable fields, so a missing fact stays missing. */
export const NOTICE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    published: { type: ["string", "null"], description: "Publication date exactly as written on the page." },
    language: { type: "string", enum: ["fi", "sv", "en"] },
    is_recall_notice: { type: "boolean", description: "True only if the page announces a recall or withdrawal of a food or food-contact product." },
    producer: {
      type: ["object", "null"],
      properties: { name: { type: "string" }, sentence: { type: "string", description: "The sentence naming the company, copied verbatim." } },
    },
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Product name exactly as written, without the pack size if it is separate." },
          brand: { type: ["string", "null"] },
          producer: { type: ["string", "null"] },
          pack_size: { type: ["string", "null"], description: "Pack size as written, e.g. '2,5 dl' or '3x1 kg'." },
          eans: { type: "array", items: { type: "string" }, description: "EAN/GTIN codes listed for this product, digits only." },
          best_before: { type: "array", items: { type: "string" }, description: "Best-before or use-by dates the recall is limited to, as written." },
          batch_codes: { type: "array", items: { type: "string" }, description: "Batch, lot or stamp codes the recall is limited to, as written." },
          sentence: { type: "string", description: "The sentence or list line naming this product, copied verbatim from the page." },
        },
        required: ["name", "sentence"],
      },
    },
    hazard: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["allergen", "microbial", "foreign_body", "chemical", "spoilage", "labelling", "other"] },
        allergens: { type: "array", items: { type: "string" }, description: "Undeclared allergens, in English (milk, eggs, gluten, nuts, peanuts, soy, mustard, celery, sesame, fish, crustaceans, molluscs, lupin, sulphites)." },
        sentence: { type: "string", description: "The sentence stating the hazard, copied verbatim." },
        english: { type: "string", description: "That sentence in English." },
      },
    },
    consumer_action: {
      type: ["object", "null"],
      properties: { sentence: { type: "string", description: "What consumers are told to do, copied verbatim." }, english: { type: "string" } },
    },
    business_action: {
      type: ["object", "null"],
      properties: { sentence: { type: "string", description: "What shops, restaurants or professional kitchens are told to do, copied verbatim, if the page says." }, english: { type: "string" } },
    },
    summary_english: { type: "string", description: "Two plain sentences in English: what is recalled and why." },
  },
  required: ["title", "products", "hazard"],
} as const;

export const NOTICE_INSTRUCTIONS =
  "This is a food recall notice from a food authority, producer or retailer, in Finnish, Swedish or English. Use only facts stated on the page. Copy every 'sentence' field verbatim in the page's own language, character for character; do not translate or shorten it. Put English only in the 'english' and 'summary_english' fields. List every recalled product separately with its own EAN codes and dates. If a field is not stated, use null or an empty list.";

export type ModelNotice = {
  title?: string;
  published?: string | null;
  language?: string;
  is_recall_notice?: boolean;
  producer?: { name?: string; sentence?: string } | null;
  products?: { name?: string; brand?: string | null; producer?: string | null; pack_size?: string | null; eans?: string[]; best_before?: string[]; batch_codes?: string[]; sentence?: string }[];
  hazard?: { category?: string; allergens?: string[]; sentence?: string; english?: string };
  consumer_action?: { sentence?: string; english?: string } | null;
  business_action?: { sentence?: string; english?: string } | null;
  summary_english?: string;
};

const BB_WORDS = /(parasta ennen|viimeinen kayttopaiva|kayttopaiva|bast fore|sista forbrukningsdag|best before|use by|bb\b|pe\b)/;
const UP_TO_WORDS = /(tai aiemp|tai sita aiemp|ja aiemm|tai aikaisemm|eller tidigare|eller tidigare|or earlier|and earlier|tai ennen|eller fore)/;
const BATCH_RE = /\b(?:era(?:numero|koodi|tunnus|nro)?|tuotantoera|batch(?:nummer| number| code)?|lot(?:nummer| number)?|parti(?:nummer)?)[a-z]{0,4}\s*[:#]?\s*((?:[a-z]{0,3}\d[a-z0-9/-]{2,})(?:\s*(?:,|ja|och|and)\s*(?:[a-z]{0,3}\d[a-z0-9/-]{2,}))*)/gi;
const MARK_RE = /\b(\d[A-Z]{2}\d{4,6})\b/g;

/** Notice-wide lot limits found by code: best-before dates near their words, batch codes, egg stamps. */
export function lotsFromText(text: string, ref: string): Lots {
  const bestBefore = new Set<string>();
  let upTo: string | undefined;
  for (const s of sentences(text)) {
    const f = fold(s);
    if (!BB_WORDS.test(f)) continue;
    const dates = findDates(s, ref);
    dates.forEach((d) => bestBefore.add(d));
    if (dates.length && UP_TO_WORDS.test(f)) upTo = [upTo, ...dates].filter(Boolean).sort().pop();
  }
  const batches = new Set<string>();
  for (const m of fold(text).matchAll(BATCH_RE)) for (const code of m[1].split(/\s*(?:,|ja|och|and)\s*/)) if (/\d/.test(code)) batches.add(code.toUpperCase());
  const marks = new Set<string>();
  for (const s of sentences(text)) if (/leima|stamp|stampel|merkitty/i.test(fold(s))) for (const m of s.matchAll(MARK_RE)) marks.add(m[1]);
  return { bestBefore: [...bestBefore].sort(), ...(upTo ? { bestBeforeUpTo: upTo } : {}), batches: [...batches], marks: [...marks] };
}

const HAZARD_WORDS: [HazardKind, RegExp][] = [
  ["microbial", /salmonell|listeri|e\.? ?coli|ehec|stec|norovir|hepatiit|bakteeri|bacteri|clostrid|bacillus|kolibakt|mikrob|cronobacter|shigell|campylobac/],
  ["allergen", /allergee|allergen|ilmoittamaton|ilmoittamatonta|odeklarer|deklarerad|undeclared|allerg/],
  ["foreign_body", /vierasesine|lasinsiru|lasinpal|muovinpal|metallinpal|kovia pal|frammande foremal|glasbit|plastbit|metallbit|foreign (body|object)|kumipal/],
  ["chemical", /torjunta-aine|kadmium|lyijy|aflatoks|hometoks|okratoks|melamiin|formaldehy|etyleenioks|bekampningsmedel|bly\b|kadmium|toxin|nikotiinihap|glyserol|liikaa|ylitys|pesticid/],
  ["spoilage", /sailyvyy|pilaantu|hometta|saumausvirhe|hallbarhet|mogel|spoil|mould|mold/],
  ["labelling", /merkinn|ainesosaluettelo|etiketti|markning|label|vaarankieli/],
];

const ALLERGEN_WORDS: [string, RegExp][] = [
  ["milk", /maito|maidon|mjolk|milk|laktoos|lactose/],
  ["eggs", /kananmun|munaa|\bagg\b|\begg/],
  ["gluten", /gluteen|gluten|vehna|vete\b|wheat|ohra|ruis|speltti/],
  ["peanuts", /maapahkin|jordnot|peanut/],
  ["nuts", /(?<!maa)pahkin|hasselpahk|mantel|cashew|(?<!jord)not(ter)?\b|hazelnut|almond|walnut/],
  ["soy", /soija|soja|\bsoy/],
  ["mustard", /sinap|senap|mustard/],
  ["celery", /selleri|celery/],
  ["sesame", /seesam|sesam/],
  ["fish", /\bkala|\bfisk|\bfish/],
  ["crustaceans", /ayriai|kraftdjur|crustacean/],
  ["sulphites", /sulfiit|rikkidioks|sulfit|sulphite/],
  ["lupin", /lupiini|lupin/],
];

export function hazardFromText(text: string, modelKind?: string): { kind: HazardKind; allergens: string[] } {
  const f = fold(text);
  let kind = (HAZARD_WORDS.find(([, re]) => re.test(f))?.[0] ?? "other") as HazardKind;
  if (modelKind && ["allergen", "microbial", "foreign_body", "chemical", "spoilage", "labelling", "other"].includes(modelKind) && kind === "other") kind = modelKind as HazardKind;
  const allergens = kind === "allergen" ? ALLERGEN_WORDS.filter(([, re]) => re.test(f)).map(([a]) => a) : [];
  return { kind, allergens };
}

const CONSUMER_ACTION = /palauttaa|palauttamaan|palautettava|ostopaikkaan|ei tule syoda|ei pida syoda|ala syo|ei kayteta|havittaa|havita|returnera|lamna tillbaka|inte ata|kassera|return (it|the product)|do not eat|should not be eaten|dispose/;
const BUSINESS_ACTION = /ravintol|suurtalou|ammattikeitti|tukku|myymal.*poist|poistettu myynnista|vetaa? myynnista|storkok|restaurang|grossist|foodservice|horeca|restaurant use|ravintolakaytt/;

/** Labelled fields of the authority's format, and of the drill page that copies it. */
function labelled(text: string, labels: string[]): string | undefined {
  for (const line of text.split(/\n|(?<=\.)\s+(?=[A-ZÅÄÖ][a-zåäö]+:)/)) {
    for (const l of labels) {
      const m = new RegExp(`^\\s*[-•*]?\\s*\\**${l}\\**\\s*:\\s*\\**(.+?)\\**\\s*$`, "i").exec(line.trim());
      if (m && m[1].trim()) return m[1].trim();
    }
  }
  return undefined;
}

function ev(value: string | undefined | null, sentence: string | undefined | null, text: string, english?: string): Evidence | undefined {
  if (!value || !value.trim()) return undefined;
  const v = value.trim();
  const s = sentence?.trim() || undefined;
  const verified = appearsIn(s, text) || appearsIn(v, text);
  return { value: v, ...(s ? { sentence: s } : {}), verified, ...(english ? { english } : {}) };
}

function sentenceWith(text: string, needle: string): string | undefined {
  const n = fold(needle);
  return sentences(text).find((s) => fold(s).includes(n));
}

/** Code's own reading of a notice in the authority's labelled format (always run; the only reader without a model). */
export function productsFromLabels(text: string, ref: string): NoticeProduct[] {
  const name = labelled(text, ["Tuote", "Tuotteen nimi", "Produkt", "Produktens namn", "Product", "Product name"]);
  if (!name) return [];
  const brand = labelled(text, ["Tuotemerkki", "Merkki", "Varumärke", "Märke", "Brand"]);
  const producer = labelled(text, ["Valmistaja", "Tillverkare", "Producer", "Manufacturer", "Maahantuoja", "Importör"]);
  const pack = labelled(text, ["Pakkauskoko", "Pakkaus", "Förpackningsstorlek", "Förpackning", "Pack size"]);
  const ean = labelled(text, ["EAN", "EAN-koodi", "EAN-kod", "GTIN"]);
  const bb = labelled(text, ["Parasta ennen", "Viimeinen käyttöpäivä", "Bäst före", "Sista förbrukningsdag", "Best before"]);
  const batch = labelled(text, ["Erä", "Eränumero", "Batch", "Parti", "Lot"]);
  const line = (v?: string) => (v ? sentenceWith(text, v) : undefined);
  return [
    {
      name: ev(name, line(name), text)!,
      ...(brand ? { brand: ev(brand, line(brand), text)! } : {}),
      ...(producer ? { producer: ev(producer, line(producer), text)! } : {}),
      ...(pack ? { pack: ev(pack, line(pack), text)! } : {}),
      eans: ean ? findGtins(ean) : [],
      lots: { bestBefore: bb ? findDates(bb, ref) : [], batches: batch ? batch.split(/\s*,\s*/).filter((b) => /\d/.test(b)) : [], marks: [] },
    },
  ];
}

/**
 * The facts of one notice. `model` is Context.dev's JSON extraction when it ran; without it (the page was read
 * directly) code's labelled-field and keyword reading stands alone.
 */
export function buildFacts(input: { text: string; title: string; publishedOn?: string; model?: ModelNotice; seenOn: string }): NoticeFacts {
  const { text, model } = input;
  const ref = input.publishedOn ?? input.seenOn;
  const pageEans = findGtins(text);
  const lots = lotsFromText(text, ref);

  const products: NoticeProduct[] = [];
  for (const p of model?.products ?? []) {
    const name = ev(p.name, p.sentence, text);
    if (!name) continue;
    const eans = (p.eans ?? []).map((e) => e.replace(/\D/g, "")).filter((e) => validGtin(e) && pageEans.includes(e));
    const bb = (p.best_before ?? []).flatMap((d) => (appearsIn(d, text) || text.includes(d) ? findDates(d, ref) : []));
    const batches = (p.batch_codes ?? []).filter((b) => b && text.toLowerCase().includes(b.toLowerCase()));
    products.push({
      name,
      ...(p.brand ? { brand: ev(p.brand, p.sentence, text)! } : {}),
      ...(p.producer ? { producer: ev(p.producer, p.sentence, text)! } : {}),
      ...(p.pack_size ? { pack: ev(p.pack_size, p.sentence, text)! } : {}),
      eans,
      lots: { bestBefore: [...new Set(bb)].sort(), batches, marks: [] },
    });
  }
  // Code's reading of the labelled format joins (or, without a model, stands alone).
  for (const lp of productsFromLabels(text, ref)) {
    const dup = products.find((p) => fold(p.name.value) === fold(lp.name.value));
    if (dup) {
      dup.eans = [...new Set([...dup.eans, ...lp.eans])];
      if (!dup.pack && lp.pack) dup.pack = lp.pack;
      if (!dup.brand && lp.brand) dup.brand = lp.brand;
      if (!dup.producer && lp.producer) dup.producer = lp.producer;
      dup.lots.bestBefore = [...new Set([...dup.lots.bestBefore, ...lp.lots.bestBefore])].sort();
      dup.lots.batches = [...new Set([...dup.lots.batches, ...lp.lots.batches])];
    } else products.push(lp);
  }
  // A pack size written into the name counts as the pack.
  for (const p of products) if (!p.pack && parsePack(p.name.value)) p.pack = { value: parsePack(p.name.value)!.text, sentence: p.name.sentence, verified: p.name.verified };

  const hz = hazardFromText(`${input.title}\n${model?.hazard?.sentence ?? ""}\n${text}`, model?.hazard?.category);
  const allergens = [...new Set([...hz.allergens, ...(hz.kind === "allergen" ? (model?.hazard?.allergens ?? []).map((a) => a.toLowerCase()) : [])])];
  const hazardSentence = model?.hazard?.sentence && appearsIn(model.hazard.sentence, text) ? model.hazard.sentence : sentences(text).find((s) => HAZARD_WORDS.some(([k, re]) => k === hz.kind && re.test(fold(s))));

  const consumerModel = model?.consumer_action?.sentence;
  const consumerSentence = consumerModel && appearsIn(consumerModel, text) ? consumerModel : sentences(text).find((s) => CONSUMER_ACTION.test(fold(s)));
  const businessModel = model?.business_action?.sentence;
  const businessSentence = businessModel && appearsIn(businessModel, text) ? businessModel : sentences(text).find((s) => BUSINESS_ACTION.test(fold(s)));
  const sameAsModel = (s: string | undefined, m: string | undefined) => !!s && !!m && s === m;

  const producerName = model?.producer?.name ?? labelled(text, ["Valmistaja", "Tillverkare", "Producer", "Manufacturer"]);
  return {
    products,
    ...(producerName ? { producer: ev(producerName, model?.producer?.sentence ?? sentenceWith(text, producerName), text) } : {}),
    hazard: {
      kind: hz.kind,
      allergens,
      ...(hazardSentence ? { text: { value: hazardSentence, sentence: hazardSentence, verified: appearsIn(hazardSentence, text), ...(sameAsModel(hazardSentence, model?.hazard?.sentence) && model?.hazard?.english ? { english: model.hazard.english } : {}) } } : {}),
    },
    ...(consumerSentence
      ? { consumerAction: { value: consumerSentence, sentence: consumerSentence, verified: appearsIn(consumerSentence, text), ...(sameAsModel(consumerSentence, consumerModel) && model?.consumer_action?.english ? { english: model.consumer_action.english } : {}) } }
      : {}),
    ...(businessSentence
      ? { businessAction: { value: businessSentence, sentence: businessSentence, verified: appearsIn(businessSentence, text), ...(sameAsModel(businessSentence, businessModel) && model?.business_action?.english ? { english: model.business_action.english } : {}) } }
      : {}),
    eans: pageEans,
    lots: {
      bestBefore: [...new Set([...lots.bestBefore, ...products.flatMap((p) => p.lots.bestBefore)])].sort(),
      ...(lots.bestBeforeUpTo ? { bestBeforeUpTo: lots.bestBeforeUpTo } : {}),
      batches: [...new Set([...lots.batches, ...products.flatMap((p) => p.lots.batches)])],
      marks: lots.marks,
    },
    ...(model?.summary_english ? { summaryEnglish: model.summary_english } : {}),
  };
}
