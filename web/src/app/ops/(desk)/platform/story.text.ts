import { defineText } from "../../../_i18n/lang";

/** The operations portal's Platform page. The portal renders English; Finnish and Swedish are kept ready. */
export const PLATFORM_TEXT = defineText({
  en: {
    title: "The platform",
    purpose: "The Aiven services AimoPilot runs on: is each alive, and what did it do in the last hour.",
    emptyTitle: "Nothing measured yet",
    empty: "The services report here as soon as this server talks to them. Place an order as a test kitchen on /k and the counts for the last hour start to move.",
  },
  fi: {
    title: "Alusta",
    purpose: "Aiven-palvelut, joilla AimoPilot toimii: onko kukin käynnissä ja mitä se teki viimeisen tunnin aikana.",
    emptyTitle: "Ei vielä mittauksia",
    empty: "Palvelut raportoivat tähän heti, kun tämä palvelin puhuu niille. Tee tilaus testikeittiönä osoitteessa /k, niin viimeisen tunnin luvut alkavat liikkua.",
  },
  sv: {
    title: "Plattformen",
    purpose: "Aiven-tjänsterna som AimoPilot körs på: är var och en igång, och vad gjorde den den senaste timmen.",
    emptyTitle: "Inget mätt än",
    empty: "Tjänsterna rapporterar här så fort den här servern talar med dem. Lägg en beställning som ett testkök på /k så börjar siffrorna för den senaste timmen röra sig.",
  },
});
