/**
 * What is in season in Finland, month by month and by kind of product: a small calendar as plain data, from public
 * knowledge, never from the partner's data. The selling agent uses it to say "in season now" only when this calendar
 * backs it; the menu planner can use the same calendar to build a menu around what is in season.
 *
 * Two sorts of season:
 *   harvest  when the Finnish crop, catch or game is fresh (field vegetables, berries, mushrooms, crayfish, moose)
 *   festive  when Finnish kitchens cook it for a feast of the year (Christmas, Shrove Tuesday, Easter, May Day)
 *
 * Each entry names its source. Months are 1 (January) to 12 (December), Finland as a whole; the north is later for
 * harvests. A product matches an entry by its category or by a word in its name (English, Finnish or Swedish), and
 * never when a `not` word is in the name ("katkarapu", shrimp, is not "rapu", crayfish).
 *
 * Browser-safe: no imports, no code beyond the lookups at the end.
 */

export type SeasonSource = { title: string; url: string };
export type SeasonSort = "harvest" | "festive";

export type SeasonEntry = {
  /** Stable slug: "chanterelle", "christmas_cream". */
  kind: string;
  sort: SeasonSort;
  label: { en: string; fi: string; sv: string };
  months: number[];
  /** The month the season peaks in, when it does. */
  peak?: number[];
  /** Why now, in one plain sentence (English): what the season is. */
  why: string;
  match: {
    /** Dock categories (core/catalog/partner.ts CATEGORY_SLUGS) every product of which is this kind. */
    categories?: string[];
    /** Lower-case stems; one of them in the name makes the product this kind. */
    words?: string[];
    /** With `words`: only products of these categories (whipping cream is cream, not a cream cake). */
    within?: string[];
    /** Lower-case stems that rule a name out. */
    not?: string[];
  };
  source: SeasonSource;
};

const SATOKAUSI: SeasonSource = { title: "Satokausikalenteri, satokausi.fi (Satokausi Media Oy)", url: "https://satokausi.fi/" };
const RIISTA: SeasonSource = {
  title: "Suomen riistakeskus: hirvieläinten metsästys alkamassa (press release, STT Info, 2026)",
  url: "https://www.sttinfo.fi/tiedote/72270127/hirvielainten-metsastys-alkamassa?lang=fi",
};
const RAPU: SeasonSource = { title: "Ravustuskausi alkaa 21.7. klo 12 (Kaleva; ELY-keskukset)", url: "https://www.kaleva.fi/ravustuskausi-alkaa-tanaan-laiton-pyynti-voi-kayda/4785727" };
const CHRISTMAS: SeasonSource = { title: "Joulupöytä, Finnish Wikipedia", url: "https://fi.wikipedia.org/wiki/Joulup%C3%B6yt%C3%A4" };
const PIKKUJOULU: SeasonSource = { title: "Pikkujoulu, Finnish Wikipedia", url: "https://fi.wikipedia.org/wiki/Pikkujoulu" };
const LASKIAINEN: SeasonSource = { title: "Laskiainen, Wikipedia", url: "https://en.wikipedia.org/wiki/Laskiainen" };
const RUNEBERG: SeasonSource = { title: "Runeberg torte, Wikipedia", url: "https://en.wikipedia.org/wiki/Runeberg_torte" };
const MAMMI: SeasonSource = { title: "Mämmi, Wikipedia", url: "https://en.wikipedia.org/wiki/M%C3%A4mmi" };
const PASHA: SeasonSource = { title: "Paskha, Wikipedia", url: "https://en.wikipedia.org/wiki/Paskha" };
const VAPPU: SeasonSource = { title: "Sima (mead), Wikipedia", url: "https://en.wikipedia.org/wiki/Sima_(mead)" };

export const SEASON: SeasonEntry[] = [
  // ---------- harvest ----------
  { kind: "rhubarb", sort: "harvest", label: { en: "rhubarb", fi: "raparperi", sv: "rabarber" }, months: [5, 6, 7], peak: [6], why: "Finnish rhubarb is picked from late May to July.", match: { words: ["rhubarb", "raparper", "rabarber"] }, source: SATOKAUSI },
  { kind: "asparagus", sort: "harvest", label: { en: "asparagus", fi: "parsa", sv: "sparris" }, months: [5, 6], why: "Finnish asparagus is cut in May and June.", match: { words: ["asparagus", "parsa", "sparris"], not: ["parsakaal", "broccoli"] }, source: SATOKAUSI },
  { kind: "new_potato", sort: "harvest", label: { en: "new potatoes", fi: "uudet perunat", sv: "färskpotatis" }, months: [6, 7, 8], peak: [7], why: "New potatoes are lifted from Midsummer to August.", match: { words: ["new potato", "uusi peruna", "uudet peruna", "varhaisperuna", "färskpotatis"] }, source: SATOKAUSI },
  { kind: "strawberry", sort: "harvest", label: { en: "strawberries", fi: "mansikat", sv: "jordgubbar" }, months: [6, 7, 8], peak: [7], why: "Finnish strawberries are picked from late June to August.", match: { words: ["strawberr", "mansik", "jordgubb"] }, source: SATOKAUSI },
  { kind: "bilberry", sort: "harvest", label: { en: "bilberries", fi: "mustikat", sv: "blåbär" }, months: [7, 8, 9], peak: [8], why: "Wild bilberries ripen in the forests from July to September.", match: { words: ["bilberr", "blueberr", "mustik", "blåbär"] }, source: SATOKAUSI },
  { kind: "cloudberry", sort: "harvest", label: { en: "cloudberries", fi: "lakat", sv: "hjortron" }, months: [7, 8], why: "Cloudberries ripen on the bogs in July and August.", match: { words: ["cloudberr", "hilla", "lakka", "hjortron"], not: ["lakkapuhd", "kynsilakka"] }, source: SATOKAUSI },
  { kind: "chanterelle", sort: "harvest", label: { en: "chanterelles", fi: "kantarellit", sv: "kantareller" }, months: [7, 8, 9], peak: [8], why: "Chanterelles are picked from July to September.", match: { words: ["chanterell", "kantarell"] }, source: SATOKAUSI },
  { kind: "crayfish", sort: "harvest", label: { en: "crayfish", fi: "ravut", sv: "kräftor" }, months: [7, 8, 9, 10], peak: [8], why: "The crayfish season opens on 21 July at noon and runs to the end of October.", match: { words: ["crayfish", "rapu", "ravu", "kräft"], not: ["katkarap", "shrimp", "prawn", "räk", "rapea", "rapeat"] }, source: RAPU },
  { kind: "lingonberry", sort: "harvest", label: { en: "lingonberries", fi: "puolukat", sv: "lingon" }, months: [8, 9, 10], peak: [9], why: "Lingonberries ripen from late August to October.", match: { words: ["lingonberr", "puoluk", "lingon"] }, source: SATOKAUSI },
  { kind: "apple", sort: "harvest", label: { en: "Finnish apples", fi: "kotimaiset omenat", sv: "inhemska äpplen" }, months: [8, 9, 10], peak: [9], why: "Finnish apples are picked from August to October.", match: { words: ["apple", "omena", "äpple"], not: ["omenapuu", "pineapple", "ananas"] }, source: SATOKAUSI },
  { kind: "pumpkin", sort: "harvest", label: { en: "pumpkin", fi: "kurpitsa", sv: "pumpa" }, months: [9, 10], why: "Pumpkins are harvested in September and October.", match: { words: ["pumpkin", "kurpits", "pumpa"] }, source: SATOKAUSI },
  { kind: "cabbage", sort: "harvest", label: { en: "cabbage", fi: "kaali", sv: "kål" }, months: [8, 9, 10, 11], why: "Field cabbage is harvested from August to November.", match: { words: ["cabbage", "valkokaal", "keräkaal", "vitkål"] }, source: SATOKAUSI },
  { kind: "root_vegetables", sort: "harvest", label: { en: "root vegetables", fi: "juurekset", sv: "rotfrukter" }, months: [9, 10, 11, 12, 1, 2, 3], peak: [10, 11], why: "Beetroot, carrot, swede and parsnip are lifted in autumn and kept from store through the winter.", match: { words: ["beetroot", "punajuur", "rödbet", "carrot", "porkkan", "morot", "swede", "rutabaga", "lanttu", "kålrot", "parsnip", "palsternak", "celeriac", "juuriselle", "rotselleri"] }, source: SATOKAUSI },
  { kind: "moose", sort: "harvest", label: { en: "moose", fi: "hirvi", sv: "älg" }, months: [9, 10, 11, 12, 1], peak: [10, 11], why: "Moose is hunted from September in Lapland and from October elsewhere, to mid-January.", match: { words: ["moose", "hirvi", "hirven", "älg"] }, source: RIISTA },

  // ---------- festive ----------
  { kind: "runeberg_torte", sort: "festive", label: { en: "Runeberg tortes", fi: "runebergintortut", sv: "runebergstårtor" }, months: [1, 2], why: "Runeberg tortes are eaten around Runeberg's Day, 5 February.", match: { words: ["runeberg"] }, source: RUNEBERG },
  { kind: "shrove_buns", sort: "festive", label: { en: "Shrove buns", fi: "laskiaispullat", sv: "fastlagsbullar" }, months: [1, 2, 3], peak: [2], why: "Laskiainen, Shrove Tuesday, is the season for buns with whipped cream.", match: { words: ["laskiai", "fastlag", "semla", "shrove"] }, source: LASKIAINEN },
  { kind: "shrove_cream", sort: "festive", label: { en: "whipping cream for Shrove buns", fi: "vispikerma laskiaispulliin", sv: "vispgrädde till fastlagsbullar" }, months: [2], why: "Laskiainen, Shrove Tuesday, is when kitchens whip cream for the buns.", match: { words: ["whipping", "vispi", "kuohu", "visp", "whip"], within: ["cream", "plant_cream"] }, source: LASKIAINEN },
  { kind: "mammi", sort: "festive", label: { en: "mämmi", fi: "mämmi", sv: "memma" }, months: [2, 3, 4], peak: [3, 4], why: "Mämmi is the Finnish Easter pudding, sold from Shrovetide to Easter.", match: { words: ["mämmi", "memma"] }, source: MAMMI },
  { kind: "easter_quark", sort: "festive", label: { en: "quark for Easter pasha", fi: "rahka pashaan", sv: "kvarg till påskpascha" }, months: [3, 4], why: "Pasha, the Easter dessert, is made from quark.", match: { categories: ["quark"], words: ["pasha", "paskha"] }, source: PASHA },
  { kind: "may_day", sort: "festive", label: { en: "May Day sima and doughnuts", fi: "vapun sima ja munkit", sv: "första maj: mjöd och munkar" }, months: [4, 5], why: "Vappu, 1 May, is the season for sima, doughnuts and tippaleipä.", match: { words: ["sima", "tippaleip", "struva", "mjöd"], not: ["simpuk", "simapark"] }, source: VAPPU },
  { kind: "christmas_party", sort: "festive", label: { en: "little Christmas parties", fi: "pikkujoulut", sv: "lillajul" }, months: [11, 12], peak: [12], why: "Pikkujoulu, the little Christmas party season, runs from mid-November to Christmas.", match: { words: ["glögi", "glögg", "mulled", "piparkak", "pepparkak", "gingerbread", "joulutort", "jultårt"] }, source: PIKKUJOULU },
  { kind: "christmas_table", sort: "festive", label: { en: "the Christmas table", fi: "joulupöytä", sv: "julbordet" }, months: [11, 12], peak: [12], why: "The Christmas table: ham, casseroles, rice porridge and herring, cooked through December.", match: { words: ["joulu", "christmas", " jul ", " jul-", "julskin", "riisipuuro", "risgrynsgröt", "rice porridge", "joulukinkk", "lanttulaatik", "porkkanalaatik", "perunalaatik", "kålrotslåd", "morotslåd"], not: ["heinäkuu", "julienne", "juli "] }, source: CHRISTMAS },
  { kind: "christmas_cream", sort: "festive", label: { en: "cream for Christmas cooking", fi: "kerma jouluruokiin", sv: "grädde till julmaten" }, months: [11, 12], peak: [12], why: "Cream goes into the Christmas casseroles, sauces and desserts: kitchens cook with more of it from late November.", match: { categories: ["cream"] }, source: CHRISTMAS },
];

const lower = (s: string) => s.toLowerCase();

export type SeasonProduct = { name: string; names?: { en?: string; fi?: string; sv?: string }; category: string };

/** Does this entry describe this product? By category, or by a word in any of its names (and no `not` word). */
export function seasonMatches(e: SeasonEntry, p: SeasonProduct): boolean {
  const text = ` ${lower([p.name, p.names?.en, p.names?.fi, p.names?.sv].filter(Boolean).join(" | "))} `;
  if (e.match.not?.some((w) => text.includes(w))) return false;
  if (e.match.categories?.includes(p.category)) return true;
  if (!e.match.words?.length) return false;
  if (e.match.within && !e.match.within.includes(p.category)) return false;
  return e.match.words.some((w) => text.includes(w));
}

/** Entries in season in this month (1 to 12). */
export function inSeason(month: number, calendar: SeasonEntry[] = SEASON): SeasonEntry[] {
  return calendar.filter((e) => e.months.includes(month));
}

/** The entries that make this product in season in this month, most specific first (a word match before a whole category). */
export function seasonFor(p: SeasonProduct, month: number, calendar: SeasonEntry[] = SEASON): SeasonEntry[] {
  return inSeason(month, calendar)
    .filter((e) => seasonMatches(e, p))
    .sort((a, b) => Number(!!a.match.categories?.includes(p.category) && !a.match.words) - Number(!!b.match.categories?.includes(p.category) && !b.match.words));
}

/** The month (1 to 12) of a date in Helsinki. */
export function helsinkiMonth(at: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", month: "numeric" }).format(at));
}
