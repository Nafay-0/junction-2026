import { defineText } from "@/app/_i18n/lang";

/**
 * What the kitchen's agent says at order time about a product with a poor delivery record, and after the answer. The
 * record is history ("has arrived as ordered about 7 times in 10"), never a forecast. One sentence, for the worst
 * product only; the others are behind the list.
 */
export const BACKUP_SAY_TEXT = defineText({
  en: {
    record: (what: string, n: number, of: number) => `One thing: the ${what} has arrived as ordered about ${n} times in ${of}.`,
    want: "Want a backup lined up in case it doesn't come?",
    closest: (alt: string, diff: string) => `The ${alt} is the closest${diff ? `, ${diff}` : ""}.`,
    noneCloser: "Nothing with a better record can come that day, so there is no backup to line up.",
    more: (d: string, u: string) => `${d} more per ${u}`,
    less: (d: string, u: string) => `${d} less per ${u}`,
    same: (u: string) => `the same price per ${u}`,
    litre: "litre",
    kilo: "kilo",
    others: (n: number) => (n === 1 ? "One more product on this order has a weaker record: it's in the list." : `${n} more products on this order have a weaker record: they're in the list.`),
    set: (what: string, alt: string, alone: boolean, who: string) => `Done: if the ${what} doesn't come, I'll order the ${alt} instead${alone ? "" : `, and ${who} will be asked to OK it`}. Nothing extra is bought now.`,
    noneInside: (what: string) => `None of the alternatives for the ${what} is inside your rules, so I can't pick one for you. Tell me which one you want.`,
    declined: "Fine, no backup.",
  },
  fi: {
    record: (what: string, n: number, of: number) => `Yksi asia: ${what} on toimitettu tilatusti noin ${n} kertaa ${of}:stä.`,
    want: "Laitetaanko varalle vaihtoehto siltä varalta, ettei se tule?",
    closest: (alt: string, diff: string) => `Lähin on ${alt}${diff ? `, ${diff}` : ""}.`,
    noneCloser: "Mikään paremmin toimitettu ei ehdi sille päivälle, joten varavaihtoehtoa ei ole.",
    more: (d: string, u: string) => `${d} enemmän ${u}`,
    less: (d: string, u: string) => `${d} vähemmän ${u}`,
    same: (u: string) => `sama hinta ${u}`,
    litre: "litralta",
    kilo: "kilolta",
    others: (n: number) => (n === 1 ? "Yhden muun tuotteen toimitushistoria on heikompi: se on listalla." : `${n} muun tuotteen toimitushistoria on heikompi: ne ovat listalla.`),
    set: (what: string, alt: string, alone: boolean, who: string) => `Selvä: jos ${what} ei tule, tilaan tilalle tuotteen ${alt}${alone ? "" : ` ja pyydän sille hyväksynnän (${who})`}. Nyt ei osteta mitään ylimääräistä.`,
    noneInside: (what: string) => `Mikään vaihtoehto tuotteelle ${what} ei ole sääntöjenne mukainen, joten en voi valita puolestanne. Kerro, minkä haluat.`,
    declined: "Selvä, ei varavaihtoehtoa.",
  },
  sv: {
    record: (what: string, n: number, of: number) => `En sak: ${what} har levererats som beställt ungefär ${n} gånger av ${of}.`,
    want: "Ska jag ha en reserv redo ifall den inte kommer?",
    closest: (alt: string, diff: string) => `Närmast är ${alt}${diff ? `, ${diff}` : ""}.`,
    noneCloser: "Inget med bättre leveranshistorik hinner fram den dagen, så det finns ingen reserv att ha redo.",
    more: (d: string, u: string) => `${d} mer per ${u}`,
    less: (d: string, u: string) => `${d} mindre per ${u}`,
    same: (u: string) => `samma pris per ${u}`,
    litre: "liter",
    kilo: "kilo",
    others: (n: number) => (n === 1 ? "En produkt till på beställningen har sämre historik: den finns i listan." : `${n} produkter till på beställningen har sämre historik: de finns i listan.`),
    set: (what: string, alt: string, alone: boolean, who: string) => `Klart: om ${what} inte kommer beställer jag ${alt} i stället${alone ? "" : ` och ber ${who} godkänna det`}. Inget extra köps nu.`,
    noneInside: (what: string) => `Inget alternativ för ${what} ryms i dina regler, så jag kan inte välja åt dig. Säg vilket du vill ha.`,
    declined: "Okej, ingen reserv.",
  },
});
