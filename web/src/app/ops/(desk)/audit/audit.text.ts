import { defineText } from "../../../_i18n/lang";

/** The operations portal's Audit page. The portal renders English; Finnish and Swedish are kept ready. */
export const AUDIT_TEXT = defineText({
  en: {
    title: "Audit",
    purpose: "For any order: what was asked, what the wholesaler stated, what was committed and who signed, checkable against the published keys. A kitchen's private memory is not part of it.",
    emptyTitle: "No order yet",
    empty: "Place an order as a test kitchen (sign in as hotel-lumo on /k) and it appears here, whether signed, waiting, refused or declined.",
  },
  fi: {
    title: "Tarkastus",
    purpose: "Mille tahansa tilaukselle: mitä pyydettiin, mitä tukku ilmoitti, mitä sitouduttiin toimittamaan ja kuka hyväksyi, tarkistettavissa julkaistuja avaimia vasten. Keittiön yksityinen muisti ei kuulu tähän.",
    emptyTitle: "Ei vielä tilauksia",
    empty: "Tee tilaus testikeittiönä (kirjaudu hotel-lumona osoitteessa /k), niin se näkyy tässä, oli se hyväksytty, odottava, torjuttu tai hylätty.",
  },
  sv: {
    title: "Granskning",
    purpose: "För varje beställning: vad som efterfrågades, vad grossisten uppgav, vad som bekräftades och vem som godkände, kontrollerbart mot de publicerade nycklarna. Kökets privata minne ingår inte.",
    emptyTitle: "Inga beställningar än",
    empty: "Lägg en beställning som ett testkök (logga in som hotel-lumo på /k) så syns den här, oavsett om den är godkänd, väntar, avvisades eller avslogs.",
  },
});
