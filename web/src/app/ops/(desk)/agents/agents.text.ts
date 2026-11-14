import { defineText } from "../../../_i18n/lang";

/** The operations portal's Agents page. The portal renders English; Finnish and Swedish are kept ready. */
export const AGENTS_TEXT = defineText({
  en: {
    title: "Agents and licences",
    purpose: "Every agent that has come to this gate: its crash-test licence, its record here, and what it may do alone right now. Look for the one that escalates too often or keeps hitting a rule.",
    emptyTitle: "No agent has come to the gate yet",
    empty: "An agent appears here once it presents a signed mandate at any door. Sign in as a test kitchen on /k and ask its agent for an order, or connect an outside agent to /api/mcp.",
  },
  fi: {
    title: "Agentit ja lisenssit",
    purpose: "Jokainen tälle portille tullut agentti: sen törmäystestilisenssi, sen historia täällä ja mitä se saa juuri nyt päättää yksin. Etsi agentti, joka pyytää ihmistä liian usein tai osuu yhä samaan sääntöön.",
    emptyTitle: "Yksikään agentti ei ole vielä tullut portille",
    empty: "Agentti näkyy tässä, kun se esittää allekirjoitetun valtakirjan millä tahansa ovella. Kirjaudu testikeittiöön osoitteessa /k ja pyydä sen agentilta tilaus, tai yhdistä ulkopuolinen agentti osoitteeseen /api/mcp.",
  },
  sv: {
    title: "Agenter och licenser",
    purpose: "Varje agent som har kommit till grinden: dess krocktestlicens, dess historik här och vad den får avgöra ensam just nu. Leta efter den som ber om godkännande för ofta eller gång på gång stöter på samma regel.",
    emptyTitle: "Ingen agent har kommit till grinden än",
    empty: "En agent syns här när den visar upp en signerad fullmakt vid någon dörr. Logga in som ett testkök på /k och be dess agent om en beställning, eller anslut en utomstående agent till /api/mcp.",
  },
});
