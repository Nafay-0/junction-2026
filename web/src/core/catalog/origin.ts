/**
 * Country codes as the partner's GS1 data states them (numeric ISO 3166-1, "246" for Finland) turned into the
 * lower-case alpha-2 codes the rest of Dock uses ("fi"). Only the codes the product file uses are listed; any other
 * code is kept as `iso:<code>` so it is never silently dropped. "097" is the GS1 code for the European Union and
 * "NON_EU" the data's own "outside the EU".
 */
const ISO_NUMERIC: Record<string, string> = {
  "008": "al", "012": "dz", "031": "az", "032": "ar", "036": "au", "040": "at", "050": "bd", "056": "be", "068": "bo", "076": "br",
  "097": "eu", "100": "bg", "112": "by", "120": "cm", "124": "ca", "144": "lk", "152": "cl", "156": "cn", "158": "tw", "170": "co",
  "174": "km", "188": "cr", "191": "hr", "192": "cu", "196": "cy", "203": "cz", "208": "dk", "214": "do", "218": "ec", "222": "sv",
  "231": "et", "233": "ee", "234": "fo", "246": "fi", "248": "ax", "250": "fr", "270": "gm", "276": "de", "288": "gh", "300": "gr",
  "304": "gl", "320": "gt", "332": "ht", "340": "hn", "348": "hu", "352": "is", "356": "in", "360": "id", "364": "ir", "372": "ie",
  "376": "il", "380": "it", "384": "ci", "388": "jm", "392": "jp", "398": "kz", "404": "ke", "410": "kr", "422": "lb", "428": "lv",
  "440": "lt", "442": "lu", "450": "mg", "454": "mw", "458": "my", "480": "mu", "484": "mx", "504": "ma", "528": "nl", "554": "nz",
  "562": "ne", "566": "ng", "578": "no", "586": "pk", "598": "pg", "600": "py", "604": "pe", "608": "ph", "616": "pl", "620": "pt",
  "624": "gw", "642": "ro", "643": "ru", "646": "rw", "688": "rs", "690": "sc", "702": "sg", "703": "sk", "704": "vn", "705": "si",
  "710": "za", "716": "zw", "724": "es", "752": "se", "756": "ch", "760": "sy", "764": "th", "768": "tg", "784": "ae", "788": "tn",
  "792": "tr", "800": "ug", "804": "ua", "807": "mk", "818": "eg", "826": "gb", "834": "tz", "840": "us", "854": "bf",
};

export function countryOfNumeric(code: string): string | undefined {
  const c = code.trim();
  if (!c) return undefined;
  if (c.toUpperCase() === "NON_EU") return "non_eu";
  if (/^\d{1,3}$/.test(c)) return ISO_NUMERIC[c.padStart(3, "0")] ?? `iso:${c.padStart(3, "0")}`;
  return /^[a-z]{2}$/i.test(c) ? c.toLowerCase() : undefined;
}

/** The stages an ingredient's origin is stated for (GS1 "origin type"), in the order a buyer reads them. */
export const ORIGIN_STAGES = ["BIRTH", "REARING", "SLAUGHTER", "MILKING", "FARMING", "CATCH_ZONE", "HUNTED_GATHERED", "LAST_PROCESSING", "CUTTER", "IMPORTATION"] as const;
