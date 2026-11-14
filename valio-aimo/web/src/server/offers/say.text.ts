import { defineText } from "@/app/_i18n/lang";

/**
 * What the kitchen's own agent says about the wholesaler's offer, in the conversation: one or two plain sentences
 * with the reason and its figures, then a question answered in words. The figures come from the signed offer (plain
 * code); these are the words around them. The kitchen's words, never "campaign", "claim", "mandate" or "credential".
 */
export const OFFER_SAY_TEXT = defineText({
  en: {
    who: "Your wholesaler's agent",
    cheaper: (who: string, name: string, less: string, unit: string, sameMaker: boolean, pack: string) => `${who} suggests ${name} instead of what you buy every week: ${less} less per ${unit}${sameMaker ? ", same maker" : ""}, ${pack} a pack.`,
    newIn: (who: string, name: string, day: string, pack: string) => `${who} suggests ${name}, new in the range since ${day}: ${pack} a pack.`,
    inSeason: (who: string, name: string, season: string, pack: string) => `${who} suggests ${name}: ${season} is in season now. ${pack} a pack.`,
    reliable: (who: string, name: string, a: string, b: string, pack: string) => `${who} suggests ${name}: it arrives on time ${a} of the time, against ${b} for what you buy now. ${pack} a pack.`,
    carbon: (who: string, name: string, pct: string, pack: string) => `${who} suggests ${name}: ${pct} less CO2 than what you buy now. ${pack} a pack.`,
    other: (who: string, name: string, pack: string) => `${who} suggests ${name}, ${pack} a pack.`,
    newToYou: "You have not had it before.",
    askDay: (packs: string, day: string) => `Want ${packs} on ${day}'s order?`,
    ask: (packs: string) => `Want ${packs} on the order sheet?`,
    holds: (until: string) => `The price holds until ${until}.`,
    perL: "litre",
    perKg: "kilo",
    // replies after an answer in words
    onSheet: "It is on the order sheet: nothing is ordered until you confirm it.",
    declined: "Fine, I will not bring it up again.",
    muted: (what: string) => `Understood: no more suggestions for ${what}.`,
    off: "Understood: no more suggestions from the wholesaler until you ask for them again.",
  },
  fi: {
    who: "Tukkurinne agentti",
    cheaper: (who: string, name: string, less: string, unit: string, sameMaker: boolean, pack: string) => `${who} ehdottaa tuotetta ${name} viikoittain ostamanne tilalle: ${less} vähemmän ${unit === "litre" ? "litralta" : "kilolta"}${sameMaker ? ", sama valmistaja" : ""}, ${pack} / pakkaus.`,
    newIn: (who: string, name: string, day: string, pack: string) => `${who} ehdottaa tuotetta ${name}, valikoiman uutuus ${day} alkaen: ${pack} / pakkaus.`,
    inSeason: (who: string, name: string, season: string, pack: string) => `${who} ehdottaa tuotetta ${name}: nyt on sesonki (${season}). ${pack} / pakkaus.`,
    reliable: (who: string, name: string, a: string, b: string, pack: string) => `${who} ehdottaa tuotetta ${name}: se toimitetaan ajallaan ${a} kerroista, nykyinen ${b}. ${pack} / pakkaus.`,
    carbon: (who: string, name: string, pct: string, pack: string) => `${who} ehdottaa tuotetta ${name}: ${pct} vähemmän hiilidioksidia kuin nykyinen. ${pack} / pakkaus.`,
    other: (who: string, name: string, pack: string) => `${who} ehdottaa tuotetta ${name}, ${pack} / pakkaus.`,
    newToYou: "Ette ole tilanneet sitä aiemmin.",
    askDay: (packs: string, day: string) => `Lisätäänkö ${packs} ${day}n tilaukseen?`,
    ask: (packs: string) => `Lisätäänkö ${packs} tilauslistalle?`,
    holds: (until: string) => `Hinta on voimassa ${until} asti.`,
    perL: "litre",
    perKg: "kilo",
    onSheet: "Se on tilauslistalla: mitään ei tilata ennen kuin vahvistatte sen.",
    declined: "Selvä, en ota sitä enää puheeksi.",
    muted: (what: string) => `Selvä: ei enää ehdotuksia (${what}).`,
    off: "Selvä: ei enää tukkurin ehdotuksia ennen kuin pyydätte niitä.",
  },
  sv: {
    who: "Er grossists agent",
    cheaper: (who: string, name: string, less: string, unit: string, sameMaker: boolean, pack: string) => `${who} föreslår ${name} i stället för det ni köper varje vecka: ${less} mindre per ${unit === "litre" ? "liter" : "kilo"}${sameMaker ? ", samma tillverkare" : ""}, ${pack} per förpackning.`,
    newIn: (who: string, name: string, day: string, pack: string) => `${who} föreslår ${name}, nytt i sortimentet sedan ${day}: ${pack} per förpackning.`,
    inSeason: (who: string, name: string, season: string, pack: string) => `${who} föreslår ${name}: det är säsong nu (${season}). ${pack} per förpackning.`,
    reliable: (who: string, name: string, a: string, b: string, pack: string) => `${who} föreslår ${name}: den levereras i tid ${a} av gångerna, det ni köper nu ${b}. ${pack} per förpackning.`,
    carbon: (who: string, name: string, pct: string, pack: string) => `${who} föreslår ${name}: ${pct} mindre koldioxid än det ni köper nu. ${pack} per förpackning.`,
    other: (who: string, name: string, pack: string) => `${who} föreslår ${name}, ${pack} per förpackning.`,
    newToYou: "Ni har inte beställt den förut.",
    askDay: (packs: string, day: string) => `Ska jag lägga ${packs} på beställningen för ${day}?`,
    ask: (packs: string) => `Ska jag lägga ${packs} på beställningslistan?`,
    holds: (until: string) => `Priset gäller till ${until}.`,
    perL: "litre",
    perKg: "kilo",
    onSheet: "Den ligger på beställningslistan: inget beställs förrän ni bekräftar den.",
    declined: "Okej, jag tar inte upp den igen.",
    muted: (what: string) => `Uppfattat: inga fler förslag (${what}).`,
    off: "Uppfattat: inga fler förslag från grossisten förrän ni ber om dem.",
  },
});
