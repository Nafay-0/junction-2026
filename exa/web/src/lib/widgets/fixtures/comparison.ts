import { toSource, type ComparisonData } from "@/lib/widgets/types";

export const comparisonFixture: ComparisonData = {
  kind: "comparison",
  title: "Unlimited mobile plans in Helsinki",
  columns: ["Elisa Saunalahti 5G", "DNA Super 5G", "Telia Rajaton 5G"],
  rows: [
    { label: "Monthly price", values: ["€29.90", "€27.99", "€34.90"] },
    { label: "Max speed", values: ["600 Mbit/s", "1000 Mbit/s", "450 Mbit/s"] },
    { label: "EU roaming data", values: ["30 GB", "26 GB", "35 GB"] },
    { label: "Commitment", values: ["None", "12 months", "None"] },
    { label: "eSIM", values: ["Yes", "Yes", "Yes"] },
    { label: "Streaming add-on", values: ["Included", "Not included", "Not included"] },
  ],
  winner: 0,
  note: "Prices are campaign rates for new customers and rise after the first 6 months. DNA's lower price needs a 12-month contract.",
  sources: [
    toSource({ url: "https://elisa.fi/saunalahti/puhelinliittymat/", title: "Saunalahti puhelinliittymät" }),
    toSource({ url: "https://www.dna.fi/puhelinliittymat", title: "DNA puhelinliittymät" }),
    toSource({ url: "https://www.telia.fi/kauppa/puhelinliittymat", title: "Telia puhelinliittymät" }),
  ],
};

export const comparisonLoadingFixture: ComparisonData = {
  kind: "comparison",
  title: "Unlimited mobile plans in Helsinki",
  stage: "Reading plan pages from Elisa, DNA and Telia",
  columns: [],
  rows: [],
  sources: [],
};
