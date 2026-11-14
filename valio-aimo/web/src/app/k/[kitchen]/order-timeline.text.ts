import { defineText } from "../../_i18n/lang";

/** The order's timeline on the kitchen's order page: the few steps that matter, every step one tap away. */
export const ORDER_TIMELINE_TEXT = defineText({
  en: {
    ownChoice: "its own choice",
    lookups: (counts: string) => `Checked live price and availability for ${counts} products`,
    then: ", then ",
    every: (n: number) => `Show every step (${n})`,
    fewer: "Show the main steps only",
  },
  fi: {
    ownChoice: "oma valinta",
    lookups: (counts: string) => `Tarkisti ajantasaisen hinnan ja saatavuuden: ${counts} tuotetta`,
    then: ", sitten ",
    every: (n: number) => `Näytä kaikki vaiheet (${n})`,
    fewer: "Näytä vain päävaiheet",
  },
  sv: {
    ownChoice: "eget val",
    lookups: (counts: string) => `Kontrollerade aktuellt pris och tillgänglighet: ${counts} produkter`,
    then: ", sedan ",
    every: (n: number) => `Visa alla steg (${n})`,
    fewer: "Visa bara huvudstegen",
  },
});
