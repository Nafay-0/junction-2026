import { defineText } from "../../../_i18n/lang";

/** The operations portal's Customers page. The portal renders English; Finnish and Swedish are kept ready. */
export const CUSTOMERS_TEXT = defineText({
  en: {
    title: "Customers",
    purpose: "What each kitchen shares with us, and where we learned it.",
    emptyTitle: "No kitchen has come to the gate yet",
    empty: "A kitchen appears here once its agent presents a signed mandate. Sign in as a test kitchen on /k and ask its agent for an order.",
  },
  fi: {
    title: "Asiakkaat",
    purpose: "Mitä kukin keittiö jakaa kanssamme ja mistä saimme sen tietää.",
    emptyTitle: "Yksikään keittiö ei ole vielä tullut portille",
    empty: "Keittiö näkyy tässä, kun sen agentti esittää allekirjoitetun valtakirjan. Kirjaudu testikeittiöön osoitteessa /k ja pyydä sen agentilta tilaus.",
  },
  sv: {
    title: "Kunder",
    purpose: "Vad varje kök delar med oss, och var vi fick veta det.",
    emptyTitle: "Inget kök har kommit till grinden än",
    empty: "Ett kök syns här när dess agent visar upp en signerad fullmakt. Logga in som ett testkök på /k och be dess agent om en beställning.",
  },
});
