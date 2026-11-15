import { defineText } from "../../_i18n/lang";

/** Under a placed order in the conversation: where it stands with the wholesaler's team. */
export const THREAD_FULFILMENT_TEXT = defineText({
  en: {
    waiting: "With the wholesaler's team to confirm",
    confirmed: (time: string) => `Confirmed by the wholesaler's team${time ? ` at ${time}` : ""}`,
    refused: (reason?: string) => `The wholesaler's team could not confirm it${reason ? `: “${reason}”` : ""}`,
  },
  fi: {
    waiting: "Tukkurin tiimi vahvistaa toimituksen",
    confirmed: (time: string) => `Tukkurin tiimi vahvisti${time ? ` klo ${time}` : ""}`,
    refused: (reason?: string) => `Tukkurin tiimi ei voinut vahvistaa${reason ? `: ”${reason}”` : ""}`,
  },
  sv: {
    waiting: "Grossistens team bekräftar leveransen",
    confirmed: (time: string) => `Bekräftad av grossistens team${time ? ` kl. ${time}` : ""}`,
    refused: (reason?: string) => `Grossistens team kunde inte bekräfta den${reason ? `: ”${reason}”` : ""}`,
  },
});
