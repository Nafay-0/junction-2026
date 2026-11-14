/** The product's display name, in one place: the team may rename it. */
export const PRODUCT_NAME = "AimoPilot";

/** Shown on every shop page: what this is, and that it is not the wholesaler's own shop. */
export const DEMO_NOTE = "A demo built for the Junction 2026 Valio Aimo challenge, on synthetic data. Not the wholesaler's own shop.";

/** The demo note in the buyer's language, for the customer side (the operations portal and the wall keep English). */
export const DEMO_NOTES = {
  en: DEMO_NOTE,
  fi: "Demo Junction 2026 -tapahtuman Valio Aimo -haasteeseen, keksityillä tiedoilla. Tämä ei ole tukun oma verkkokauppa.",
  sv: "En demo för Valio Aimo-utmaningen på Junction 2026, med påhittade uppgifter. Detta är inte grossistens egen webbutik.",
} as const;
