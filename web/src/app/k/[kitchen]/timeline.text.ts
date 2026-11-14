import { defineText } from "../../_i18n/lang";

/** "What the agent did and why" and the chain check under it. */
export const TIMELINE_TEXT = defineText({
  en: {
    raw: "Show the raw ledger entries",
    check: "Check the whole chain in this browser",
    tamper: "Edit one decision, then check",
    readFailed: (error: string) => `Could not read the ledger: ${error}`,
    allOk: (n: number) => `All ${n} entries check out.`,
    allOkDetail: (ms: number) => ` Your browser recomputed every SHA-256 link from the first entry in ${ms} ms; nothing was changed after it was written.`,
    caught: "Caught.",
    tamperedNote: " The edit was made only in this browser's copy; the ledger on the server is untouched.",
  },
  fi: {
    raw: "Näytä kirjanpidon raakamerkinnät",
    check: "Tarkista koko ketju tässä selaimessa",
    tamper: "Muuta yhtä päätöstä ja tarkista",
    readFailed: (error: string) => `Kirjanpitoa ei voitu lukea: ${error}`,
    allOk: (n: number) => `Kaikki ${n} merkintää ovat kunnossa.`,
    allOkDetail: (ms: number) => ` Selaimesi laski jokaisen SHA-256-linkin uudelleen ensimmäisestä merkinnästä alkaen ${ms} ms:ssa. Mitään ei ole muutettu kirjaamisen jälkeen.`,
    caught: "Muutos paljastui.",
    tamperedNote: " Muutos tehtiin vain tämän selaimen kopioon; palvelimen tapahtumaloki on koskematon.",
  },
  sv: {
    raw: "Visa händelseloggens råa poster",
    check: "Kontrollera hela kedjan i den här webbläsaren",
    tamper: "Ändra ett beslut och kontrollera sedan",
    readFailed: (error: string) => `Liggaren kunde inte läsas: ${error}`,
    allOk: (n: number) => `Alla ${n} poster stämmer.`,
    allOkDetail: (ms: number) => ` Din webbläsare räknade om varje SHA-256-länk från den första posten på ${ms} ms; inget har ändrats efter att det skrevs.`,
    caught: "Ändringen avslöjades.",
    tamperedNote: " Ändringen gjordes bara i den här webbläsarens kopia; händelseloggen på servern är orörd.",
  },
});
