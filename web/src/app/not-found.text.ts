import { defineText } from "./_i18n/lang";

/** The page shown for an address that does not exist. */
export const NOT_FOUND_TEXT = defineText({
  en: {
    title: "This page does not exist",
    body: "The address may be mistyped, or the link is from an earlier version of the demo.",
    store: "Go to the store",
    home: "Back to the start",
  },
  fi: {
    title: "Sivua ei ole",
    body: "Osoitteessa voi olla kirjoitusvirhe, tai linkki on demon aiemmasta versiosta.",
    store: "Verkkokauppaan",
    home: "Alkuun",
  },
  sv: {
    title: "Sidan finns inte",
    body: "Adressen kan vara felskriven, eller så är länken från en tidigare version av demon.",
    store: "Till webbutiken",
    home: "Tillbaka till början",
  },
});
