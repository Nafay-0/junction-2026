import { defineText } from "../../../_i18n/lang";

/** The operations portal's Orders page. The portal renders English; Finnish and Swedish are kept ready. */
export const OPS_ORDERS_TEXT = defineText({
  en: {
    title: "Orders",
    purpose: "Every order an agent placed, from every door, newest first. Open one for its whole timeline.",
    emptyTitle: "No orders yet",
    empty: "Place an order as a test kitchen (sign in as hotel-lumo on /k) and it shows up here, whether it was placed, is waiting for a person or was refused.",
    noMatchTitle: "No order matches",
    noMatch: "Clear the filters to see every order.",
    toConfirm: (n: number) => `${n} placed ${n === 1 ? "order waits" : "orders wait"} for your team to confirm ${n === 1 ? "it" : "them"} for delivery.`,
    showThem: "Show them",
    fulfilment: { waiting: "Waiting for your team to confirm", confirmed: "Confirmed for delivery", refused: "Could not be confirmed" } as Record<string, string>,
  },
  fi: {
    title: "Tilaukset",
    purpose: "Jokainen agentin tekemä tilaus, jokaisesta ovesta, uusin ensin. Avaa yksi nähdäksesi sen koko aikajanan.",
    emptyTitle: "Ei vielä tilauksia",
    empty: "Tee tilaus testikeittiönä (kirjaudu hotel-lumona osoitteessa /k), niin se näkyy tässä, oli se lähetetty, odottaa ihmisen hyväksyntää tai pysäytetty portilla.",
    noMatchTitle: "Mikään tilaus ei vastaa hakua",
    noMatch: "Tyhjennä suodattimet nähdäksesi kaikki tilaukset.",
    toConfirm: (n: number) => `${n} lähetetty${n === 1 ? " tilaus odottaa" : "ä tilausta odottaa"} tiimisi vahvistusta toimitukseen.`,
    showThem: "Näytä ne",
    fulfilment: { waiting: "Odottaa tiimisi vahvistusta", confirmed: "Vahvistettu toimitukseen", refused: "Ei voitu vahvistaa" } as Record<string, string>,
  },
  sv: {
    title: "Beställningar",
    purpose: "Varje beställning en agent lagt, från varje dörr, nyaste först. Öppna en för att se hela dess tidslinje.",
    emptyTitle: "Inga beställningar än",
    empty: "Lägg en beställning som ett testkök (logga in som hotel-lumo på /k) så syns den här, oavsett om den skickades, väntar på en person eller stoppades vid grinden.",
    noMatchTitle: "Ingen beställning matchar",
    noMatch: "Rensa filtren för att se alla beställningar.",
    toConfirm: (n: number) => `${n} ${n === 1 ? "skickad beställning väntar" : "skickade beställningar väntar"} på att ditt team bekräftar leveransen.`,
    showThem: "Visa dem",
    fulfilment: { waiting: "Väntar på ditt teams bekräftelse", confirmed: "Bekräftad för leverans", refused: "Kunde inte bekräftas" } as Record<string, string>,
  },
});
