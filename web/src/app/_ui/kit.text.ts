import { defineText } from "../_i18n/lang";

/** The shared components' own words (the operations portal reads English: it has no language provider). */
export const KIT_TEXT = defineText({
  en: { tryAgain: "Try again", close: "Close" },
  fi: { tryAgain: "Yritä uudelleen", close: "Sulje" },
  sv: { tryAgain: "Försök igen", close: "Stäng" },
});
