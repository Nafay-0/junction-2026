import { defineText } from "../../../_i18n/lang";

/** The operations portal's Agents page. The portal renders English; Finnish and Swedish are kept ready. */
export const AGENTS_TEXT = defineText({
  en: {
    title: "Agents and licences",
    purpose: "Every agent at this gate: its licence, its record, and what it may do alone now.",
    emptyTitle: "No agent has come to the gate yet",
    empty: "An agent appears here once it presents a signed mandate at any door. Sign in as a test kitchen on /k and ask its agent for an order, or connect an outside agent to /api/mcp.",
  },
  fi: {
    title: "Agentit ja lisenssit",
    purpose: "Jokainen agentti tällä portilla: sen lisenssi, sen historia ja mitä se saa nyt tehdä yksin.",
    emptyTitle: "Yksikään agentti ei ole vielä tullut portille",
    empty: "Agentti näkyy tässä, kun se esittää allekirjoitetun valtakirjan millä tahansa ovella. Kirjaudu testikeittiöön osoitteessa /k ja pyydä sen agentilta tilaus, tai yhdistä ulkopuolinen agentti osoitteeseen /api/mcp.",
  },
  sv: {
    title: "Agenter och licenser",
    purpose: "Varje agent vid den här grinden: dess licens, dess historik och vad den får göra ensam nu.",
    emptyTitle: "Ingen agent har kommit till grinden än",
    empty: "En agent syns här när den visar upp en signerad fullmakt vid någon dörr. Logga in som ett testkök på /k och be dess agent om en beställning, eller anslut en utomstående agent till /api/mcp.",
  },
});
