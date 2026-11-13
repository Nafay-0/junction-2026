import { toSource, type ResearchAgent, type ResearchData } from "@/lib/widgets/types";

const QUESTION = "Is it cheaper to heat a Finnish home with a heat pump or district heating in 2026?";

const prices: ResearchAgent = {
  id: "prices",
  title: "District heating tariffs in 2026",
  status: "done",
  steps: [
    { type: "search", label: "District heating price per MWh Finland 2026", domains: ["energiateollisuus.fi", "energiavirasto.fi"] },
    { type: "read", label: "Energy Authority price comparison for detached houses", domains: ["energiavirasto.fi"] },
    { type: "search", label: "Helen district heat basic fee 2026", domains: ["helen.fi"] },
    { type: "read", label: "Helen price list for small houses", domains: ["helen.fi"] },
    { type: "read", label: "Finnish Energy annual district heating statistics", domains: ["energiateollisuus.fi"] },
    { type: "think", label: "Normalising tariffs to a 150 m² house using 20 MWh a year" },
  ],
  findings: [
    "- The national average for a detached house is about **11.0 c/kWh including VAT**, energy and basic fee combined.",
    "- Helsinki (Helen) sits slightly above average; smaller networks range from 8 to 14 c/kWh.",
    "- For a 150 m² house using 20 MWh a year this works out to roughly **€2,100 to €2,400 a year**.",
    "- Prices have risen more slowly than electricity since 2022, and no connection fee applies to existing homes.",
  ].join("\n"),
  sources: [
    toSource({ url: "https://energiavirasto.fi/en/district-heating-prices", title: "District heating prices for consumers", publishedDate: "2026-07-01", snippet: "The average price of district heating for a detached house was 11.0 c/kWh including VAT." }),
    toSource({ url: "https://energia.fi/en/statistics/district-heating-statistics/", title: "District heating statistics 2025", publishedDate: "2026-04-15" }),
    toSource({ url: "https://www.helen.fi/en/heating-and-cooling/district-heat/prices", title: "District heat prices for small houses" }),
    toSource({ url: "https://www.stat.fi/en/statistics/ehi", title: "Energy prices, Q2 2026", publishedDate: "2026-09-10" }),
  ],
};

const heatPumps: ResearchAgent = {
  id: "heat-pumps",
  title: "Heat pump running costs and efficiency",
  status: "done",
  steps: [
    { type: "search", label: "Ground source heat pump SCOP Finnish climate", domains: ["sulpu.fi", "motiva.fi"] },
    { type: "read", label: "Motiva guide to heating system running costs", domains: ["motiva.fi"] },
    { type: "search", label: "Air to water heat pump performance at -25 °C", domains: ["vtt.fi"] },
    { type: "read", label: "VTT field study of 40 heat pump homes", domains: ["vtt.fi"] },
    { type: "think", label: "Converting heat demand to electricity use per pump type" },
  ],
  findings: [
    "- A ground source pump averages a **seasonal COP of about 3.3** in southern Finland, 3.0 in Lapland.",
    "- Air-to-water pumps manage about **2.6**, dropping close to 1.5 in the coldest weeks.",
    "- For 20 MWh of heat, that means 6,100 kWh (ground) or 7,700 kWh (air-to-water) of electricity a year.",
  ].join("\n"),
  sources: [
    toSource({ url: "https://www.motiva.fi/en/solutions/heating/heat_pumps", title: "Heat pumps: running costs and choosing a system", publishedDate: "2026-02-20" }),
    toSource({ url: "https://www.sulpu.fi/en/statistics", title: "Finnish Heat Pump Association: sales statistics 2025", publishedDate: "2026-01-28" }),
    toSource({ url: "https://www.vttresearch.com/en/news-and-ideas/heat-pumps-cold-climate", title: "How heat pumps perform in a Nordic winter", publishedDate: "2025-11-03" }),
  ],
};

const electricity: ResearchAgent = {
  id: "electricity",
  title: "Electricity price outlook for 2026",
  status: "done",
  steps: [
    { type: "search", label: "Finland spot price average 2026 forecast", domains: ["nordpoolgroup.com", "fingrid.fi"] },
    { type: "read", label: "Nord Pool monthly system price data for FI", domains: ["nordpoolgroup.com"] },
    { type: "search", label: "Electricity transfer fee increase 2026 Caruna Elenia", domains: ["caruna.fi", "elenia.fi"] },
    { type: "read", label: "Energy Authority report on network tariffs", domains: ["energiavirasto.fi"] },
    { type: "read", label: "Fingrid winter outlook 2026 to 2027", domains: ["fingrid.fi"] },
    { type: "think", label: "Building an all-in price: energy, transfer, tax and VAT" },
    { type: "think", label: "Weighting for winter-heavy heating consumption" },
  ],
  findings: [
    "- The Finnish spot price averaged **4.6 c/kWh** over the last twelve months, but winter months run 2 to 3 times higher.",
    "- With transfer, electricity tax and 25.5% VAT, a heating-weighted all-in price is about **15 c/kWh**.",
    "- Fingrid expects adequate winter supply; the main risk is cold, still weeks with low wind output.",
  ].join("\n"),
  sources: [
    toSource({ url: "https://www.nordpoolgroup.com/en/market-data/", title: "Day-ahead prices, FI area" }),
    toSource({ url: "https://www.fingrid.fi/en/news/news/2026/winter-outlook/", title: "Electricity adequacy in winter 2026 to 2027", publishedDate: "2026-10-08" }),
    toSource({ url: "https://www.caruna.fi/en/prices", title: "Electricity transfer prices from 2026" }),
    toSource({ url: "https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/electricity-tax/", title: "Excise duty on electricity" }),
    toSource({ url: "https://energiavirasto.fi/en/electricity-network-tariffs", title: "Network tariff monitoring" }),
  ],
};

const upfront: ResearchAgent = {
  id: "upfront",
  title: "Installation costs and subsidies",
  status: "done",
  steps: [
    { type: "search", label: "Ground source heat pump installation cost 2026", domains: ["sulpu.fi", "kotitalo.fi"] },
    { type: "search", label: "Kotitalousvähennys 2026 heat pump installation", domains: ["vero.fi"] },
    { type: "read", label: "Tax administration rules for the household deduction", domains: ["vero.fi"] },
    { type: "search", label: "EU heating renovation grants Finland ARA", domains: ["ara.fi", "ec.europa.eu"] },
    { type: "think", label: "Comparing payback against a district heating baseline" },
  ],
  findings: [
    "- Ground source installs cost **€15,000 to €22,000** including drilling; air-to-water **€9,000 to €13,000**.",
    "- The household deduction covers 35% of labour, up to €1,600 per person per year.",
    "- The ARA grant for replacing oil heating ended in 2025; no grant applies when leaving district heat.",
  ].join("\n"),
  sources: [
    toSource({ url: "https://www.vero.fi/en/individuals/deductions/Tax-credit-for-household-expenses/", title: "Tax credit for household expenses", publishedDate: "2026-01-02" }),
    toSource({ url: "https://www.ara.fi/en-US/Housing_finance/Grants", title: "Housing grants and subsidies" }),
    toSource({ url: "https://energy.ec.europa.eu/topics/energy-efficiency/heat-pumps_en", title: "Heat pumps - European Commission" }),
    toSource({ url: "https://www.sulpu.fi/en/heat-pump-costs", title: "What does a heat pump cost?" }),
  ],
};

const REPORT = `## Short answer

For a typical 150 m² detached house, a **ground source heat pump is cheaper to run** than district heating in 2026, by roughly €1,100 a year. District heating stays the better deal if you would have to pay for the installation now, or if the house is already connected and well insulated.

## Yearly running cost

Assumes 20 MWh of heat a year in southern Finland, electricity at about 15 c/kWh all-in ([fingrid.fi](https://www.fingrid.fi/en/news/news/2026/winter-outlook/)) and district heat at the national average ([energiavirasto.fi](https://energiavirasto.fi/en/district-heating-prices)).

| System | Efficiency | Energy bought | Cost a year |
| --- | --- | --- | --- |
| District heating | 1.0 | 20,000 kWh heat | €2,200 |
| Ground source pump | SCOP 3.3 | 6,100 kWh | €920 |
| Air-to-water pump | SCOP 2.6 | 7,700 kWh | €1,160 |

## Upfront cost and payback

A ground source system costs €15,000 to €22,000 installed ([sulpu.fi](https://www.sulpu.fi/en/heat-pump-costs)). After the [household deduction](https://www.vero.fi/en/individuals/deductions/Tax-credit-for-household-expenses/) that pays back in **13 to 18 years**, close to the pump's service life. Air-to-water pays back sooner, in 9 to 12 years, but works hardest exactly when power is most expensive.

## What would change the answer

- A winter spot price above 12 c/kWh narrows the gap by about a third ([nordpoolgroup.com](https://www.nordpoolgroup.com/en/market-data/)).
- Some district networks, such as [Helen](https://www.helen.fi/en/heating-and-cooling/district-heat/prices), charge a fixed basic fee you keep paying until you disconnect.
- Adding solar panels or a spot-price contract with smart scheduling improves heat pump savings further ([motiva.fi](https://www.motiva.fi/en/solutions/heating/heat_pumps)).

**Bottom line:** switch only if you plan to stay 15 years or more; otherwise stay on district heat.`;

const allSources = [prices, heatPumps, electricity, upfront].flatMap((a) => a.sources);

export const researchFixture: ResearchData = {
  kind: "research",
  question: QUESTION,
  status: "done",
  agents: [prices, heatPumps, electricity, upfront],
  report: REPORT,
  sources: allSources,
  exaCostUsd: 0.42,
};

export const researchLoadingFixture: ResearchData = {
  kind: "research",
  question: QUESTION,
  status: "researching",
  stage: "4 researchers working in parallel",
  agents: [
    prices,
    {
      ...heatPumps,
      status: "working",
      steps: heatPumps.steps.slice(0, 4),
      findings: undefined,
      sources: heatPumps.sources.slice(0, 2),
    },
    {
      ...electricity,
      status: "working",
      steps: electricity.steps.slice(0, 2),
      findings: undefined,
      sources: electricity.sources.slice(0, 1),
    },
    { ...upfront, status: "queued", steps: [], findings: undefined, sources: [] },
  ],
  sources: [],
};
