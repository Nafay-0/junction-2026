import { defineText } from "../../../_i18n/lang";

/** The operations portal's Audit page. The portal renders English; Finnish and Swedish are kept ready. */
export const AUDIT_TEXT = defineText({
  en: {
    title: "Audit",
    purpose: "Who approved an order, for exactly what, and the proof.",
    emptyTitle: "No order yet",
    empty: "Place an order as a test kitchen (sign in as hotel-lumo on /k) and it appears here, whether signed, waiting, refused or declined.",
  },
  fi: {
    title: "Tarkastus",
    purpose: "Kuka hyväksyi tilauksen, tarkalleen mitä, ja todiste siitä.",
    emptyTitle: "Ei vielä tilauksia",
    empty: "Tee tilaus testikeittiönä (kirjaudu hotel-lumona osoitteessa /k), niin se näkyy tässä, oli se hyväksytty, odottava, torjuttu tai hylätty.",
  },
  sv: {
    title: "Granskning",
    purpose: "Vem som godkände en beställning, exakt vad, och beviset.",
    emptyTitle: "Inga beställningar än",
    empty: "Lägg en beställning som ett testkök (logga in som hotel-lumo på /k) så syns den här, oavsett om den är godkänd, väntar, avvisades eller avslogs.",
  },
});
