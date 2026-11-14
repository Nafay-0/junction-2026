import { defineText } from "../../../_i18n/lang";

/** The operations portal's Recall radar page. The portal renders English; Finnish and Swedish are kept ready. */
export const RADAR_TEXT = defineText({
  en: {
    title: "Recall radar",
    purpose: "Food authorities' recall notices, matched against the assortment in code: a product an authority names is held before any agent can order it, and doubtful matches wait for a person.",
    emptyTitle: "No notices yet",
    empty: "The radar has not read this source yet. Notices appear here after its next scheduled read; one that names a product we sell puts that product on hold.",
  },
  fi: {
    title: "Takaisinvetotutka",
    purpose: "Elintarvikeviranomaisten takaisinvetoilmoitukset verrattuna valikoimaan koodilla: viranomaisen nimeämä tuote pysäytetään ennen kuin yksikään agentti voi tilata sitä, ja epävarmat osumat odottavat ihmistä.",
    emptyTitle: "Ei vielä ilmoituksia",
    empty: "Tutka ei ole vielä lukenut tätä lähdettä. Ilmoitukset näkyvät tässä sen seuraavan ajastetun lukukerran jälkeen; jos ilmoitus nimeää myymämme tuotteen, tuote pysäytetään.",
  },
  sv: {
    title: "Återkallelseradarn",
    purpose: "Livsmedelsmyndigheters återkallelser, matchade mot sortimentet med kod: en produkt som en myndighet nämner spärras innan någon agent kan beställa den, och osäkra träffar väntar på en person.",
    emptyTitle: "Inga meddelanden än",
    empty: "Radarn har inte läst den här källan än. Meddelanden syns här efter nästa schemalagda läsning; ett som nämner en produkt vi säljer spärrar den produkten.",
  },
});
