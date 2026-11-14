import { defineText } from "../../../_i18n/lang";

/** The operations portal's Recall radar page. The portal renders English; Finnish and Swedish are kept ready. */
export const RADAR_TEXT = defineText({
  en: {
    title: "Recall radar",
    purpose: "Is anything we sell being recalled?",
    emptyTitle: "No notices yet",
    empty: "The radar has not read this source yet. Notices appear here after its next scheduled read; one that names a product we sell puts that product on hold.",
  },
  fi: {
    title: "Takaisinvetotutka",
    purpose: "Onko jotakin myymäämme tuotetta vedetty takaisin?",
    emptyTitle: "Ei vielä ilmoituksia",
    empty: "Tutka ei ole vielä lukenut tätä lähdettä. Ilmoitukset näkyvät tässä sen seuraavan ajastetun lukukerran jälkeen; jos ilmoitus nimeää myymämme tuotteen, tuote pysäytetään.",
  },
  sv: {
    title: "Återkallelseradarn",
    purpose: "Återkallas något som vi säljer?",
    emptyTitle: "Inga meddelanden än",
    empty: "Radarn har inte läst den här källan än. Meddelanden syns här efter nästa schemalagda läsning; ett som nämner en produkt vi säljer spärrar den produkten.",
  },
});
