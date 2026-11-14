import { defineText } from "../../_i18n/lang";

/** "Would it pass today?" on an order's page: the rules then and now. The sentences inside come from the server. */
export const RULES_THEN_TEXT = defineText({
  en: {
    hidden: "The rules it was judged by",
    title: "Would it pass today?",
    then: (placed: string) => `With the rules of ${placed}, when it was placed`,
    now: "With today's rules",
    diff: (title: string, then: string, now: string) => `${title}: ${then} then, ${now} today.`,
    changes: "What changed since, and who changed it",
    note: (reproduces: boolean) =>
      `The same check the order went through, run again on the rules as they stood${reproduces ? "; against the rules of that moment it gives exactly the answer your order got" : ""}. Kept by the wholesaler in a database that records every earlier version of each rule by itself.`,
  },
  fi: {
    hidden: "Säännöt, joilla tilaus arvioitiin",
    title: "Menisikö se läpi tänään?",
    then: (placed: string) => `Tilaushetken (${placed}) säännöillä`,
    now: "Tämän päivän säännöillä",
    diff: (title: string, then: string, now: string) => `${title}: silloin ${then}, tänään ${now}.`,
    changes: "Mitä on muuttunut sen jälkeen ja kuka muutti",
    note: (reproduces: boolean) =>
      `Sama tarkistus, jonka tilaus kävi läpi, ajettuna uudelleen sääntöjen silloisella versiolla${reproduces ? "; sen hetken säännöillä se antaa täsmälleen saman vastauksen kuin tilauksesi sai" : ""}. Tukku säilyttää tiedot tietokannassa, joka tallentaa itse jokaisen säännön kaikki aiemmat versiot.`,
  },
  sv: {
    hidden: "Reglerna den bedömdes efter",
    title: "Skulle den gå igenom i dag?",
    then: (placed: string) => `Med reglerna från ${placed}, när den lades`,
    now: "Med dagens regler",
    diff: (title: string, then: string, now: string) => `${title}: ${then} då, ${now} i dag.`,
    changes: "Vad som ändrats sedan dess, och vem som ändrade det",
    note: (reproduces: boolean) =>
      `Samma kontroll som beställningen gick igenom, körd igen på reglerna som de var${reproduces ? "; mot reglerna från det ögonblicket ger den exakt det svar din beställning fick" : ""}. Grossisten sparar dem i en databas som själv registrerar varje tidigare version av varje regel.`,
  },
});
