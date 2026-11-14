import { defineText } from "../../../_i18n/lang";

/** The operations portal's Selling agent page. The portal renders English; Finnish and Swedish are kept ready. */
export const OFFERS_TEXT = defineText({
  en: {
    title: "Selling agent",
    purpose: "Our own agent offering the kitchens' agents what is genuinely worth it, picked by plain code from data and checked against every guardrail. Each offer is signed and never an order; kitchens can decline, mute or turn it off.",
    emptyTitle: "No offers yet",
    empty: "Run the selling agent or start a campaign for a product below: the offers it made to kitchens, and the ones a guardrail held back, appear here.",
  },
  fi: {
    title: "Myyntiagentti",
    purpose: "Oma agenttimme tarjoaa keittiöiden agenteille sitä, mikä todella kannattaa: tavallinen koodi valitsee datasta ja tarkistaa jokaisen suojarajan. Jokainen tarjous on allekirjoitettu eikä koskaan tilaus; keittiö voi hylätä sen, mykistää sen tai kytkeä sen pois.",
    emptyTitle: "Ei vielä tarjouksia",
    empty: "Aja myyntiagentti tai aloita kampanja tuotteelle alla: keittiöille tehdyt tarjoukset ja ne, jotka suojaraja pysäytti, näkyvät tässä.",
  },
  sv: {
    title: "Säljagenten",
    purpose: "Vår egen agent erbjuder kökens agenter det som verkligen lönar sig, valt av vanlig kod ur data och kontrollerat mot varje skyddsregel. Varje erbjudande är signerat och aldrig en beställning; köket kan tacka nej, tysta det eller stänga av det.",
    emptyTitle: "Inga erbjudanden än",
    empty: "Kör säljagenten eller starta en kampanj för en produkt nedan: erbjudandena till köken, och de som en skyddsregel höll tillbaka, syns här.",
  },
});
