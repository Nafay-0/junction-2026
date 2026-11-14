import { defineText } from "../_i18n/lang";

const fiDecimal = (n: number) => n.toFixed(1).replace(".", ",");

/** The request form at the top of the menu planner, its progress and its error titles. */
export const MENU_PLANNER_TEXT = defineText({
  en: {
    steps: [
      "Reading the request",
      "Writing each dish: ingredients, amounts per cover",
      "Finding products in the catalogue, checking them against the kitchen's rules",
      "One batched live lookup of price and delivery for the short list",
    ],
    question: "What are you serving?",
    hint: "A dish, a day's menu or a week's, with covers and the day. English, Finnish or Swedish.",
    placeholder: "Salmon soup for 300 on Friday",
    planIt: "Plan it",
    noModel: "No model configured",
    recorded: "Plans come from recorded model outputs for the examples above; everything after the model is live code.",
    seconds: (s: number) => `${s.toFixed(1)} s`,
    errModel: "No model to read the request",
    errNotReady: "Not ready for a fixed price",
    errOther: "Something stopped the plan",
    declined: "Not a menu to order for",
    nothingDone: "Nothing was looked up or ordered.",
  },
  fi: {
    steps: [
      "Luetaan pyyntöä",
      "Kirjoitetaan annokset: raaka-aineet ja määrät annosta kohden",
      "Haetaan tuotteet valikoimasta ja tarkistetaan ne keittiön sääntöjä vasten",
      "Yksi koottu haku lyhyen listan ajantasaisista hinnoista ja toimituksista",
    ],
    question: "Mitä tarjoat?",
    hint: "Yksi annos tai päivän tai viikon ruokalista, annosmäärä ja päivä. Suomeksi, ruotsiksi tai englanniksi.",
    placeholder: "Lohikeitto 300 annosta perjantaiksi",
    planIt: "Suunnittele",
    noModel: "Kielimallia ei ole määritetty",
    recorded: "Suunnitelmat tulevat yllä olevien esimerkkien tallennetuista mallivastauksista; kaikki mallin jälkeinen on oikeaa, ajossa olevaa koodia.",
    seconds: (s: number) => `${fiDecimal(s)} s`,
    errModel: "Pyynnön lukemiseen ei ole mallia",
    errNotReady: "Ei vielä valmis kiinteään hintaan",
    errOther: "Jokin pysäytti suunnitelman",
    declined: "Tästä ei voi tehdä tilattavaa ruokalistaa",
    nothingDone: "Mitään ei haettu eikä tilattu.",
  },
  sv: {
    steps: [
      "Läser förfrågan",
      "Skriver varje rätt: råvaror och mängder per portion",
      "Söker produkter i sortimentet och kontrollerar dem mot kökets regler",
      "En samlad aktuell kontroll av pris och leverans för den korta listan",
    ],
    question: "Vad serverar du?",
    hint: "En rätt, en dags eller en veckas meny, med portioner och dag. På svenska, finska eller engelska.",
    placeholder: "Laxsoppa för 300 på fredag",
    planIt: "Planera",
    noModel: "Ingen modell inställd",
    recorded: "Planerna kommer från inspelade modellsvar för exemplen ovan; allt efter modellen är riktig kod som körs.",
    seconds: (s: number) => `${fiDecimal(s)} s`,
    errModel: "Ingen modell som kan läsa förfrågan",
    errNotReady: "Inte klar för fast pris",
    errOther: "Något stoppade planen",
    declined: "Ingen meny att beställa för",
    nothingDone: "Ingenting söktes eller beställdes.",
  },
});
