import { isoWeekday } from "@/core/kitchen";
import type { SpokenReadBack } from "./pipeline";
import type { AgentTurn, Card, OptionView, ThreadStep } from "./types";

/**
 * What the voice door says, by plain code, from the same agent turn the thread shows (docs/doors.md "Spoken well").
 * The written reply is not read aloud as it stands: it is made shorter, its figures are said as a person says them,
 * marks, codes and addresses go, a long list is summarised, and anything that needs eyes or a finger says what it is.
 * Nothing here adds a fact: every figure comes from the turn's own line or its cards.
 */

export type Lang = "en" | "fi" | "sv";

const MONTH: Record<Lang, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fi: ["tammikuuta", "helmikuuta", "maaliskuuta", "huhtikuuta", "toukokuuta", "kesäkuuta", "heinäkuuta", "elokuuta", "syyskuuta", "lokakuuta", "marraskuuta", "joulukuuta"],
  sv: ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"],
};
const WEEKDAY: Record<Lang, string[]> = {
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  fi: ["maanantaina", "tiistaina", "keskiviikkona", "torstaina", "perjantaina", "lauantaina", "sunnuntaina"],
  sv: ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"],
};
const ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first"];

/** 2026-11-16 -> "Monday the sixteenth of November" / "maanantaina 16. marraskuuta" / "måndag den 16 november". */
export function sayDay(iso: string, lang: Lang): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  const wd = WEEKDAY[lang][isoWeekday(iso.slice(0, 10)) - 1];
  if (lang === "fi") return `${wd} ${d}. ${MONTH.fi[m - 1]}`;
  if (lang === "sv") return `${wd} den ${d} ${MONTH.sv[m - 1]}`;
  return `${wd} the ${ORDINAL[d]} of ${MONTH.en[m - 1]}`;
}

/** 101000 cents -> "1010 euros"; 1140 -> "11 euros 40" / "11 euroa 40 senttiä" / "11 euro och 40 cent". */
export function sayEuros(cents: number, lang: Lang): string {
  const e = Math.floor(Math.round(cents) / 100);
  const c = Math.round(cents) % 100;
  if (lang === "fi") return c ? `${e} euroa ${c} senttiä` : `${e} euroa`;
  if (lang === "sv") return c ? `${e} euro och ${c} cent` : `${e} euro`;
  return c ? `${e} euro${e === 1 ? "" : "s"} ${c}` : `${e} euro${e === 1 ? "" : "s"}`;
}

const UNIT: Record<Lang, Record<string, [string, string]>> = {
  en: { L: ["litre", "litres"], l: ["litre", "litres"], kg: ["kilo", "kilos"], g: ["gram", "grams"], pcs: ["piece", "pieces"], pack: ["pack", "packs"] },
  fi: { L: ["litra", "litraa"], l: ["litra", "litraa"], kg: ["kilo", "kiloa"], g: ["gramma", "grammaa"], pcs: ["kappale", "kappaletta"], pack: ["pakkaus", "pakkausta"] },
  sv: { L: ["liter", "liter"], l: ["liter", "liter"], kg: ["kilo", "kilo"], g: ["gram", "gram"], pcs: ["styck", "styck"], pack: ["förpackning", "förpackningar"] },
};

/** 12 L -> "12 litres"; 2.5 kg -> "2.5 kilos" (fi/sv "2,5"). */
export function sayAmount(amount: number, unit: string, lang: Lang): string {
  const words = UNIT[lang][unit] ?? [unit, unit];
  const n = lang === "en" ? String(amount) : String(amount).replace(".", ",");
  return `${n} ${amount === 1 ? words[0] : words[1]}`;
}

const SHORT_DAY: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const SHORT_MONTH: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** A screen sentence pointing at something without saying what it is: dropped (what it is is said by the cards). */
const SCREEN_ONLY = /^(tap|click|press|see|scroll|open|use the button|napauta|klikkaa|paina|katso|avaa|tryck|klicka|se )\b|\b(below|above|the button|alla olevaa|painiketta|knappen|nedan)\b/i;

/**
 * The written line as it is spoken: no marks, no codes or addresses, money and days as said, units in words,
 * thousands without spaces. `max` words, whole sentences only; what is cut is said as what it is.
 */
export function speakable(text: string, lang: Lang, max = 45, rest = true): string {
  let t = text.replace(/\*\*|\{\{|\}\}|__|`/g, "");
  t = t.replace(/https?:\/\/\S+/g, "").replace(/\b(req|ord|apr|trn|sht|pln|card|call|sbx|qt|quo|q)_[A-Za-z0-9_-]{4,}\b/g, "");
  // Money: "1 010,00 €", "€1,010.00", "11,40 €", "101 €" -> euros as said.
  const cents = (whole: string, frac?: string) => Math.round(Number(whole.replace(/[\s  ,.](?=\d{3}\b)/g, "").replace(/[\s  ]/g, "")) * 100 + (frac ? Number(frac.padEnd(2, "0").slice(0, 2)) : 0));
  t = t.replace(/(\d{1,3}(?:[\s  .,]\d{3})*|\d+)(?:[,.](\d{1,2}))?\s?€/g, (_, w: string, f?: string) => sayEuros(cents(w, f), lang));
  t = t.replace(/€\s?(\d{1,3}(?:[,\s]\d{3})*|\d+)(?:\.(\d{1,2}))?/g, (_, w: string, f?: string) => sayEuros(cents(w, f), lang));
  // Days: ISO dates, "16.11." and "Mon 16 Nov".
  t = t.replace(/\b(20\d\d-\d\d-\d\d)\b/g, (_, iso: string) => sayDay(iso, lang));
  t = t.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/g, (_, wd: string, d: string, mo: string) => (lang === "en" ? `${SHORT_DAY[wd]} the ${ORDINAL[Number(d)]} of ${MONTH.en[SHORT_MONTH[mo] - 1]}` : `${d}. ${MONTH[lang][SHORT_MONTH[mo] - 1]}`));
  t = t.replace(/\b(\d{1,2})\.(\d{1,2})\.(?:(20\d\d)\.?)?/g, (m: string, d: string, mo: string, _y: string | undefined, at: number, all: string) => {
    if (!(Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31)) return m;
    const said = lang === "en" ? `the ${ORDINAL[Number(d)]} of ${MONTH.en[Number(mo) - 1]}` : lang === "fi" ? `${d}. ${MONTH.fi[Number(mo) - 1]}` : `${d} ${MONTH.sv[Number(mo) - 1]}`;
    // The date's own dot also ended the sentence: the sentence keeps its full stop.
    const after = all.slice(at + m.length);
    return /^\s*($|[A-ZÅÄÖ])/.test(after) ? `${said}.` : said;
  });
  // Counts: "1 000" -> "1000"; "12 × " -> "12 "; units in words after a number.
  t = t.replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1");
  t = t.replace(/(\d)\s?[×x]\s/g, "$1 ");
  // "10 l boxes" is "10-litre boxes" in English; otherwise an amount and its unit in words.
  if (lang === "en") t = t.replace(/(\d+(?:[.,]\d+)?)\s?(L|l)\s+(box|boxes|carton|cartons|bag|bags|pack|packs|bag-in-box)\b/g, (_, n: string, _u: string, w: string) => `${n.replace(",", ".")}-litre ${w}`);
  t = t.replace(/(\d+(?:[.,]\d+)?)\s?(L|l|kg|g)(?![\p{L}\d-])/gu, (_, n: string, u: string) => sayAmount(Number(n.replace(",", ".")), u, lang));
  t = t.replace(/\s\+\s/g, { en: " and ", fi: " ja ", sv: " och " }[lang]);
  t = t.replace(/[•·▪]\s*/g, "").replace(/\s*\n+\s*/g, ". ").replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  const sentences = t.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“(])/u).map((x) => x.trim()).filter((x) => x && !SCREEN_ONLY.test(x));
  // Over the limit: the first sentences, and the written reply's own closing question if it has one (the buyer has to
  // hear what is asked); the note about the rest only when no question closes it and nothing else follows (`rest`).
  const last = sentences.at(-1);
  const closing = last && /\?\s*$/.test(last) ? last : undefined;
  const body = closing ? sentences.slice(0, -1) : sentences;
  const budget = max - (closing ? closing.split(/\s+/).length : 0);
  const out: string[] = [];
  let words = 0;
  for (const s of body) {
    const n = s.split(/\s+/).length;
    if (out.length && words + n > budget) break;
    out.push(s);
    words += n;
  }
  const cut = out.length < body.length;
  if (closing) out.push(closing);
  else if (cut && rest) out.push({ en: "The rest is written on your screen.", fi: "Loput on kirjoitettuna näytölläsi.", sv: "Resten står på din skärm." }[lang]);
  return out.join(" ");
}

/** Catalogue words a person would not say about a product. */
const NAME_NOISE = /\b(food ?service|ammattilaisille|professional|hyvä suomalainen|suomalainen|arki|bag-in-box|semi[- ]?skimmed|skimmed|milk drink|drink|lactose[- ]free|laktoositon|uht|organic|luomu|\d[\d.,]*\s?(%|l|kg|g|ml|dl|kpl|pcs)\b|box|carton|cartons)/gi;
const KINDS = ["oat drink", "whipping cream", "cooking cream", "sour cream", "cream cheese", "cream", "milk", "yoghurt", "yogurt", "butter", "quark", "cheese", "eggs", "juice", "maito", "kerma", "jogurtti", "voi", "rahka", "juusto", "mjölk", "grädde"];

/**
 * A catalogue name as a person says it: the brand and its line, then what it is ("Valio Hyvä suomalainen Arki® Eila®
 * semi skimmed milk drink 1 l lactose free" is "Valio Eila milk"). Marks, pack sizes and labels go.
 */
const KIND_IN: Record<"fi" | "sv", Record<string, string>> = {
  fi: { "oat drink": "kaurajuoma", "whipping cream": "kuohukerma", "cooking cream": "ruokakerma", "sour cream": "kermaviili", "cream cheese": "tuorejuusto", cream: "kerma", milk: "maito", yoghurt: "jogurtti", yogurt: "jogurtti", butter: "voi", quark: "rahka", cheese: "juusto", eggs: "kananmunat", juice: "mehu" },
  sv: { "oat drink": "havredryck", "whipping cream": "vispgrädde", "cooking cream": "matlagningsgrädde", "sour cream": "gräddfil", "cream cheese": "färskost", cream: "grädde", milk: "mjölk", yoghurt: "yoghurt", yogurt: "yoghurt", butter: "smör", quark: "kvarg", cheese: "ost", eggs: "ägg", juice: "juice" },
};

export function spokenName(name: string, lang: Lang = "en"): string {
  const plain = name.replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
  const found = KINDS.find((k) => new RegExp(`\\b${k}\\b`, "i").test(plain));
  const kind = found && lang !== "en" ? (KIND_IN[lang][found] ?? found) : found;
  const words = plain.replace(NAME_NOISE, " ").replace(/\s+/g, " ").trim().split(" ").map((w) => w.replace(/[,;:]+$/, "")).filter((w) => /\p{L}/u.test(w));
  const head = words.slice(0, 2).filter((w) => !found || !found.split(" ").includes(w.toLowerCase()));
  return [...head, kind ?? words[2] ?? ""].filter(Boolean).join(" ").trim() || plain.split(" ").slice(0, 3).join(" ");
}
const shortName = spokenName;

/** Every product name the turn's cards carry, longest first: what a written line may spell out in full. */
function productNames(turn: AgentTurn): string[] {
  const names = new Set<string>();
  for (const c of turn.cards) {
    if (c.type === "options") for (const o of c.options) {
      names.add(o.title);
      for (const l of o.lines) names.add(l.name);
    }
    if (c.type === "order" || c.type === "price") for (const l of c.lines) names.add(l.name);
  }
  return [...names].filter((n) => n.length > 12).sort((a, b) => b.length - a.length);
}

/**
 * A written reply made fit to hear, whatever the engine wrote: long catalogue names as people say them; a label with
 * a colon ("Lactose-free milk: X in its place.") as a sentence ("X comes in its place."); a clause left hanging
 * (", so for Thursday 19 Nov.") cut; a sentence listing three or more prices dropped when the options are asked
 * about anyway (`listed`), since the question names the first and the cheapest.
 */
export function spokenSentences(text: string, turn: AgentTurn | undefined, opts: { optionsAsked?: boolean } = {}): string {
  let t = text.replace(/[®™]/g, "");
  if (turn) for (const n of productNames(turn)) {
    const plain = n.replace(/[®™]/g, "");
    for (const v of [plain, plain.replace(/\s+\d.*$/, "")]) if (v.length > 12 && t.includes(v)) t = t.split(v).join(spokenName(n));
  }
  // The catalogue's line words a person would not say ("Valio Arki Eila semi").
  t = t.replace(/\bfood ?service\s+/gi, "").replace(/\b(Hyvä suomalainen|Arki)\s+(?=\p{Lu})/gu, "").replace(/\b(Eila|Arla|Valio) semi\b(?![- ]skimmed)/g, "$1 semi-skimmed");
  const sentences = t.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“(*{])/u).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (let x of sentences) {
    // "Label: rest" with no verb in the label: the rest is the sentence.
    const label = /^([^:.!?]{2,40}):\s+(.+)$/.exec(x);
    if (label && label[1].split(/\s+/).length <= 4 && !/\b(is|are|can|can't|cannot|not|will|was|has|have|had|on|ei|eivät|saa|voi|ole|ovat|olen|är|har|inte|kan)\b/i.test(label[1]) && !/n't\b/i.test(label[1]) && !/\d$/.test(label[1])) x = label[2].charAt(0).toUpperCase() + label[2].slice(1);
    // "X in its place." has no verb: it says what comes instead.
    x = x.replace(/^(.{3,80}?) in its place([.!]?)$/i, "$1 comes in its place$2").replace(/^(.{3,80}?) (tilalle|i stället)([.!]?)$/i, "$1 tulee $2$3");
    // A sentence that is only a day ("Torstaiksi 19. marraskuuta.", "For Thursday 19 Nov."): it says nothing alone.
    if (/^(for |by |on |till |på )?(mon|tue|wed|thu|fri|sat|sun|maanantai|tiistai|keskiviikko|torstai|perjantai|lauantai|sunnuntai|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)[\p{L}]*\s*[\d. ]*[\p{L}]*[.!]?$/iu.test(x.replace(/\{\{|\}\}|\*\*/g, "")) && x.split(/\s+/).length <= 5) continue;
    // A clause left hanging after "so": cut.
    x = x.replace(/,?\s+so\s+(for|on|by)\s+[^,.!?]+(?=[.!]?$)/i, "");
    // Prices listed one after another, when the question that follows names the first and the cheapest.
    if (opts.optionsAsked && ((x.match(/€/g) ?? []).length >= 2 || /\b(is first at|costs .{0,30} (more|less)|the cheapest that|halvin|billigast)\b/i.test(x))) continue;
    if (opts.optionsAsked && /\?\s*$/.test(x)) continue;
    out.push(x);
  }
  return out.join(" ");
}

/** The read-back of an order the voice door held (pipeline.ts spokenHold): what, how much, which day, the total. */
export function readBackOf(turn: AgentTurn, hold: SpokenReadBack, lang: Lang): string | undefined {
  const opts = turn.cards.find((c) => c.type === "options" && c.requestId === hold.requestId);
  const price = turn.cards.find((c) => c.type === "price" && c.requestId === hold.requestId);
  let lines: OptionView["lines"] = [];
  let total = 0;
  let day = "";
  let delivered: { amount: number; unit: string } | undefined;
  if (opts?.type === "options") {
    const o = opts.options.find((x) => x.optionId === hold.optionId) ?? opts.options[0];
    if (!o) return undefined;
    ({ lines, totalCents: total, deliveryDate: day, delivered } = o);
  } else if (price?.type === "price") {
    ({ lines, totalCents: total, deliveryDate: day } = price);
  } else return undefined;
  const main = [...lines].sort((a, b) => b.quantity * (b.packSize ?? 1) - a.quantity * (a.packSize ?? 1))[0];
  if (!main) return undefined;
  const amount = delivered && delivered.unit !== "pcs" ? sayAmount(delivered.amount, delivered.unit, lang) : undefined;
  const what = amount ? `${amount} ${{ en: "of", fi: "", sv: "" }[lang]} ${spokenName(main.name, lang)}`.replace(/\s+/g, " ") : `${main.quantity} ${spokenName(main.name, lang)}`;
  const more = lines.length > 1 ? { en: ` and ${lines.length - 1} more`, fi: ` ja ${lines.length - 1} muuta`, sv: ` och ${lines.length - 1} till` }[lang] : "";
  if (lang === "fi") return `${what}${more} ${sayDay(day, "fi")}, ${sayEuros(total, "fi")}. Tilaanko sen?`;
  if (lang === "sv") return `${what}${more} på ${sayDay(day, "sv")}, för ${sayEuros(total, "sv")}. Ska jag beställa det?`;
  return `${what}${more} for ${sayDay(day, "en")}, ${sayEuros(total, "en")}. Shall I order it?`;
}

/** Card facts the written line may leave to the screen, said when the line does not say them already. */
function fromCards(turn: AgentTurn, said: string, lang: Lang): string[] {
  const out: string[] = [];
  const has = (s: string) => said.toLowerCase().includes(s.toLowerCase());
  const gate = turn.cards.find((c) => c.type === "gate" && c.outcome === "waiting");
  if (gate?.type === "gate" && gate.approver?.name && !has(gate.approver.name.split(" ")[0])) {
    out.push({ en: `That's over what I may spend alone, so it needs ${gate.approver.name}'s OK: it's on their phone now.`, fi: `Se ylittää sen, mitä saan käyttää yksin, joten se tarvitsee hyväksynnän (${gate.approver.name}): pyyntö on nyt hänen puhelimessaan.`, sv: `Det är mer än jag får handla för ensam, så det behöver godkännas av ${gate.approver.name}: det ligger i deras telefon nu.` }[lang]);
  }
  const menu = turn.cards.find((c) => c.type === "menu");
  if (menu?.type === "menu" && menu.stage === "ready" && menu.dishes.length && !menu.dishes.some((d) => has(d.name.split(/\s+/)[0]))) {
    const names = menu.dishes.slice(0, 3).map((d) => d.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} ${{ en: "and", fi: "ja", sv: "och" }[lang]} ${names.at(-1)}` : names[0];
    out.push({ en: `The menu: ${list}, ${sayEuros(menu.totalCents, "en")} in all.`, fi: `Menu: ${list}, yhteensä ${sayEuros(menu.totalCents, "fi")}.`, sv: `Menyn: ${list}, totalt ${sayEuros(menu.totalCents, "sv")}.` }[lang]);
  }
  const rules = turn.cards.find((c) => c.type === "rules" && c.proposal?.state === "open");
  if (rules?.type === "rules" && !/(passkey|avainkoodi|pääsyavain|nyckel)/i.test(said)) {
    out.push({ en: "Signing the change needs a passkey: it's on your screen.", fi: "Muutoksen allekirjoitus vaatii pääsyavaimen: se on näytölläsi.", sv: "Ändringen signeras med en passkey: den finns på din skärm." }[lang]);
  }
  return out;
}

/**
 * Options open and nothing else asked: one question a yes answers, about the first option (the store's own order),
 * with its total and day, and the cheapest when that is another. The yes orders exactly that option (`hold`: the
 * engine's read-back answer, engine.ts); any other words ("the cheapest one", "the second") go to the agent as words.
 */
function optionsAsk(turn: AgentTurn, lang: Lang, line = ""): { say: string; hold: SpokenReadBack } | undefined {
  if (turn.status !== "waiting_buyer") return undefined;
  if (turn.cards.some((c) => (c.type === "anomaly" && !c.answered) || c.type === "question" || (c.type === "menu" && (c.stage === "choose" || c.stage === "ready")) || c.type === "sheet")) return undefined;
  const opts = [...turn.cards].reverse().find((c) => c.type === "options" && !c.chosen);
  if (opts?.type !== "options") return undefined;
  const ok = opts.options.filter((o) => o.gate?.outcome !== "reject");
  const lead = ok.find((o) => o.optionId === opts.preselected?.optionId) ?? ok[0];
  if (!lead) return undefined;
  const cheapest = [...ok].sort((a, b) => a.totalCents - b.totalCents)[0];
  const other = cheapest && cheapest.optionId !== lead.optionId ? cheapest : undefined;
  const n = ok.length;
  const name = spokenName(lead.title, lang);
  const named = (o: OptionView) => spokenName(o.title, lang);
  const at = (o: OptionView, l: Lang) => `${sayEuros(o.totalCents, l)}, ${l === "en" ? `for ${sayDay(o.deliveryDate, l)}` : sayDay(o.deliveryDate, l)}`;
  const say =
    n === 1
      ? { en: `I can get ${name} for ${at(lead, "en")}. Shall I order it?`, fi: `Saan ${name}, ${at(lead, "fi")}. Tilaanko sen?`, sv: `Jag kan få ${name} för ${at(lead, "sv")}. Ska jag beställa det?` }[lang]
      : {
          en: `There are ${n} options. The first is ${name} at ${at(lead, "en")}.${other ? ` The cheapest is ${named(other)} at ${sayEuros(other.totalCents, "en")}.` : ""} Shall I order the ${name}?`,
          fi: `Vaihtoehtoja on ${n}. Ensimmäinen on ${name}, ${at(lead, "fi")}.${other ? ` Halvin on ${named(other)}, ${sayEuros(other.totalCents, "fi")}.` : ""} Tilaanko ensimmäisen?`,
          sv: `Det finns ${n} alternativ. Det första är ${name} för ${at(lead, "sv")}.${other ? ` Billigast är ${named(other)} för ${sayEuros(other.totalCents, "sv")}.` : ""} Ska jag beställa det första?`,
        }[lang];
  // The written reply already said how many options there are: not said twice.
  const counted = /\b(\d+|two|three|four|kaksi|kolme|neljä|två|tre|fyra) (options|alternatives|vaihtoehto\w*|alternativ)\b/i.test(line);
  const spoken = counted ? say.replace(/^(There are \d+ options|Vaihtoehtoja on \d+|Det finns \d+ alternativ)\. /, "") : say;
  return { say: spoken, hold: { requestId: opts.requestId, optionId: lead.optionId, turnId: turn.turnId } };
}

export type SpokenReply = { say: string; /** The order the spoken question asks about: the buyer's yes orders it. */ hold?: SpokenReadBack };

/** The whole spoken reply to a finished (or waiting) agent turn, and the order its question asks about, if any. */
export function spokenReply(turn: AgentTurn, lang: Lang, hold?: SpokenReadBack): SpokenReply {
  if (hold && hold.turnId === turn.turnId) {
    const rb = readBackOf(turn, hold, lang);
    if (rb) return { say: rb, hold };
  }
  const ask = optionsAsk(turn, lang, turn.line ?? "");
  // Spoken is shorter than written: about thirty words, whole sentences, made fit to hear. With the options' question,
  // only what the question does not say (an exception: the usual cannot come, a stand-in) stays before it, and the
  // written reply's own question gives way (one question at a time).
  const line = speakable(spokenSentences(turn.line ?? "", turn, { optionsAsked: !!ask }), lang, ask ? 22 : 40, !ask);
  const extra = fromCards(turn, line, lang);
  const said = [line, ...extra, ask?.say ?? ""].filter(Boolean).join(" ").trim();
  if (said) return { say: said, ...(ask ? { hold: ask.hold } : {}) };
  const notice = turn.cards.find((c) => c.type === "notice");
  if (notice?.type === "notice") return { say: speakable(notice.said?.[lang] ?? notice.message, lang) };
  return { say: { en: "Done. It's on your screen.", fi: "Valmis. Se on näytölläsi.", sv: "Klart. Det finns på din skärm." }[lang] };
}

export const spokenOf = (turn: AgentTurn, lang: Lang, hold?: SpokenReadBack): string => spokenReply(turn, lang, hold).say;

/** What the engine is doing now, as a short true acknowledgement: from the newest running step. */
const DOING: Record<string, Record<Lang, string>> = {
  read: { en: "Reading that.", fi: "Luen sen.", sv: "Jag läser det." },
  intake: { en: "Checking that against your history.", fi: "Tarkistan sen historiaanne vasten.", sv: "Jag kollar det mot er historik." },
  lookup: { en: "Checking live prices and the day.", fi: "Tarkistan hinnat ja päivän.", sv: "Jag kollar priser och dag." },
  quote: { en: "Fixing the price with the wholesaler.", fi: "Lukitsen hinnan tukun kanssa.", sv: "Jag låser priset med grossisten." },
  gate: { en: "Checking it against your rules.", fi: "Tarkistan sen sääntöjänne vasten.", sv: "Jag kollar det mot era regler." },
  plan: { en: "Planning that; it takes about half a minute.", fi: "Suunnittelen sitä; se vie noin puoli minuuttia.", sv: "Jag planerar det; det tar ungefär en halv minut." },
  records: { en: "Looking at your orders.", fi: "Katson tilauksianne.", sv: "Jag tittar på era beställningar." },
  products: { en: "Looking through the assortment.", fi: "Käyn läpi valikoimaa.", sv: "Jag går igenom sortimentet." },
  rules: { en: "Looking at your rules.", fi: "Katson sääntöjänne.", sv: "Jag tittar på era regler." },
  memory: { en: "Noting that.", fi: "Merkitsen sen.", sv: "Jag noterar det." },
  offer: { en: "Asking the wholesaler.", fi: "Kysyn tukulta.", sv: "Jag frågar grossisten." },
  tap: { en: "On it.", fi: "Hoidan sen.", sv: "Jag ordnar det." },
};

/** The step to acknowledge: the newest still running, else the newest. */
function currentStep(turn: AgentTurn): ThreadStep | undefined {
  return [...turn.steps].reverse().find((s) => s.status === "running") ?? turn.steps.at(-1);
}

export function ackOf(turn: AgentTurn, lang: Lang): string {
  const s = currentStep(turn);
  return (s && DOING[s.kind]?.[lang]) ?? { en: "One moment.", fi: "Hetki.", sv: "Ett ögonblick." }[lang];
}

/**
 * A milestone of a long piece of work worth saying (a menu's dishes in, a new kind of step started): its key, so it
 * is said once, and the words. Undefined when nothing new has happened since the keys already said.
 */
export function milestoneOf(turn: AgentTurn, said: Set<string>, lang: Lang): { key: string; say: string } | undefined {
  const menu = turn.cards.find((c) => c.type === "menu");
  if (menu?.type === "menu" && menu.dishes.length && !said.has(`menu:${menu.cardId}`) && (menu.stage === "proposing" || menu.stage === "resolving")) {
    const names = menu.dishes.slice(0, 3).map((d) => d.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} ${{ en: "and", fi: "ja", sv: "och" }[lang]} ${names.at(-1)}` : names[0];
    return { key: `menu:${menu.cardId}`, say: { en: `The dishes are in: ${list}. Pricing them now.`, fi: `Ruuat ovat valmiina: ${list}. Hinnoittelen ne nyt.`, sv: `Rätterna är klara: ${list}. Jag prissätter dem nu.` }[lang] };
  }
  const s = currentStep(turn);
  if (s && s.status === "running" && DOING[s.kind] && !said.has(`step:${s.kind}`)) return { key: `step:${s.kind}`, say: DOING[s.kind][lang] };
  return undefined;
}

/** The same work, still going: said once per kind of step, when the work has run long since the last words. */
const STILL: Record<string, Record<Lang, string>> = {
  read: { en: "Still reading your request.", fi: "Luen yhä pyyntöäsi.", sv: "Jag läser fortfarande din beställning." },
  intake: { en: "Still checking your history.", fi: "Tarkistan yhä historiaanne.", sv: "Jag kollar fortfarande er historik." },
  lookup: { en: "Still waiting for the wholesaler's live prices.", fi: "Odotan yhä tukun hintoja.", sv: "Jag väntar fortfarande på grossistens priser." },
  quote: { en: "The wholesaler is still fixing the price.", fi: "Tukku lukitsee yhä hintaa.", sv: "Grossisten låser fortfarande priset." },
  gate: { en: "Still checking it against your rules.", fi: "Tarkistan yhä sääntöjänne vasten.", sv: "Jag kollar fortfarande mot era regler." },
  plan: { en: "Still planning: a menu takes about half a minute.", fi: "Suunnittelen yhä: menu vie noin puoli minuuttia.", sv: "Jag planerar fortfarande: en meny tar ungefär en halv minut." },
  records: { en: "Still going through your orders.", fi: "Käyn yhä läpi tilauksianne.", sv: "Jag går fortfarande igenom era beställningar." },
  products: { en: "Still looking through the assortment.", fi: "Käyn yhä valikoimaa läpi.", sv: "Jag går fortfarande igenom sortimentet." },
  model: { en: "Still working on it.", fi: "Työ on yhä kesken.", sv: "Jag arbetar fortfarande på det." },
};

/** A true line for work that has gone on long with nothing new to say: what it is still doing, once per kind. */
export function stillOf(turn: AgentTurn, said: Set<string>, lang: Lang): { key: string; say: string } | undefined {
  const s = currentStep(turn);
  const kind = s && STILL[s.kind] ? s.kind : "model";
  if (said.has(`still:${kind}`)) return undefined;
  return { key: `still:${kind}`, say: STILL[kind][lang] };
}

/** A turn the buyer still waits on: working, or nothing to say yet. */
export const stillWorking = (turn: AgentTurn) => turn.status === "working";

/** Every card a turn's spoken reply rests on: the facts its figures come from (the grounding check's facts). */
export const factsOf = (turn: AgentTurn): Card[] => turn.cards;
