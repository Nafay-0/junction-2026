import { defineText } from "../../../_i18n/lang";

/** The operations portal's Accounts page. The portal renders English; Finnish and Swedish are kept ready. */
export const ACCOUNTS_TEXT = defineText({
  en: {
    title: "Accounts",
    purpose: "Every kitchen with an account: its store, when it signed up, when it last ordered.",
    emptyTitle: "No accounts yet",
    empty: "A restaurant appears here once it opens an account at /k/signup. The shared test accounts above are ready to sign in with.",
  },
  fi: {
    title: "Tilit",
    purpose: "Jokainen keittiö, jolla on tili: sen kauppa, milloin se liittyi ja milloin se viimeksi tilasi.",
    emptyTitle: "Ei vielä tilejä",
    empty: "Ravintola näkyy tässä, kun se avaa tilin osoitteessa /k/signup. Yllä olevilla yhteisillä testitileillä voi kirjautua heti.",
  },
  sv: {
    title: "Konton",
    purpose: "Varje kök med ett konto: dess butik, när det registrerade sig och när det senast beställde.",
    emptyTitle: "Inga konton än",
    empty: "En restaurang syns här när den öppnar ett konto på /k/signup. De gemensamma testkontona ovan är klara att logga in med.",
  },
});
