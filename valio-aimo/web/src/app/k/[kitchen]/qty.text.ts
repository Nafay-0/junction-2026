import { defineText } from "../../_i18n/lang";

/** The quantity control: minus, field, plus, and what the amount means. */
export const QTY_TEXT = defineText({
  en: {
    less: (unit: string) => `One ${unit} less`,
    more: (unit: string) => `One ${unit} more`,
    quantityIn: (_one: string, many: string) => `Quantity in ${many}`,
    steps: (n: number) => `Sold in steps of ${n}.`,
  },
  fi: {
    less: (unit: string) => `Yksi ${unit} vähemmän`,
    more: (unit: string) => `Yksi ${unit} lisää`,
    quantityIn: (one: string) => `Määrä, yksikkö: ${one}`,
    steps: (n: number) => `Myydään ${n}:n erissä.`,
  },
  sv: {
    less: (unit: string) => `En ${unit} mindre`,
    more: (unit: string) => `En ${unit} till`,
    quantityIn: (_one: string, many: string) => `Antal i ${many}`,
    steps: (n: number) => `Säljs i poster om ${n}.`,
  },
});
