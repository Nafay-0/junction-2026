import { defineText } from "../../../_i18n/lang";

/** The operations portal's Selling agent page. The portal renders English; Finnish and Swedish are kept ready. */
export const OFFERS_TEXT = defineText({
  en: {
    title: "Selling agent",
    purpose: "Our own agent's offers to the buyers' agents: what, to whom, why, and what happened.",
    emptyTitle: "No offers yet",
    empty: "Run the selling agent or start a campaign for a product below: the offers it made to kitchens, and the ones a guardrail held back, appear here.",
  },
  fi: {
    title: "Myyntiagentti",
    purpose: "Oman agenttimme tarjoukset ostajien agenteille: mitä, kenelle, miksi ja mitä tapahtui.",
    emptyTitle: "Ei vielä tarjouksia",
    empty: "Aja myyntiagentti tai aloita kampanja tuotteelle alla: keittiöille tehdyt tarjoukset ja ne, jotka suojaraja pysäytti, näkyvät tässä.",
  },
  sv: {
    title: "Säljagenten",
    purpose: "Vår egen agents erbjudanden till köparnas agenter: vad, till vem, varför och vad som hände.",
    emptyTitle: "Inga erbjudanden än",
    empty: "Kör säljagenten eller starta en kampanj för en produkt nedan: erbjudandena till köken, och de som en skyddsregel höll tillbaka, syns här.",
  },
});
