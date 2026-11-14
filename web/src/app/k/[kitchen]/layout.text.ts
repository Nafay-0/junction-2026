import { defineText } from "../../_i18n/lang";
import { PRODUCT_NAME } from "../../_ui/brand";

/** The store's page titles (read on the server) and the page shown when a kitchen is closed. */
export const LAYOUT_TEXT = defineText({
  en: {
    title: {
      shop: `${PRODUCT_NAME}: kitchen shop`,
      catalogue: `${PRODUCT_NAME}: catalogue`,
      product: `${PRODUCT_NAME}: product`,
      basket: `${PRODUCT_NAME}: basket`,
    },
    closedTitle: "This kitchen is not open",
    closedBody: "Visitor kitchens close after 90 minutes. Pick a kitchen that is here now:",
  },
  fi: {
    title: {
      shop: `${PRODUCT_NAME}: keittiön verkkokauppa`,
      catalogue: `${PRODUCT_NAME}: tuotteet`,
      product: `${PRODUCT_NAME}: tuote`,
      basket: `${PRODUCT_NAME}: ostoskori`,
    },
    closedTitle: "Tämä keittiö ei ole auki",
    closedBody: "Vierailijoiden keittiöt sulkeutuvat 90 minuutin kuluttua. Valitse keittiö, joka on nyt auki:",
  },
  sv: {
    title: {
      shop: `${PRODUCT_NAME}: kökets webbutik`,
      catalogue: `${PRODUCT_NAME}: produkter`,
      product: `${PRODUCT_NAME}: produkt`,
      basket: `${PRODUCT_NAME}: varukorg`,
    },
    closedTitle: "Det här köket är inte öppet",
    closedBody: "Besökarnas kök stängs efter 90 minuter. Välj ett kök som är öppet nu:",
  },
});
