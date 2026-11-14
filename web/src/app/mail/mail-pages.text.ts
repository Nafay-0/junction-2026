import { defineText } from "../_i18n/lang";

/** The two pages a kitchen reaches from an order email: confirming the address, and after the stop link. */
export const MAIL_PAGES_TEXT = defineText({
  en: {
    confirmTitle: "Confirm your address",
    confirmBody: (kitchen: string, to: string) => `${kitchen} asked for its order receipts, and an email when something changes, to go to ${to}.`,
    confirmButton: "Confirm this address",
    confirmed: (to: string) => `Done. Receipts and alerts go to ${to} from now on; every email has a link to stop them.`,
    already: (to: string) => `${to} is already confirmed.`,
    bad: "This link no longer works: it has expired, or the address was changed since. Give the address again in the store under Agent and rules.",
    stoppedTitle: "No more emails",
    stopped: "Done: no more order emails go to that address, and it is deleted. Your receipts stay in the store.",
    stopBad: "This link does not work. To stop the emails, remove the address in the store under Agent and rules.",
    back: "Go to the store",
  },
  fi: {
    confirmTitle: "Vahvista osoitteesi",
    confirmBody: (kitchen: string, to: string) => `${kitchen} pyysi tilauskuitit ja viestin muutoksista osoitteeseen ${to}.`,
    confirmButton: "Vahvista osoite",
    confirmed: (to: string) => `Valmis. Kuitit ja ilmoitukset menevät tästä lähtien osoitteeseen ${to}; jokaisessa viestissä on linkki niiden lopettamiseen.`,
    already: (to: string) => `${to} on jo vahvistettu.`,
    bad: "Linkki ei enää toimi: se on vanhentunut tai osoite on sen jälkeen vaihdettu. Anna osoite uudelleen verkkokaupassa kohdassa Agentti ja säännöt.",
    stoppedTitle: "Ei enää viestejä",
    stopped: "Valmis: tilausviestejä ei enää lähetetä tuohon osoitteeseen, ja osoite on poistettu. Kuitit löytyvät verkkokaupasta.",
    stopBad: "Linkki ei toimi. Lopeta viestit poistamalla osoite verkkokaupassa kohdassa Agentti ja säännöt.",
    back: "Siirry verkkokauppaan",
  },
  sv: {
    confirmTitle: "Bekräfta din adress",
    confirmBody: (kitchen: string, to: string) => `${kitchen} bad om att kvitton och ett mejl när något ändras skickas till ${to}.`,
    confirmButton: "Bekräfta adressen",
    confirmed: (to: string) => `Klart. Kvitton och meddelanden går till ${to} från och med nu; varje mejl har en länk för att stoppa dem.`,
    already: (to: string) => `${to} är redan bekräftad.`,
    bad: "Länken fungerar inte längre: den har gått ut, eller så har adressen bytts sedan dess. Ge adressen igen i webbutiken under Agent och regler.",
    stoppedTitle: "Inga fler mejl",
    stopped: "Klart: inga fler beställningsmejl går till den adressen, och den är raderad. Kvittona finns kvar i webbutiken.",
    stopBad: "Länken fungerar inte. Stoppa mejlen genom att ta bort adressen i webbutiken under Agent och regler.",
    back: "Till webbutiken",
  },
});
