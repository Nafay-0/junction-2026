import { defineText } from "../../../_i18n/lang";

/** The operations portal's Accounts page. The portal renders English; Finnish and Swedish are kept ready. */
export const ACCOUNTS_TEXT = defineText({
  en: {
    title: "Accounts",
    purpose: "Every restaurant or buyer with an account: its store address, when it signed up and when it last ordered. Accounts hold nothing else about a person.",
    emptyTitle: "No accounts yet",
    empty: "A restaurant appears here once it opens an account at /k/signup. The shared test accounts above are ready to sign in with.",
  },
  fi: {
    title: "Tilit",
    purpose: "Jokainen ravintola tai ostaja, jolla on tili: sen verkkokaupan osoite, milloin se rekisteröityi ja milloin se viimeksi tilasi. Tileissä ei ole muuta tietoa henkilöstä.",
    emptyTitle: "Ei vielä tilejä",
    empty: "Ravintola näkyy tässä, kun se avaa tilin osoitteessa /k/signup. Yllä olevilla yhteisillä testitileillä voi kirjautua heti.",
  },
  sv: {
    title: "Konton",
    purpose: "Varje restaurang eller köpare med ett konto: dess webbutiksadress, när den registrerade sig och när den senast beställde. Kontona innehåller inget annat om en person.",
    emptyTitle: "Inga konton än",
    empty: "En restaurang syns här när den öppnar ett konto på /k/signup. De gemensamma testkontona ovan är klara att logga in med.",
  },
});
