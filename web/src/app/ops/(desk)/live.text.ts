import { defineText } from "../../_i18n/lang";

/** The operations portal's first page, Live at the gate. The portal renders English; Finnish and Swedish are kept ready. */
export const LIVE_TEXT = defineText({
  en: {
    title: "Live at the gate",
    purpose: "Who is at the door right now, and what happened to what they asked for.",
    emptyTitle: "No agent at the door",
    empty: "Nothing has called in the last 30 minutes. Sign in as a test kitchen (hotel-lumo on /k) and ask its agent for something, or send in an outside agent over MCP: it appears here the moment it connects.",
    requestsEmptyTitle: "No request yet",
    requestsEmpty: "When an agent asks for something, it appears here with where it is and how it ended. Ask a test kitchen's agent for an order and it shows up here.",
  },
  fi: {
    title: "Portilla nyt",
    purpose: "Kuka on ovella juuri nyt ja mitä heidän pyynnöilleen tapahtui.",
    emptyTitle: "Ovella ei ole agenttia",
    empty: "Kukaan ei ole ottanut yhteyttä 30 minuuttiin. Kirjaudu testikeittiöön (hotel-lumo osoitteessa /k) ja pyydä sen agentilta jotakin, tai lähetä ulkopuolinen agentti MCP:n kautta: se näkyy tässä heti, kun se ottaa yhteyden.",
    requestsEmptyTitle: "Ei vielä pyyntöjä",
    requestsEmpty: "Kun agentti pyytää jotakin, pyyntö näkyy tässä: missä se on ja miten se päättyi. Pyydä testikeittiön agentilta tilaus, niin se näkyy tässä.",
  },
  sv: {
    title: "Vid grinden nu",
    purpose: "Vem som står vid dörren just nu, och vad som hände med det de bad om.",
    emptyTitle: "Ingen agent vid dörren",
    empty: "Ingen har hört av sig på 30 minuter. Logga in som ett testkök (hotel-lumo på /k) och be dess agent om något, eller skicka in en utomstående agent via MCP: den syns här så fort den ansluter.",
    requestsEmptyTitle: "Inga förfrågningar än",
    requestsEmpty: "När en agent ber om något syns det här, med var det står och hur det slutade. Be ett testköks agent om en beställning så syns den här.",
  },
});
