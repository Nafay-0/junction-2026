import { defineText } from "../../../_i18n/lang";

/** The operations portal's Platform page. The portal renders English; Finnish and Swedish are kept ready. */
export const PLATFORM_TEXT = defineText({
  en: {
    title: "The platform",
    purpose: "Every service AimoPilot runs on, the one job each does and whether it answers now, with what it did in the last hour and any alert that is breaching, read live from the service.",
    emptyTitle: "Nothing measured yet",
    empty: "The services report here as soon as this server talks to them. Place an order as a test kitchen on /k and the counts for the last hour start to move.",
  },
  fi: {
    title: "Alusta",
    purpose: "Jokainen palvelu, jonka varassa AimoPilot toimii: kunkin yksi tehtävä ja vastaako se nyt, mitä se teki viimeisen tunnin aikana ja mikä hälytys on ylittynyt, luettuna suoraan palvelusta.",
    emptyTitle: "Ei vielä mittauksia",
    empty: "Palvelut raportoivat tähän heti, kun tämä palvelin puhuu niille. Tee tilaus testikeittiönä osoitteessa /k, niin viimeisen tunnin luvut alkavat liikkua.",
  },
  sv: {
    title: "Plattformen",
    purpose: "Varje tjänst AimoPilot körs på, den enda uppgift var och en har och om den svarar nu, med vad den gjorde den senaste timmen och eventuellt larm som överskrids, läst direkt från tjänsten.",
    emptyTitle: "Inget mätt än",
    empty: "Tjänsterna rapporterar här så fort den här servern talar med dem. Lägg en beställning som ett testkök på /k så börjar siffrorna för den senaste timmen röra sig.",
  },
});
