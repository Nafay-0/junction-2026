import { toSource, type KeyFactsData } from "@/lib/widgets/types";

export const factsFixture: KeyFactsData = {
  kind: "facts",
  title: "Moving to Finland as a student",
  facts: [
    {
      label: "Residence permit fee",
      value: "€350",
      detail: "Online application. Paper applications cost €450.",
      sourceUrl: "https://migri.fi/en/fees",
    },
    {
      label: "Processing time",
      value: "1–2 months",
      detail: "Apply as soon as you get your letter of acceptance.",
      sourceUrl: "https://migri.fi/en/processing-times",
    },
    {
      label: "Required funds",
      value: "€800/month",
      detail: "About €9,600 for a year, shown on a bank statement.",
      sourceUrl: "https://migri.fi/en/studying-in-finland",
    },
    {
      label: "Working hours",
      value: "30 h/week",
      detail: "On average during term time; no limit in holidays.",
      sourceUrl: "https://migri.fi/en/studying-in-finland",
    },
    {
      label: "Kela health cover",
      value: "Not automatic for most non-EU students on a permit of under two years",
      detail: "Take out private health insurance before you apply for the permit.",
      sourceUrl: "https://www.kela.fi/web/en/moving-to-finland-to-study",
    },
    {
      label: "Student meal",
      value: "€2.95",
      detail: "Kela-subsidised lunch at university restaurants.",
      sourceUrl: "https://www.kela.fi/web/en/meal-subsidy",
    },
  ],
  sources: [
    toSource({ url: "https://migri.fi/en/fees", title: "Fees - Finnish Immigration Service" }),
    toSource({ url: "https://migri.fi/en/studying-in-finland", title: "Studying in Finland - Migri" }),
    toSource({ url: "https://migri.fi/en/processing-times", title: "Processing times - Migri" }),
    toSource({ url: "https://www.kela.fi/web/en/moving-to-finland-to-study", title: "Moving to Finland to study - Kela" }),
  ],
};

export const factsLoadingFixture: KeyFactsData = {
  kind: "facts",
  title: "Moving to Finland as a student",
  stage: "Checking fees and rules on migri.fi",
  facts: [
    {
      label: "Residence permit fee",
      value: "€350",
      detail: "Online application.",
      sourceUrl: "https://migri.fi/en/fees",
    },
  ],
  sources: [],
};
