import { defineText } from "../../../_i18n/lang";

/** The operations portal's Kitchen watch page. The portal renders English; Finnish and Swedish are kept ready. */
export const WATCH_TEXT = defineText({
  en: {
    title: "Kitchen watch",
    purpose: "Products a kitchen buys every week that cannot come, with good, better and best substitutes.",
    emptyTitle: "Nothing found yet",
    empty: "When a product a kitchen buys every week cannot come for its day, it is listed here with the substitutes the agent proposed. Stage a stock-out for a test kitchen below and run the watch to see one.",
  },
  fi: {
    title: "Keittiön vahti",
    purpose: "Tuotteet, joita keittiö ostaa joka viikko ja jotka eivät voi tulla, sekä hyvät, paremmat ja parhaat korvaajat.",
    emptyTitle: "Ei vielä havaintoja",
    empty: "Kun tuote, jota keittiö ostaa joka viikko, ei ehdi toimituspäiväksi, se näkyy tässä agentin ehdottamien korvaavien tuotteiden kanssa. Lavasta testikeittiölle loppuminen varastosta alla ja aja vahti, niin näet esimerkin.",
  },
  sv: {
    title: "Kökets bevakning",
    purpose: "Produkter som ett kök köper varje vecka och som inte kan komma, med bra, bättre och bästa ersättare.",
    emptyTitle: "Inga fynd än",
    empty: "När en produkt som köket köper varje vecka inte hinner fram till sin dag listas den här med de ersättande produkter agenten föreslog. Iscensätt slut i lager för ett testkök nedan och kör bevakningen för att se ett exempel.",
  },
});
