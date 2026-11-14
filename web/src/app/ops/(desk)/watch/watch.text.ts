import { defineText } from "../../../_i18n/lang";

/** The operations portal's Kitchen watch page. The portal renders English; Finnish and Swedish are kept ready. */
export const WATCH_TEXT = defineText({
  en: {
    title: "Kitchen watch",
    purpose: "Each kitchen's own agent watching what it buys every week: a product that cannot come, with good, better, best substitutes, and recurring orders renewed or held when the amount or price drifted. Every order still goes through the gate.",
    emptyTitle: "Nothing found yet",
    empty: "When a product a kitchen buys every week cannot come for its day, it is listed here with the substitutes the agent proposed. Stage a stock-out for a test kitchen below and run the watch to see one.",
  },
  fi: {
    title: "Keittiön vahti",
    purpose: "Jokaisen keittiön oma agentti seuraa, mitä keittiö ostaa viikoittain: tuote, joka ei ehdi ajoissa, korvaavine tuotteineen (hyvä, parempi, paras), ja toistuvat tilaukset, jotka uusitaan tai pysäytetään, kun määrä tai hinta on muuttunut. Jokainen tilaus kulkee silti portin kautta.",
    emptyTitle: "Ei vielä havaintoja",
    empty: "Kun tuote, jota keittiö ostaa joka viikko, ei ehdi toimituspäiväksi, se näkyy tässä agentin ehdottamien korvaavien tuotteiden kanssa. Lavasta testikeittiölle loppuminen varastosta alla ja aja vahti, niin näet esimerkin.",
  },
  sv: {
    title: "Kökets bevakning",
    purpose: "Varje köks egen agent bevakar det köket köper varje vecka: en produkt som inte hinner fram, med ersättande produkter (bra, bättre, bäst), och återkommande beställningar som förnyas eller hålls kvar när mängden eller priset har ändrats. Varje beställning går ändå genom grinden.",
    emptyTitle: "Inga fynd än",
    empty: "När en produkt som köket köper varje vecka inte hinner fram till sin dag listas den här med de ersättande produkter agenten föreslog. Iscensätt slut i lager för ett testkök nedan och kör bevakningen för att se ett exempel.",
  },
});
