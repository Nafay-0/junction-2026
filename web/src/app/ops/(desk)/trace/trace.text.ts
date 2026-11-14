import { defineText } from "../../../_i18n/lang";

/** The operations portal's Trace page (the latest request, and one request's trace). The portal renders English; Finnish and Swedish are kept ready. */
export const TRACE_TEXT = defineText({
  en: {
    title: "Trace",
    purpose: "Any request as a path through the gate, station by station, replayable: press play, step, or click a station.",
    emptyTitle: "No request to trace yet",
    empty: "When an agent asks for something, its trace appears here station by station. Sign in as a test kitchen on /k and ask its agent for an order.",
  },
  fi: {
    title: "Jäljitys",
    purpose: "Mikä tahansa pyyntö polkuna portin läpi, asema asemalta, toistettavana: paina toista, etene askel kerrallaan tai napsauta asemaa.",
    emptyTitle: "Ei vielä jäljitettävää pyyntöä",
    empty: "Kun agentti pyytää jotakin, sen jälki näkyy tässä asema asemalta. Kirjaudu testikeittiöön osoitteessa /k ja pyydä sen agentilta tilaus.",
  },
  sv: {
    title: "Spårning",
    purpose: "Varje förfrågan som en väg genom grinden, station för station, uppspelningsbar: tryck på spela, stega eller klicka på en station.",
    emptyTitle: "Ingen förfrågan att spåra än",
    empty: "När en agent ber om något syns dess spår här station för station. Logga in som ett testkök på /k och be dess agent om en beställning.",
  },
});
