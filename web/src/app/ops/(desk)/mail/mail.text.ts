import { defineText } from "../../../_i18n/lang";

/** The operations portal's Mail page. The portal renders English; Finnish and Swedish are kept ready. */
export const MAIL_TEXT = defineText({
  en: {
    title: "Mail",
    purpose: "Receipts and \"something changed\" alerts emailed to kitchens after the fact, never in the path of an order: every mail sent, skipped or failed, with a preview. Addresses stay masked.",
    emptyTitle: "No mail yet",
    empty: "A kitchen gives its address in the store (Agent and rules) and confirms it; its receipts and alerts then appear here. Place an order as that kitchen to make one.",
  },
  fi: {
    title: "Sähköposti",
    purpose: "Kuitit ja ilmoitukset muutoksista, jotka lähetetään keittiöille jälkikäteen eikä koskaan tilauksen tiellä: jokainen lähetetty, ohitettu tai epäonnistunut viesti esikatseluineen. Osoitteet näkyvät peitettyinä.",
    emptyTitle: "Ei vielä viestejä",
    empty: "Keittiö antaa osoitteensa verkkokaupassa (Agentti ja säännöt) ja vahvistaa sen; sen kuitit ja ilmoitukset näkyvät sitten tässä. Tee tilaus kyseisenä keittiönä, niin saat ensimmäisen.",
  },
  sv: {
    title: "E-post",
    purpose: "Kvitton och meddelanden om ändringar som mejlas till köken i efterhand, aldrig i vägen för en beställning: varje mejl som skickats, hoppats över eller misslyckats, med förhandsvisning. Adresserna visas maskerade.",
    emptyTitle: "Ingen e-post än",
    empty: "Ett kök anger sin adress i webbutiken (Agent och regler) och bekräftar den; dess kvitton och meddelanden syns sedan här. Lägg en beställning som det köket för att skapa ett.",
  },
});
