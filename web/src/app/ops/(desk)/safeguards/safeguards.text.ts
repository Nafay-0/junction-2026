import { defineText } from "../../../_i18n/lang";

/** The operations portal's Safeguards page. The portal renders English; Finnish and Swedish are kept ready. */
export const SAFEGUARDS_TEXT = defineText({
  en: {
    title: "Safeguards",
    purpose: "What an agent may do alone, what needs a person, and what is refused, as the code runs it.",
    emptyTitle: "Nothing refused yet",
    empty: "Ask a test kitchen's agent for more than its weekly budget, or call the API with a changed mandate: the refusal appears here with its rule.",
  },
  fi: {
    title: "Suojaukset",
    purpose: "Mitä agentti saa tehdä yksin, mikä tarvitsee ihmisen ja mikä hylätään, niin kuin koodi sen ajaa.",
    emptyTitle: "Mitään ei ole vielä torjuttu",
    empty: "Pyydä testikeittiön agentilta enemmän kuin sen viikkobudjetti sallii, tai kutsu rajapintaa muutetulla valtakirjalla: torjunta näkyy tässä sääntöineen.",
  },
  sv: {
    title: "Skyddsregler",
    purpose: "Vad en agent får göra ensam, vad som behöver en person och vad som avslås, så som koden kör det.",
    emptyTitle: "Inget avvisat än",
    empty: "Be ett testköks agent om mer än veckobudgeten tillåter, eller anropa gränssnittet med en ändrad fullmakt: avvisningen syns här med sin regel.",
  },
});
