import { defineText } from "../_i18n/lang";
import { PRODUCT_NAME } from "../_ui/brand";

/** The two pages that mount the planner: inside the store (/k/<kitchen>/menu) and on its own (/plan/<kitchen>). */
export const PLAN_PAGES_TEXT = defineText({
  en: {
    storeTitle: `${PRODUCT_NAME}: menu planner`,
    standaloneTitle: `${PRODUCT_NAME}: menu to order`,
    heading: "Menu planner",
    intro:
      "Say what you are serving and for how many. The agent drafts each dish's ingredients and amounts; plain code finds the products, checks every line against the kitchen's rules, fixes the price and sends one order through the gate.",
    onlyDemoTitle: "The menu planner is set up for the two demo kitchens",
    onlyDemoBody: "Visitor kitchens order through the order lane and the basket. To try a menu, open one of these:",
    kitchenLink: { kaari: "Ravintola Kaari, lunch restaurant", laakso: "Laakso Catering, schools and daycare" } as Record<string, string>,
    kitchensNav: "Kitchens",
    kitchenKind: { kaari: "Lunch restaurant", laakso: "School and daycare kitchen, no nuts" } as Record<string, string>,
    standaloneNote:
      "Also inside each kitchen's shop, under Menu planner. Demo on synthetic kitchens and the partner's test catalogue. The model drafts dishes and amounts; plain code checks every line, the price and the mandate.",
  },
  fi: {
    storeTitle: `${PRODUCT_NAME}: menusuunnittelu`,
    standaloneTitle: `${PRODUCT_NAME}: ruokalistasta tilaukseen`,
    heading: "Menusuunnittelu",
    intro:
      "Kerro, mitä tarjoat ja kuinka monelle. Agentti laatii jokaisen annoksen raaka-aineet ja määrät; tavallinen koodi etsii tuotteet, tarkistaa jokaisen rivin keittiön sääntöjä vasten, kiinnittää hinnan ja lähettää yhden tilauksen portin läpi.",
    onlyDemoTitle: "Menusuunnittelu on käytössä kahdessa demokeittiössä",
    onlyDemoBody: "Vierailijakeittiöt tilaavat Tilaa-sivun ja ostoskorin kautta. Kokeile ruokalistaa avaamalla jokin näistä:",
    kitchenLink: { kaari: "Ravintola Kaari, lounasravintola", laakso: "Laakso Catering, koulut ja päiväkodit" },
    kitchensNav: "Keittiöt",
    kitchenKind: { kaari: "Lounasravintola", laakso: "Koulu- ja päiväkotikeittiö, ei pähkinöitä" },
    standaloneNote:
      "Löytyy myös jokaisen keittiön verkkokaupasta kohdasta Menusuunnittelu. Demo keksityillä keittiöillä ja kumppanin testivalikoimalla. Malli luonnostelee annokset ja määrät; tavallinen koodi tarkistaa jokaisen rivin, hinnan ja valtakirjan.",
  },
  sv: {
    storeTitle: `${PRODUCT_NAME}: menyplanering`,
    standaloneTitle: `${PRODUCT_NAME}: från meny till beställning`,
    heading: "Menyplanering",
    intro:
      "Berätta vad du serverar och för hur många. Agenten gör ett utkast till varje rätts råvaror och mängder; vanlig kod hittar produkterna, kontrollerar varje rad mot kökets regler, låser priset och skickar en beställning genom grinden.",
    onlyDemoTitle: "Menyplaneringen är inställd för de två demoköken",
    onlyDemoBody: "Besökskök beställer via sidan Beställ och varukorgen. Öppna ett av dessa för att pröva en meny:",
    kitchenLink: { kaari: "Ravintola Kaari, lunchrestaurang", laakso: "Laakso Catering, skolor och daghem" },
    kitchensNav: "Kök",
    kitchenKind: { kaari: "Lunchrestaurang", laakso: "Skol- och daghemskök, inga nötter" },
    standaloneNote:
      "Finns också i varje köks webbutik, under Menyplanering. Demo med påhittade kök och partnerns testsortiment. Modellen gör utkast till rätter och mängder; vanlig kod kontrollerar varje rad, priset och fullmakten.",
  },
});
