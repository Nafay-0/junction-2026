import { defineText } from "../../../_i18n/lang";

/** The operations portal's Mail page. The portal renders English; Finnish and Swedish are kept ready. */
export const MAIL_TEXT = defineText({
  en: {
    title: "Mail",
    purpose: "Receipts and alerts emailed to kitchens, after the fact.",
    emptyTitle: "No mail yet",
    empty: "A kitchen gives its address in the store (Agent and rules) and confirms it; its receipts and alerts then appear here. Place an order as that kitchen to make one.",
  },
  fi: {
    title: "Sähköposti",
    purpose: "Keittiöille sähköpostitse lähetetyt kuitit ja hälytykset, jälkikäteen.",
    emptyTitle: "Ei vielä viestejä",
    empty: "Keittiö antaa osoitteensa verkkokaupassa (Agentti ja säännöt) ja vahvistaa sen; sen kuitit ja ilmoitukset näkyvät sitten tässä. Tee tilaus kyseisenä keittiönä, niin saat ensimmäisen.",
  },
  sv: {
    title: "E-post",
    purpose: "Kvitton och larm som mejlas till köken, i efterhand.",
    emptyTitle: "Ingen e-post än",
    empty: "Ett kök anger sin adress i webbutiken (Agent och regler) och bekräftar den; dess kvitton och meddelanden syns sedan här. Lägg en beställning som det köket för att skapa ett.",
  },
});
