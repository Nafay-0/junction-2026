import type { Lang } from "./lang";

/**
 * The kitchen's own words that the server writes in English but the interface controls: the kitchen's display name
 * ("Hotel Saimaa kitchen, Espoo"), its agent's name ("Kaari's buyer agent") and the example requests offered as
 * buttons. Display only: what is sent to the server (the ledger author, a request's text for the offline reader)
 * stays as the server knows it.
 */

/** "Hotel Saimaa kitchen, Espoo" -> "Hotel Saimaa, Espoo" in Finnish and Swedish (a hotel's name stands alone). */
export function placeNameL(name: string, lang: Lang): string {
  if (lang === "en") return name;
  return name.replace(/ kitchen(?=,|$)/, "");
}

/** The agent's display name. In Finnish and Swedish it is the role, not an English possessive. */
export function agentNameL(agentName: string, lang: Lang): string {
  if (lang === "fi") return "Ostoagentti";
  if (lang === "sv") return "Inköpsagenten";
  return agentName;
}

/** The same in the middle of a sentence ("… ostoagentti ostaa …"). */
export function agentNounL(agentName: string, lang: Lang): string {
  if (lang === "fi") return "ostoagentti";
  if (lang === "sv") return "inköpsagenten";
  return agentName;
}

/** Example requests (store and menu planner), by their English text as the server sends them. */
const EXAMPLES: Record<string, { fi: string; sv: string }> = {
  "1,000 litres of lactose-free milk by Monday": { fi: "1 000 litraa laktoositonta maitoa maanantaiksi", sv: "1 000 liter laktosfri mjölk till måndag" },
  "100 litres of milk for Thursday": { fi: "100 litraa maitoa torstaiksi", sv: "100 liter mjölk till torsdag" },
  "Same as last time, for Friday": { fi: "Sama kuin viimeksi, perjantaiksi", sv: "Samma som förra gången, till fredag" },
  "100 L milk for Wednesday, lowest CO2": { fi: "100 l maitoa keskiviikoksi, pienin hiilijalanjälki", sv: "100 l mjölk till onsdag, lägsta klimatavtryck" },
  "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.": {
    fi: "Tarvitsen 1 000 litraa laktoositonta maitoa maanantaiksi. Etsi vaihtoehto, joka täyttää vaatimuksemme hinnan ja saatavuuden perusteella.",
    sv: "Jag behöver 1 000 liter laktosfri mjölk till måndag. Hitta ett alternativ som uppfyller våra krav utifrån pris och tillgänglighet.",
  },
  "200 litres of lactose-free milk for Wednesday, cheapest": { fi: "200 litraa laktoositonta maitoa keskiviikoksi, edullisin", sv: "200 liter laktosfri mjölk till onsdag, billigast" },
  "60 litres of oat drink for Tuesday": { fi: "60 litraa kaurajuomaa tiistaiksi", sv: "60 liter havredryck till tisdag" },
  // the menu planner's
  "Salmon soup for 300 on Friday": { fi: "Lohikeittoa 300 annosta perjantaiksi", sv: "Laxsoppa för 300 till fredag" },
  "Next week's lunch around chanterelles: two dishes, 250 covers a day, Wednesday and Thursday": {
    fi: "Ensi viikon lounas kanttarelleista: kaksi ruokaa, 250 annosta päivässä, keskiviikkona ja torstaina",
    sv: "Nästa veckas lunch kring kantareller: två rätter, 250 portioner om dagen, onsdag och torsdag",
  },
  "Lohikeitto 300 annosta perjantaiksi": { fi: "Lohikeitto 300 annosta perjantaiksi", sv: "Laxsoppa 300 portioner till fredag" },
  "Tomorrow: unexpected booking, 120 covers, three-course lunch, lactose-free and nut-free": {
    fi: "Huomenna yllättävä varaus: 120 annosta, kolmen ruokalajin lounas, laktoositon ja pähkinätön",
    sv: "I morgon en oväntad bokning: 120 portioner, lunch i tre rätter, laktosfri och nötfri",
  },
  "School lunch for 450 on Monday: salmon soup, rye bread, berry quark for dessert": {
    fi: "Koululounas 450:lle maanantaina: lohikeittoa, ruisleipää, jälkiruoaksi marjarahkaa",
    sv: "Skollunch för 450 på måndag: laxsoppa, rågbröd, bärkvarg till efterrätt",
  },
  "Koululounas 450 oppilaalle maanantaiksi: broileria ja riisiä": { fi: "Koululounas 450 oppilaalle maanantaiksi: broileria ja riisiä", sv: "Skollunch för 450 elever till måndag: kyckling och ris" },
  "Peanut satay chicken for 200 pupils on Tuesday": { fi: "Maapähkinä-satay-broileria 200 oppilaalle tiistaiksi", sv: "Kyckling satay med jordnötter för 200 elever på tisdag" },
};

export function exampleL(text: string, lang: Lang): string {
  return lang === "en" ? text : (EXAMPLES[text]?.[lang] ?? text);
}

/** A translated example back to the English the offline example reader understands; other text as it is. */
export function exampleToEnglish(text: string): string {
  const t = text.trim();
  for (const [en, l] of Object.entries(EXAMPLES)) if (l.fi === t || l.sv === t) return en;
  return text;
}
