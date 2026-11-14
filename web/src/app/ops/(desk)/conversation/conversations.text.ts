import { defineText } from "../../../_i18n/lang";

/** The operations portal's Conversations page. The portal renders English; Finnish and Swedish are kept ready. */
export const CONVERSATIONS_TEXT = defineText({
  en: {
    title: "Conversations",
    purpose: "Each kitchen's conversation with its own agent, typed or spoken, as one record: every turn, model call, tool call and gate decision. Open one to read it turn by turn.",
    emptyTitle: "No conversation yet",
    empty: "Sign in as a test kitchen on /k and ask its agent for something; the conversation appears here.",
  },
  fi: {
    title: "Keskustelut",
    purpose: "Jokaisen keittiön keskustelu oman agenttinsa kanssa, kirjoitettuna tai puhuttuna, yhtenä tallenteena: jokainen vuoro, mallikutsu, työkalukutsu ja portin päätös. Avaa keskustelu lukeaksesi sen vuoro vuorolta.",
    emptyTitle: "Ei vielä keskusteluja",
    empty: "Kirjaudu testikeittiöön osoitteessa /k ja pyydä sen agentilta jotakin; keskustelu näkyy tässä.",
  },
  sv: {
    title: "Samtal",
    purpose: "Varje köks samtal med sin egen agent, skrivet eller talat, som en post: varje tur, modellanrop, verktygsanrop och grindens beslut. Öppna ett för att läsa det tur för tur.",
    emptyTitle: "Inga samtal än",
    empty: "Logga in som ett testkök på /k och be dess agent om något; samtalet syns här.",
  },
});
