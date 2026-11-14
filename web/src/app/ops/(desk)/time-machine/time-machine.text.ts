import { defineText } from "../../../_i18n/lang";

/** The operations portal's Time machine page. The portal renders English; Finnish and Swedish are kept ready. */
export const TIME_MACHINE_TEXT = defineText({
  en: {
    title: "Time machine",
    purpose: "The rules an order was judged by, as they stood at that second, beside the rules now.",
    emptyTitle: "No kitchen has rules on record yet",
    empty: "A kitchen appears here once its mandate is in force. Sign in as a test kitchen on /k, change a rule under Agent and rules, then place an order: the change shows on the time rail.",
  },
  fi: {
    title: "Aikakone",
    purpose: "Säännöt, joiden mukaan tilaus arvioitiin, sellaisina kuin ne olivat sillä sekunnilla, nykyisten sääntöjen rinnalla.",
    emptyTitle: "Yhdenkään keittiön sääntöjä ei ole vielä tallessa",
    empty: "Keittiö näkyy tässä, kun sen valtakirja on voimassa. Kirjaudu testikeittiöön osoitteessa /k, muuta sääntöä kohdassa Agentti ja säännöt ja tee tilaus: muutos näkyy aikajanalla.",
  },
  sv: {
    title: "Tidsmaskinen",
    purpose: "Reglerna en beställning bedömdes efter, som de stod just den sekunden, bredvid reglerna nu.",
    emptyTitle: "Inget kök har regler sparade än",
    empty: "Ett kök syns här när dess fullmakt gäller. Logga in som ett testkök på /k, ändra en regel under Agent och regler och lägg en beställning: ändringen syns på tidslinjen.",
  },
});
