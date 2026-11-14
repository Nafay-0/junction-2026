import { defineText } from "../../../_i18n/lang";

/** The operations portal's Safeguards page. The portal renders English; Finnish and Swedish are kept ready. */
export const SAFEGUARDS_TEXT = defineText({
  en: {
    title: "Safeguards",
    purpose: "What an agent may decide alone, what needs a person and what is refused outright: the rule book as the code runs it, with how often each rule fired and its latest cases.",
    emptyTitle: "Nothing refused yet",
    empty: "Ask a test kitchen's agent for more than its weekly budget, or call the API with a changed mandate: the refusal appears here with its rule.",
  },
  fi: {
    title: "Suojaukset",
    purpose: "Mitä agentti saa päättää yksin, mikä vaatii ihmisen ja mikä torjutaan suoraan: sääntökirja sellaisena kuin koodi sen ajaa, ja kuinka usein kukin sääntö laukesi sekä sen viimeisimmät tapaukset.",
    emptyTitle: "Mitään ei ole vielä torjuttu",
    empty: "Pyydä testikeittiön agentilta enemmän kuin sen viikkobudjetti sallii, tai kutsu rajapintaa muutetulla valtakirjalla: torjunta näkyy tässä sääntöineen.",
  },
  sv: {
    title: "Skyddsregler",
    purpose: "Vad en agent får avgöra ensam, vad som kräver en person och vad som avvisas direkt: regelboken så som koden kör den, med hur ofta varje regel slog till och de senaste fallen.",
    emptyTitle: "Inget avvisat än",
    empty: "Be ett testköks agent om mer än veckobudgeten tillåter, eller anropa gränssnittet med en ändrad fullmakt: avvisningen syns här med sin regel.",
  },
});
