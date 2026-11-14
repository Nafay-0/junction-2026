import { defineText } from "../../../_i18n/lang";

/** The operations portal's Orders page. The portal renders English; Finnish and Swedish are kept ready. */
export const OPS_ORDERS_TEXT = defineText({
  en: {
    title: "Orders",
    purpose: "Every order from every source, newest first: who placed it, through which door, how it was decided and where it stands now. Open one for its whole life.",
    emptyTitle: "No orders yet",
    empty: "Place an order as a test kitchen (sign in as hotel-lumo on /k) and it shows up here, whether it was placed, is waiting for a person or was refused.",
    noMatchTitle: "No order matches",
    noMatch: "Clear the filters to see every order.",
  },
  fi: {
    title: "Tilaukset",
    purpose: "Kaikki tilaukset kaikista lähteistä, uusin ensin: kuka sen teki, minkä oven kautta, miten siitä päätettiin ja missä se on nyt. Avaa tilaus nähdäksesi sen koko elinkaaren.",
    emptyTitle: "Ei vielä tilauksia",
    empty: "Tee tilaus testikeittiönä (kirjaudu hotel-lumona osoitteessa /k), niin se näkyy tässä, oli se lähetetty, odottaa ihmisen hyväksyntää tai pysäytetty portilla.",
    noMatchTitle: "Mikään tilaus ei vastaa hakua",
    noMatch: "Tyhjennä suodattimet nähdäksesi kaikki tilaukset.",
  },
  sv: {
    title: "Beställningar",
    purpose: "Alla beställningar från alla källor, nyaste först: vem som lade den, genom vilken dörr, hur den avgjordes och var den står nu. Öppna en för att se hela dess förlopp.",
    emptyTitle: "Inga beställningar än",
    empty: "Lägg en beställning som ett testkök (logga in som hotel-lumo på /k) så syns den här, oavsett om den skickades, väntar på en person eller stoppades vid grinden.",
    noMatchTitle: "Ingen beställning matchar",
    noMatch: "Rensa filtren för att se alla beställningar.",
  },
});
