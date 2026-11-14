import { defineText } from "../../_i18n/lang";

/**
 * The second reading's one line on the request card. The question on a difference is a concern (heading in
 * stages.text.ts, sentence from the server). `first` and `second` are the readers' names ("Claude Opus 5.5").
 */
export const SECOND_READING_TEXT = defineText({
  en: {
    agreed: (first: string, second: string) => `Read twice: ${second}, an independent open model, read the same amount, requirements and day as ${first}. Nothing to ask.`,
    differed: (first: string, second: string) => `Read twice: ${first} and ${second} read this differently, so you are asked below which you meant, before any price is fixed.`,
    unavailable: (second: string) => `Read once: the second reader (${second}) did not answer in time, so the first reading went ahead on its own.`,
  },
  fi: {
    agreed: (first: string, second: string) => `Luettu kahdesti: riippumaton avoin malli ${second} luki saman määrän, vaatimukset ja päivän kuin ${first}. Ei kysyttävää.`,
    differed: (first: string, second: string) => `Luettu kahdesti: ${first} ja ${second} lukivat tämän eri tavalla, joten alla kysytään, kumpaa tarkoitit, ennen kuin hinta lukitaan.`,
    unavailable: (second: string) => `Luettu kerran: toinen lukija (${second}) ei vastannut ajoissa, joten ensimmäinen lukema jatkoi yksin.`,
  },
  sv: {
    agreed: (first: string, second: string) => `Läst två gånger: ${second}, en oberoende öppen modell, läste samma mängd, krav och dag som ${first}. Inget att fråga.`,
    differed: (first: string, second: string) => `Läst två gånger: ${first} och ${second} läste det här olika, så nedan frågas vad du menade innan något pris låses.`,
    unavailable: (second: string) => `Läst en gång: den andra läsaren (${second}) svarade inte i tid, så den första läsningen fick gälla ensam.`,
  },
});
