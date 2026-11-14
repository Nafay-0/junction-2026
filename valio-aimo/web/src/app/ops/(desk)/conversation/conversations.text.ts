import { defineText } from "../../../_i18n/lang";

/** The operations portal's Conversations page. The portal renders English; Finnish and Swedish are kept ready. */
export const CONVERSATIONS_TEXT = defineText({
  en: {
    title: "Conversations",
    purpose: "Each kitchen's conversation with its own agent, as one record.",
    emptyTitle: "No conversation yet",
    empty: "Sign in as a test kitchen on /k and ask its agent for something; the conversation appears here.",
  },
  fi: {
    title: "Keskustelut",
    purpose: "Jokaisen keittiön keskustelu oman agenttinsa kanssa, yhtenä tallenteena.",
    emptyTitle: "Ei vielä keskusteluja",
    empty: "Kirjaudu testikeittiöön osoitteessa /k ja pyydä sen agentilta jotakin; keskustelu näkyy tässä.",
  },
  sv: {
    title: "Samtal",
    purpose: "Varje köks samtal med sin egen agent, som en enda post.",
    emptyTitle: "Inga samtal än",
    empty: "Logga in som ett testkök på /k och be dess agent om något; samtalet syns här.",
  },
});
