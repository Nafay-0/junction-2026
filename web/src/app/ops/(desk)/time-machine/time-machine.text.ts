import { defineText } from "../../../_i18n/lang";

/** The operations portal's Time machine page. The portal renders English; Finnish and Swedish are kept ready. */
export const TIME_MACHINE_TEXT = defineText({
  en: {
    title: "Time machine",
    purpose: "The rules an order was judged by, exactly as they stood at that second, beside the rules now: what changed, who changed it, and whether the order would pass today. Pick a kitchen and an order, then drag the time rail.",
    emptyTitle: "No kitchen has rules on record yet",
    empty: "A kitchen appears here once its mandate is in force. Sign in as a test kitchen on /k, change a rule under Agent and rules, then place an order: the change shows on the time rail.",
  },
  fi: {
    title: "Aikakone",
    purpose: "Säännöt, joiden mukaan tilaus arvioitiin, täsmälleen sellaisina kuin ne olivat sillä sekunnilla, nykyisten sääntöjen rinnalla: mikä muuttui, kuka sen muutti ja menisikö tilaus läpi tänään. Valitse keittiö ja tilaus ja vedä aikajanaa.",
    emptyTitle: "Yhdenkään keittiön sääntöjä ei ole vielä tallessa",
    empty: "Keittiö näkyy tässä, kun sen valtakirja on voimassa. Kirjaudu testikeittiöön osoitteessa /k, muuta sääntöä kohdassa Agentti ja säännöt ja tee tilaus: muutos näkyy aikajanalla.",
  },
  sv: {
    title: "Tidsmaskinen",
    purpose: "Reglerna som en beställning bedömdes efter, exakt som de stod den sekunden, bredvid reglerna nu: vad som ändrades, vem som ändrade det och om beställningen skulle gå igenom i dag. Välj ett kök och en beställning och dra i tidslinjen.",
    emptyTitle: "Inget kök har regler sparade än",
    empty: "Ett kök syns här när dess fullmakt gäller. Logga in som ett testkök på /k, ändra en regel under Agent och regler och lägg en beställning: ändringen syns på tidslinjen.",
  },
});
