import { defineText } from "../../../_i18n/lang";

/** The operations portal's Customers page. The portal renders English; Finnish and Swedish are kept ready. */
export const CUSTOMERS_TEXT = defineText({
  en: {
    title: "Customers",
    purpose: "What we know about each kitchen and where we learned it: only what the kitchen shares, each item with who stated it or which orders taught it. Corrections go to the kitchen to confirm.",
    emptyTitle: "No kitchen has come to the gate yet",
    empty: "A kitchen appears here once its agent presents a signed mandate. Sign in as a test kitchen on /k and ask its agent for an order.",
  },
  fi: {
    title: "Asiakkaat",
    purpose: "Mitä tiedämme kustakin keittiöstä ja mistä sen opimme: vain se, minkä keittiö jakaa, ja jokaisesta tiedosta kuka sen kertoi tai mistä tilauksista se opittiin. Korjaukset menevät keittiölle vahvistettaviksi.",
    emptyTitle: "Yksikään keittiö ei ole vielä tullut portille",
    empty: "Keittiö näkyy tässä, kun sen agentti esittää allekirjoitetun valtakirjan. Kirjaudu testikeittiöön osoitteessa /k ja pyydä sen agentilta tilaus.",
  },
  sv: {
    title: "Kunder",
    purpose: "Vad vi vet om varje kök och var vi lärde oss det: bara det köket delar, varje uppgift med vem som sade den eller vilka beställningar den kom från. Rättelser går till köket för bekräftelse.",
    emptyTitle: "Inget kök har kommit till grinden än",
    empty: "Ett kök syns här när dess agent visar upp en signerad fullmakt. Logga in som ett testkök på /k och be dess agent om en beställning.",
  },
});
