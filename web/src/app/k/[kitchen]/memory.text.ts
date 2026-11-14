import { defineText } from "../../_i18n/lang";

/** How the shop words what it remembered from an earlier request (`memory.ts`). */
export const MEMORY_TEXT = defineText({
  en: {
    requestOf: (day: string, text: string) => `your request of ${day} (“${text}”)`,
    orderOf: (day: string) => `your order of ${day}`,
    field: { item: "the product", quantity: "the amount", attributes: "the requirements", optimise: "what matters most", allergens: "the allergens", deliverBy: "the day" } as Record<string, string>,
    and: " and ",
    readAgainst: (earlier: string) => `Read against ${earlier}.`,
    from: (earlier: string, list: string) => `From ${earlier}: ${list}, so not asked again.`,
    sameAmount: "the same amount",
    repeatText: (text: string) => `Repeat: ${text}`,
    repeatOrder: (day: string, what: string) => `Repeat of the order of ${day}: ${what}`,
    nowFor: (day: string, short: string) => `, now for ${day}, the next ${short}`,
    repeats: (earlier: string, qty: string, when: string) => `Repeats ${earlier}: ${qty}${when}. Nothing asked that it already answered.`,
  },
  fi: {
    requestOf: (day: string, text: string) => `pyyntösi ${day} (”${text}”)`,
    orderOf: (day: string) => `tilauksesi ${day}`,
    field: { item: "tuote", quantity: "määrä", attributes: "vaatimukset", optimise: "mikä on tärkeintä", allergens: "allergeenit", deliverBy: "päivä" } as Record<string, string>,
    and: " ja ",
    readAgainst: (earlier: string) => `Tulkittu aiemman perusteella: ${earlier}.`,
    from: (earlier: string, list: string) => `Lähde: ${earlier}. Siitä otettiin ${list}, joten niitä ei kysytty uudelleen.`,
    sameAmount: "sama määrä",
    repeatText: (text: string) => `Toisto: ${text}`,
    repeatOrder: (day: string, what: string) => `Tilauksen ${day} toisto: ${what}`,
    nowFor: (day: string) => `, nyt toimitukseen ${day}, seuraavana samana viikonpäivänä`,
    repeats: (earlier: string, qty: string, when: string) => `Toistaa: ${earlier}. ${qty}${when}. Mitään jo vastattua ei kysytty uudelleen.`,
  },
  sv: {
    requestOf: (day: string, text: string) => `din förfrågan ${day} (”${text}”)`,
    orderOf: (day: string) => `din beställning ${day}`,
    field: { item: "produkten", quantity: "mängden", attributes: "kraven", optimise: "vad som är viktigast", allergens: "allergenerna", deliverBy: "dagen" } as Record<string, string>,
    and: " och ",
    readAgainst: (earlier: string) => `Läst mot ${earlier}.`,
    from: (earlier: string, list: string) => `Från ${earlier}: ${list}, så det frågades inte igen.`,
    sameAmount: "samma mängd",
    repeatText: (text: string) => `Upprepning: ${text}`,
    repeatOrder: (day: string, what: string) => `Upprepning av beställningen ${day}: ${what}`,
    nowFor: (day: string, short: string) => `, nu för ${day}, nästa ${short}`,
    repeats: (earlier: string, qty: string, when: string) => `Upprepar ${earlier}: ${qty}${when}. Inget frågades som redan var besvarat.`,
  },
});
