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

export const researchStandardFixture: ResearchData = {
  kind: "research",
  question: QUESTION,
  status: "done",
  agents: [prices, heatPumps, electricity, upfront],
  report: REPORT,
  sources: allSources,
  exaCostUsd: 0.42,
};

export const researchStandardLoadingFixture: ResearchData = {
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

/* ───────────────────────── A deep run ─────────────────────────
 *
 * A real run at the "Deeper" level (14 November 2026): six researchers, then three more in a
 * second round, 681 pages checked and 239 kept. The findings are cut short and only the first
 * sources are listed, to keep this file a reasonable size; the counts are the run's own.
 * The gallery shows this one, because it is the harder layout: a large team, two rounds, a long report.
 */

export const researchFixture: ResearchData = {
 "kind": "research",
 "question": "Should I lease or buy an electric car in Finland in 2026? I drive about 15,000 km a year and live in Espoo.",
 "status": "done",
 "depth": "Deeper",
 "round": 2,
 "pagesChecked": 681,
 "sourceCount": 239,
 "agents": [
  {
   "id": "r1",
   "title": "Private leasing (yksityisleasing) of electric cars in Finland in 2025-2026: current monthly prices for popular EVs (e.g.",
   "status": "done",
   "round": 1,
   "steps": [
    {
     "type": "search",
     "label": "yksityisleasing sähköauto kuukausihinta 2026 (and 2 more)",
     "domains": [
      "vauriokorjaamo.autokeskus.fi",
      "gomore.fi",
      "autokauppa.ayvens.com"
     ],
     "checked": 26,
     "kept": 16
    },
    {
     "type": "search",
     "label": "Ayvens yksityisleasing sähköauto hinta (and 2 more)",
     "domains": [
      "astrum.fi",
      "veho.fi",
      "vauriokorjaamo.autokeskus.fi"
     ],
     "checked": 27,
     "kept": 16
    },
    {
     "type": "search",
     "label": "Skoda Elroq Enyaq yksityisleasing kuukausihinta 48 kk 15 000 km (and 2 more)",
     "domains": [
      "volkswagen.fi",
      "k-auto.fi",
      "autotalli.com"
     ],
     "checked": 27,
     "kept": 13
    },
    {
     "type": "search",
     "label": "Tesla Model Y leasing Suomi kuukausimaksu 2026 Tesla yksityisleasing (and 2 more)",
     "domains": [
      "nelipyora.fi",
      "gomore.fi",
      "autokauppa.ayvens.com"
     ],
     "checked": 27,
     "kept": 17
    },
    {
     "type": "read",
     "label": "volkswagen.fi and 2 more",
     "domains": [
      "volkswagen.fi",
      "vauriokorjaamo.autokeskus.fi",
      "nelipyora.fi"
     ]
    },
    {
     "type": "search",
     "label": "ajoneuvovero sähköauto 2026 perusvero käyttövoimavero täyssähköauto (and 2 more)",
     "domains": [
      "k-ryhma.fi",
      "finaro.fi"
     ],
     "checked": 30,
     "kept": 2
    },
    {
     "type": "read",
     "label": "Yksityisleasing 2026 – leasing auto vai autolaina? | Finaro",
     "domains": [
      "finaro.fi"
     ]
    }
   ],
   "findings": "**Bottom line:** For 15,000 km/yr, a 40,000 km lease is the wrong product. The per-km overage fees (about 0.15–0.22 €/km) make lease prices quoted at 40,000 km misleading. Compare at 45,000–60,000 km for 36–48 months.\n\n**Current lease prices (quoted, not like-for-like)**\n- Kia EV3 Air FWD, from 449.89 €/kk, 0 € down, 48 mo / 40,000 km, total 21,594.72 €. Includes servicing, repairs and two sets of tyres. Requires approved financing and full (kasko) insurance.",
   "sources": [
    {
     "url": "https://vauriokorjaamo.autokeskus.fi/tarjoukset/tarjous/kia-ev3-yksityisleasingilla-alk-449-eur-kk/",
     "title": "Kia EV3 yksityisleasingillä alk. 449 €/kk | Autokeskus",
     "domain": "vauriokorjaamo.autokeskus.fi",
     "snippet": "Kia yksityisleasing on helppo, vaivaton ja riskitön tapa hankkia uusi auto. Maksat vain auton käytöstä - määräaikaishuollot, korjaukset ja talvirenkaat sisältyv"
    },
    {
     "url": "https://gomore.fi/leasing/electric-hybrid",
     "title": "Sähkö- ja hybridiautojen yksityisleasing - Sis. huolto ja vakuutus",
     "domain": "gomore.fi"
    },
    {
     "url": "https://autokauppa.ayvens.com/fi/autohaku/yksityisleasing/",
     "title": "Ayvens yksityisleasing-autot | Autohaku | Autokauppa Ayvens",
     "domain": "autokauppa.ayvens.com"
    },
    {
     "url": "https://autoleasing.fi/artikkelit/tesla-model-3/",
     "title": "Tesla Model 3 » Hinta & Tekniset tiedot - Nordea Autoleasing",
     "domain": "autoleasing.fi"
    }
   ],
   "sourceCount": 36
  },
  {
   "id": "r2",
   "title": "Buying a new or used electric car in Finland in 2025-2026: list prices of popular EVs, dealer discounts, car loan / osamaksu interest rates and balloo",
   "status": "done",
   "round": 1,
   "steps": [
    {
     "type": "search",
     "label": "sähköauton hinta 2026 uusi sähköauto listahinta euroa malli vertailu (and 2 more)",
     "domains": [
      "ok-auto.sivuviidakko.fi",
      "toyota.fi",
      "santanderconsumer.fi"
     ],
     "checked": 30,
     "kept": 18
    },
    {
     "type": "search",
     "label": "käytetty sähköauto hinta 2026 Tori Autotalli myyntiajat (and 2 more)",
     "domains": [
      "auto-suni.fi",
      "luottonavi.fi",
      "aionauto.fi"
     ],
     "checked": 30,
     "kept": 14
    },
    {
     "type": "read",
     "label": "toyota.fi and 2 more",
     "domains": [
      "toyota.fi",
      "evuutiset.fi",
      "santanderconsumer.fi"
     ]
    },
    {
     "type": "search",
     "label": "käytetty sähköauto arvonalennus Suomi 2026 jälleenmyyntiarvo (and 1 more)",
     "domains": [
      "turvalaina.fi",
      "lainoja.org",
      "autosi.biz"
     ],
     "checked": 20,
     "kept": 4
    },
    {
     "type": "read",
     "label": "auto-suni.fi and 2 more",
     "domains": [
      "auto-suni.fi",
      "turvalaina.fi",
      "justsiks.fi"
     ]
    }
   ],
   "findings": "**Bottom line for this angle:** new EVs in Finland are being financed cheaply through manufacturer deals, but the cheapest-looking monthly payments come with large balloons and mileage caps. Your 15,000 km/yr means about 45,000–60,000 km over 3–4 years, so check the cap before signing.\n\n**Prices and offers (Nov 2026)**\n- Evuutiset lists 171 EV models in Finland, from €24,590 (BYD Dolphin Surf) up.",
   "sources": [
    {
     "url": "https://ok-auto.sivuviidakko.fi/yritys/tarjoukset-ja-kampanjat/toyota-bz4x-limited-edition.html",
     "title": "Toyota bZ4X Limited Edition - O.K. Auto Oy",
     "domain": "ok-auto.sivuviidakko.fi",
     "snippet": "Toyota Easy Osamaksu 302,43 €/kk. Sopimusaika 60 kk. Kilometrit 50 000 km. Käsiraha 20,00 % ( ... 398,00 €). Suurempi viimeinen osamaksuerä / taattu hyvityshint"
    },
    {
     "url": "https://www.toyota.fi/tarjoukset-kampanjat/sahkoautomallisto",
     "title": "Toyotan sähköautomallisto | Toyota Suomi",
     "domain": "toyota.fi"
    },
    {
     "url": "https://www.santanderconsumer.fi/laina/autolaina",
     "title": "Autolaina - Lainaa 2 000–50 000 € netistä",
     "domain": "santanderconsumer.fi"
    },
    {
     "url": "https://polestarsuomi.fi/santander-autorahoitus-op-nordea-vertailu/",
     "title": "Santander vs OP ja Nordea. Automarkkinan rahoitusansa paljastui",
     "domain": "polestarsuomi.fi"
    }
   ],
   "sourceCount": 36
  },
  {
   "id": "r3",
   "title": "Depreciation and residual values of electric cars in Finland: how much used EV prices have fallen 2023-2026, expected value of a 3-4 year old EV, batt",
   "status": "done",
   "round": 1,
   "steps": [
    {
     "type": "search",
     "label": "käytettyjen sähköautojen hinnat laskeneet 2026 Nettiauto (and 2 more)",
     "domains": [
      "is.fi",
      "ecarbrowser.fi",
      "iltalehti.fi"
     ],
     "checked": 27,
     "kept": 21
    },
    {
     "type": "search",
     "label": "used electric car prices Finland depreciation 2025 2026 (and 2 more)",
     "domains": [
      "autotoday.fi",
      "ecarbrowser.fi",
      "autouncle.fi"
     ],
     "checked": 28,
     "kept": 6
    },
    {
     "type": "read",
     "label": "autotoday.fi and 2 more",
     "domains": [
      "autotoday.fi",
      "ecarbrowser.fi",
      "axle.fi"
     ]
    },
    {
     "type": "search",
     "label": "Carvago selvitys sähköautot arvo menettävät kolmessa vuodessa (and 2 more)",
     "domains": [
      "kauppalehti.fi",
      "drweb.de",
      "evuutiset.fi"
     ],
     "checked": 27,
     "kept": 4
    },
    {
     "type": "read",
     "label": "autobild.fi and 1 more",
     "domains": [
      "autobild.fi",
      "autoliitto.fi"
     ]
    }
   ],
   "findings": "**Depreciation and resale of used EVs in Finland (as of Nov 2026)**\n\n**Price falls.** AutoUncle's analysis of 2022 model-year cars at Finnish dealers found an EV median falling from €63,900 (2022) to about €30,900 in H1 2026, a 52% drop. Petrol cars fell 26–47%. Tesla Model Y (−52%) and Model 3 (−51%) led the drop.",
   "sources": [
    {
     "url": "https://www.is.fi/autot/art-2000011905826.html",
     "title": "Tuore selvitys: Sähköautojen arvo sulaa polttomoottoreita nopeammin - Ilta-Sanomat",
     "domain": "is.fi",
     "snippet": "Käytetyt sähköautot menettävät arvoaan huomattavasti polttomoottoriajoneuvoja nopeammin. Näin selviää ainakin autojen verkkokauppaan erikoistuneen Carvagon tuor"
    },
    {
     "url": "https://ecarbrowser.fi/markkinaraportti/2026-07",
     "title": "Käytettyjen sähköautojen markkinat heinäkuu 2026 | eCar Browser",
     "domain": "ecarbrowser.fi"
    },
    {
     "url": "https://www.iltalehti.fi/autouutiset/a/ea2725a7-befe-46a0-adbb-14b2c9f88c76",
     "title": "Käytettyjen sähköautojen arvo kääntyi – Nyt tapahtuu jotain odottamatonta",
     "domain": "iltalehti.fi"
    },
    {
     "url": "https://www.iltalehti.fi/sahkoautot/a/549b96af-1471-420b-bf68-a0c101494ac4",
     "title": "Sähköautojen arvot saattoivat juuri romahtaa Suomessa – Jesse Haapala: \"Me ollaan lirissä\"",
     "domain": "iltalehti.fi"
    }
   ],
   "sourceCount": 29
  },
  {
   "id": "r4",
   "title": "Finnish taxes and incentives for EVs in 2026: car tax (autovero) for electric cars, annual vehicle tax (ajoneuvovero, perusvero and käyttövoimavero) f",
   "status": "done",
   "round": 1,
   "steps": [
    {
     "type": "search",
     "label": "sähköauton autovero 2026 Vero.fi (and 2 more)",
     "domains": [
      "secto.fi",
      "evuutiset.fi",
      "finlex.fi"
     ],
     "checked": 27,
     "kept": 17
    },
    {
     "type": "search",
     "label": "latauspisteiden tuki taloyhtiö 2026 Energiavirasto (and 2 more)",
     "domains": [
      "alv-laskuri-online.fi",
      "lainataivas.fi",
      "kauppalehti.fi"
     ],
     "checked": 30,
     "kept": 17
    },
    {
     "type": "search",
     "label": "vero.fi autovero täyssähköauto vapaa 2026 hiilidioksidi (and 2 more)",
     "domains": [
      "uutiskirje.traficom.fi",
      "ilmastoinfo.hsy.fi",
      "aut.fi"
     ],
     "checked": 30,
     "kept": 17
    },
    {
     "type": "read",
     "label": "caar.fi and 1 more",
     "domains": [
      "caar.fi",
      "mma.fi"
     ]
    },
    {
     "type": "search",
     "label": "Traficom ajoneuvoverolaskuri sähköauto perusvero 2026 käyttövoimavero 1,9 senttiä (and 1 m",
     "domains": [
      "laskureita.fi",
      "laskuriplus.fi",
      "lasketaan.fi"
     ],
     "checked": 14,
     "kept": 11
    },
    {
     "type": "read",
     "label": "veronmaksajat.fi and 1 more",
     "domains": [
      "veronmaksajat.fi",
      "evuutiset.fi"
     ]
    }
   ],
   "findings": "**Finnish tax and incentive position for an EV in 2026 (for a private buyer in Espoo)**\n\n**Taxes that apply.** A new battery EV pays no car tax (autovero). Full EVs first registered from 1.10.2021 onward are exempt, and the Verohallinto treats 0% as the rate for them ([vero.fi](https://www.vero.fi/henkiloasiakkaat/omaisuus/autovero/autoveron-maara/autoveroprosentit-ajoneuvoille/)). Annual vehicle tax has two parts.",
   "sources": [
    {
     "url": "https://secto.fi/sahkoauton-verotus-tyosuhdeautona",
     "title": "Sähköauto verotus työsuhdeautona ja autoetu veroedut | Secto Automotive",
     "domain": "secto.fi",
     "snippet": "Täyssähköautot, jotka on rekisteröity vuoden 2021 jälkeen, on vapautettu autoverosta. Keskimäärin tämä tarkoittaa noin 1500 euron alennusta sähköauton hankintah"
    },
    {
     "url": "https://evuutiset.fi/artikkelit/sahkoauton-autoetu-2026-tyosuhdeauton-verotus",
     "title": "Sähköauton autoetu 2026 - työsuhdeauton verotus - Evuutiset",
     "domain": "evuutiset.fi"
    },
    {
     "url": "https://www.finlex.fi/api/media/government-proposal/690588/mainPdf/main.pdf?timestamp=2024-09-22T21%3A00%3A00.000Z",
     "title": "HE 107/2024 vp",
     "domain": "finlex.fi"
    },
    {
     "url": "https://mma.fi/ajankohtaista/uutiset-ja-tiedotteet/uutinen/vuoden-2026-luontoisetujen-laskentaperusteet/",
     "title": "Vuoden 2026 luontoisetujen laskentaperusteet | MMA",
     "domain": "mma.fi"
    }
   ],
   "sourceCount": 36
  },
  {
   "id": "r5",
   "title": "Running costs of an EV in Espoo at 15,000 km/year in 2025-2026: Finnish spot and fixed electricity prices and transfer fees (Caruna Espoo), home charg",
   "status": "done",
   "round": 1,
   "steps": [
    {
     "type": "search",
     "label": "pörssisähkön hinta marraskuu 2026 keskihinta (and 2 more)",
     "domains": [
      "oikeasahkonhinta.fi",
      "kauppa.tiikman.fi",
      "muuttoopas.fi"
     ],
     "checked": 30,
     "kept": 24
    },
    {
     "type": "search",
     "label": "julkinen pikalataus hinta kWh 2026 Virta Plugit K-Lataus (and 2 more)",
     "domains": [
      "k-auto.fi",
      "evuutiset.fi",
      "helppohinta.fi"
     ],
     "checked": 30,
     "kept": 24
    },
    {
     "type": "search",
     "label": "pörssisähkön keskihinta 2026 snt/kWh vuosikeskiarvo (and 2 more)",
     "domains": [
      "polestarsuomi.fi",
      "rengashalli.fi",
      "go-e.com"
     ],
     "checked": 30,
     "kept": 17
    },
    {
     "type": "read",
     "label": "oikeasahkonhinta.fi and 2 more",
     "domains": [
      "oikeasahkonhinta.fi",
      "vakuutus24.fi",
      "autovakuutukset.com"
     ]
    },
    {
     "type": "read",
     "label": "caruna.fi and 1 more",
     "domains": [
      "caruna.fi",
      "lataa.app"
     ]
    }
   ],
   "findings": "**Bottom line:** At 15,000 km/yr, running costs favour an EV, provided you charge mostly at home. Insurance is the main EV penalty. I found no Espoo-specific fixed-price average, so the electricity figures are estimates.\n\n**Assumptions:** about 18 kWh/100 km, or roughly 2,700 kWh/yr at the wheel and about 2,950 kWh/yr from the wall after charging losses.",
   "sources": [
    {
     "url": "https://oikeasahkonhinta.fi/fi/siirtohinta-caruna-espoo/",
     "title": "Caruna Espoo siirtohinta 2026: pörssisähkö kaikkineen",
     "domain": "oikeasahkonhinta.fi",
     "snippet": "## Hinnasto 1. tammikuuta 2026 alkaen Hinnasto voimassa 1. tammikuuta 2026 alkaen, yhtiön oma hinnasto, sis. alv 25,5 %, €/kk. Kun kerrostalohintaa ei ole, käyt"
    },
    {
     "url": "https://kauppa.tiikman.fi/tuote-osasto/sahkoauton-latausasema/suosituimmat-latauspisteet-taloyhtioon/",
     "title": "Suosituimmat latauspisteet taloyhtiöön - Asennettuna",
     "domain": "kauppa.tiikman.fi"
    },
    {
     "url": "https://muuttoopas.fi/opas/caruna-siirtomaksu/",
     "title": "Carunan siirtomaksu 2026 – hinnat ja tuotteet | Muuttoopas",
     "domain": "muuttoopas.fi"
    },
    {
     "url": "https://www.korpilataus.fi/tietopankki/sahkoauton-latausasema-taloyhtioon-opas-hankintaan",
     "title": "Sähköauton latausasemat taloyhtiöön – Opas hankintaan 2026 | Korpilataus",
     "domain": "korpilataus.fi"
    }
   ],
   "sourceCount": 36
  },
  {
   "id": "r6",
   "title": "Consumer risks and guidance for private leasing in Finland: Kilpailu- ja kuluttajavirasto (KKV) and Kuluttajaliitto advice, typical complaints, end-of",
   "status": "done",
   "round": 1,
   "steps": [
    {
     "type": "search",
     "label": "yksityisleasing sopimus kuluttajaneuvonta riskit ennenaikainen irtisanominen (and 2 more)",
     "domains": [
      "taloustaito.fi",
      "rahankulutus.fi",
      "santanderconsumer.fi"
     ],
     "checked": 27,
     "kept": 7
    },
    {
     "type": "search",
     "label": "sähköauto leasing vai osto laskelma kokonaiskustannukset 2026 (and 2 more)",
     "domains": [
      "santanderconsumer.fi",
      "autot.kaitainen.net"
     ],
     "checked": 30,
     "kept": 2
    },
    {
     "type": "read",
     "label": "santanderconsumer.fi and 2 more",
     "domains": [
      "santanderconsumer.fi",
      "jarvileasing.fi",
      "rahankulutus.fi"
     ]
    },
    {
     "type": "search",
     "label": "Kuluttajaliitto autoleasing kulutus palautus loppulasku valitukset (and 2 more)",
     "domains": [
      "tekniikanmaailma.fi",
      "autoleasing.fi",
      "xydata.fi"
     ],
     "checked": 29,
     "kept": 7
    },
    {
     "type": "read",
     "label": "kuluttajariita.fi and 1 more",
     "domains": [
      "kuluttajariita.fi",
      "tekniikanmaailma.fi"
     ]
    },
    {
     "type": "search",
     "label": "yksityisleasing kannattaako sähköauto leasing osto vertailu kuukausimaksu jäännösarvo Yle ",
     "domains": [
      "lainatesti.fi",
      "is.fi",
      "taloustaito.fi"
     ],
     "checked": 28,
     "kept": 4
    },
    {
     "type": "read",
     "label": "lainatesti.fi and 2 more",
     "domains": [
      "lainatesti.fi",
      "autoexus.com",
      "santanderconsumer.fi"
     ]
    }
   ],
   "findings": "**Consumer risks and guidance for yksityisleasing (Espoo, 15,000 km/yr)**\n\n**Early termination and the penalty clause.** The most important finding is the cost of leaving early. The Consumer Disputes Board (Kuluttajariitalautakunta, KRL) ruled in full session on 28.5.2026 that a 30% penalty was not unreasonable. The case was a 48-month, 70,000 km Mercedes C lease at €987/month, returned in November 2024 and billed €7,877.26.",
   "sources": [
    {
     "url": "https://www.santanderconsumer.fi/ajoneuvorahoitus/yksityisleasing/sopimusehdot",
     "title": "Yksityisleasing sopimusehdot",
     "domain": "santanderconsumer.fi",
     "snippet": "Sopimuksen purkautuessa Santanderilla on oikeus veloittaa myös ylikilometrikorvaus, joka lasketaan vertaamalla ajettua kilometrimäärää Sopimuksen mukaiseen sall"
    },
    {
     "url": "https://autot.kaitainen.net/vinkit/santander-nelipyora-yr-auto/",
     "title": "Santander \"leasing\" Nelipyörästä, palautus YR-Autolle - Autoblogi",
     "domain": "autot.kaitainen.net"
    },
    {
     "url": "https://www.taloustaito.fi/vapaalla/oma-talous-sakkaa---joustaako-yksityisleasing-vaikeuksissa/",
     "title": "Oma talous sakkaa – joustaako yksityisleasing vaikeuksissa? - Taloustaito.fi",
     "domain": "taloustaito.fi"
    },
    {
     "url": "https://rahankulutus.fi/leasingsopimus-ennen-aikojaan-nain-valtat-kalliit-virheet-auton-irtisanomisessa-tai-siirrossa/",
     "title": "Leasingsopimus ennen aikojaan? Näin vältät kalliit virheet auton irtisanomisessa tai siirr",
     "domain": "rahankulutus.fi"
    }
   ],
   "sourceCount": 19
  },
  {
   "id": "r7",
   "title": "Obtain like-for-like private lease quotes at 15,000 km/yr (60,000 km/48 mo and 45,000 km/36 mo) for 2-3 models (e.g.",
   "status": "done",
   "round": 2,
   "why": "Almost all lease quotes found are at 40,000 km, so the core lease-vs-buy TCO comparison cannot be made like-for-like without prices at the actual mileage.",
   "steps": [
    {
     "type": "search",
     "label": "yksityisleasing sähköauto 15000 km vuodessa kuukausihinta (and 2 more)",
     "domains": [
      "gomore.fi",
      "autokauppa.ayvens.com",
      "hedinautomotive.skoda.fi"
     ],
     "checked": 29,
     "kept": 6
    },
    {
     "type": "search",
     "label": "Kia EV3 leasing Suomi kuukausimaksu km vuodessa (and 2 more)",
     "domains": [
      "lehti.kia.fi",
      "astrum.fi",
      "hedinautomotive.fi"
     ],
     "checked": 28,
     "kept": 4
    },
    {
     "type": "search",
     "label": "yksityisleasing 60 000 km 48 kk sähköauto kuukausihinta (and 2 more)",
     "domains": [
      "nelipyora.fi",
      "vauriokorjaamo.autokeskus.fi"
     ],
     "checked": 24,
     "kept": 3
    },
    {
     "type": "read",
     "label": "nelipyora.fi and 1 more",
     "domains": [
      "nelipyora.fi",
      "astrum.fi"
     ]
    },
    {
     "type": "search",
     "label": "Skoda Elroq yksityisleasing km/v 36 kk 48 kk 60 kk taulukko (and 2 more)",
     "domains": [
      "linkedin.com",
      "focus.de"
     ],
     "checked": 27,
     "kept": 2
    }
   ],
   "findings": "**Bottom line: I could not get a like-for-like 15,000 km/yr quote for any of the three models.** Every Finnish quote I found is at 10k, 30k or 40k km, so the lease-vs-buy comparison at your mileage is still open.\n\n**What the quotes show**\n- Nelipyörä's calculator gives the only 15k/yr grid, but it is for a Toyota bZ4X, not a model on your list. It reads 763 €/mo at 36 months and 723 €/mo at 48 months, against 697 and 674 at 10k/yr.",
   "sources": [
    {
     "url": "https://gomore.fi/leasing/tesla",
     "title": "Tesla-autojen yksityisleasing | Sis. huolto ja vakuutus",
     "domain": "gomore.fi",
     "snippet": "Tesla yksityisleasing-tarjouksemme ovat saatavilla edullisella 36 tai 48 kuukauden leasing-ajalla. ## Voimassa olevat Tesla leasing tarjoukset - Sisältää tiepal"
    },
    {
     "url": "http://autokauppa.ayvens.com/fi/autohaku/yksityisleasing/",
     "title": "Ayvens yksityisleasing-autot | Autohaku | Autokauppa Ayvens",
     "domain": "autokauppa.ayvens.com"
    },
    {
     "url": "https://autokauppa.ayvens.com/fi/yksityisleasing/auto/tesla-model-y-rear-wheel-drive/",
     "title": "Tesla Model Y Rear-Wheel Drive Ayvens yksityisleasing-auto | Autokauppa Ayvens",
     "domain": "autokauppa.ayvens.com"
    },
    {
     "url": "https://hedinautomotive.skoda.fi/tarjoukset/taysin-uusi-skoda-elroq-nyt-hedin-drive-sopimuksella-alkaen-459-kk/",
     "title": "Täysin uusi Škoda Elroq nyt Hedin Drive -sopimuksella alkaen 459 €/kk ilman käsirahaa!",
     "domain": "hedinautomotive.skoda.fi"
    }
   ],
   "sourceCount": 15
  },
  {
   "id": "r8",
   "title": "Find current Finnish EV insurance premiums (liikennevakuutus + kasko) for an Espoo driver for a ~40k € EV such as Model Y or Elroq, using If, OP, Lähi",
   "status": "done",
   "round": 2,
   "why": "Insurance is described as the main EV cost penalty, is required in leases, and its figures were truncated and rest on a single source.",
   "steps": [
    {
     "type": "search",
     "label": "sähköauto kasko vakuutus hinta vertailu 2026 Model Y Skoda Elroq (and 2 more)",
     "domains": [
      "evuutiset.fi",
      "verkkouutiset.fi",
      "vakuutus24.fi"
     ],
     "checked": 19,
     "kept": 5
    },
    {
     "type": "search",
     "label": "sähköauton vakuutusmaksu korkeampi kuin polttomoottoriauton 2026 (and 1 more)",
     "domains": [
      "bydsuomi.com",
      "polestarsuomi.fi",
      "keskustelu.suomi24.fi"
     ],
     "checked": 17,
     "kept": 5
    },
    {
     "type": "read",
     "label": "evuutiset.fi and 1 more",
     "domains": [
      "evuutiset.fi",
      "verkkouutiset.fi"
     ]
    }
   ],
   "findings": "**Insurance: Espoo EV premiums (liikenne + kattava kasko), €/yr**\n\n- **Best source, Taloustaito 9/2026 (via [evuutiset.fi](https://evuutiset.fi/artikkelit/sahkoauton-vakuutus-suomessa-2026-kasko-akku-ja-vertailu), published 24.9.2026, and [verkkouutiset.fi](https://www.verkkouutiset.fi/a/autovakuutuksissa-jopa-960-euron-hintaero-taloustaito-tama-on-halvin/), 29.9.2026):** 59-year-old, full bonus, 15,000 km/yr, Helsinki-area, 2023 model year.",
   "sources": [
    {
     "url": "https://evuutiset.fi/artikkelit/sahkoauton-vakuutus-suomessa-2026-kasko-akku-ja-vertailu",
     "title": "Sähköauton vakuutus 2026: hinnat, kasko ja akku - Evuutiset",
     "domain": "evuutiset.fi",
     "snippet": "Liikennevakuutus ja kattava kasko yhteensä €/v, vuosimallin 2023 autot (Taloustaito 24.9.2026) | Auto | If | Pohjola | LähiTapiola | Fennia | | --- | --- | --- "
    },
    {
     "url": "https://www.verkkouutiset.fi/a/autovakuutuksissa-jopa-960-euron-hintaero-taloustaito-tama-on-halvin/",
     "title": "Autovakuutuksissa jopa 960 euron hintaero – Taloustaito: Tämä on halvin - Verkkouutiset",
     "domain": "verkkouutiset.fi"
    },
    {
     "url": "https://vakuutus24.fi/autovakuutuslaskuri/",
     "title": "Autovakuutuslaskuri 2026 – laske liikennevakuutus ja kasko | Vakuutus24",
     "domain": "vakuutus24.fi"
    },
    {
     "url": "https://grivolt.fi/blog/sahkoauton-vakuutus-2026-kasko-vertailu-6-yhtiota-mallit",
     "title": "Sähköauton vakuutus 2026 – 6 yhtiön kasko-vertailu | GRIVOLT",
     "domain": "grivolt.fi"
    }
   ],
   "sourceCount": 10
  },
  {
   "id": "r9",
   "title": "Establish the expected 3-4 year residual value in euros for specific popular models bought new in 2022-2023 (Model Y, ID.4, Enyaq, bZ4X) using Nettiau",
   "status": "done",
   "round": 2,
   "why": "The buy-side TCO depends on resale value. Current evidence is aggregate (about -50% over 4 years) and conflicting, and it has not been tied to the models or balloons being compared.",
   "steps": [
    {
     "type": "search",
     "label": "Tesla Model Y käytetty hinta Nettiauto 2022 2023 vuosimalli keskihinta (and 2 more)",
     "domains": [
      "nettiauto.com",
      "auto1.fi",
      "autotalli.com"
     ],
     "checked": 30,
     "kept": 25
    },
    {
     "type": "search",
     "label": "eCar Browser residual value electric cars 2026 Finland used price depreciation (and 2 more",
     "domains": [
      "autouncle.fi",
      "ecarbrowser.fi"
     ],
     "checked": 27,
     "kept": 2
    },
    {
     "type": "search",
     "label": "eCar Browser Tesla Model Y käytetyt hinnasto vuosimalleittain mediaani (and 2 more)",
     "domains": [
      "autouncle.fi",
      "autot.waa2.fi",
      "ecarbrowser.fi"
     ],
     "checked": 29,
     "kept": 6
    },
    {
     "type": "search",
     "label": "Sähköautomarkkinat numeroina AutoUncle arvonmuutos jäännösarvo 3 vuotta (and 1 more)",
     "domains": [
      "evuutiset.fi",
      "autouncle.fi"
     ],
     "checked": 19,
     "kept": 2
    },
    {
     "type": "read",
     "label": "autouncle.fi and 1 more",
     "domains": [
      "autouncle.fi",
      "kamux.fi"
     ]
    }
   ],
   "findings": "**Resale evidence for 2022–23 EVs (Finland)**\n\n- Aggregate: AutoUncle's August 2026 analysis finds 2022-model EVs down 52% in dealer asking prices, from €63,900 to €30,900 (about €769/month). Model-level drops: Model Y −52%, Model 3 −51%, Enyaq iV −50%. The sample is small, at five EV models, and a wider 19-model check gave −53%.",
   "sources": [
    {
     "url": "https://www.nettiauto.com/tesla/model-y/16097898",
     "title": "Tesla Model Y Long Range ** Premium audio / AMD Ryzen / Lasikatto / Nahkasisusta / Autopil",
     "domain": "nettiauto.com",
     "snippet": "# Tesla Model Y UUSI 24H 35 900 € Long Range ** Premium audio / AMD Ryzen / Lasikatto / Nahkasisusta / Autopilot / ILP ** Päivitetty 10.11.2026 Lappeenranta, Et"
    },
    {
     "url": "https://www.nettiauto.com/tesla/model-y/16098473",
     "title": "Tesla Model Y Long Range ** Vetokoukku / Premium audio / AMD Ryzen / Autopilot / Lasikatto",
     "domain": "nettiauto.com"
    },
    {
     "url": "https://www.nettiauto.com/skoda/enyaq/16085419",
     "title": "Skoda Enyaq 80 Launch Edition iV ** Vetokoukku / Crystal Face / HUD / DCC / Keyless / P.ka",
     "domain": "nettiauto.com"
    },
    {
     "url": "https://www.nettiauto.com/en/toyota/bz4x/16068327",
     "title": "Toyota bZ4X 71,4kWh AWD Premium All-terrain SUV 2023 - Used vehicle - Nettiauto",
     "domain": "nettiauto.com"
    }
   ],
   "sourceCount": 34
  }
 ],
 "report": "# Leasing vs buying an electric car in Espoo at 15,000 km a year (prices as of November 2026)\n\nAt 15,000 km a year, buying is usually cheaper than leasing over four years. The exception is a subsidised campaign lease priced for your real mileage, which comes out roughly even with buying. A cheap campaign lease such as the Škoda Elroq at about 460 €/month costs about the same as buying the same car new with 3% dealer financing, if the car keeps about 45% of its value after four years. Ordinary leases, such as the Toyota bZ4X at 723 €/month, cost clearly more than buying. Leasing wins if EV resale values keep falling or if you would otherwise borrow at bank rates. Buying wins if you use cheap dealer finance, buy nearly-new used, or keep the car longer. Insurance, tax and electricity cost the same either way.\n\n## Lease prices: most quotes assume too few kilometres\n\nNearly every Finnish EV lease is advertised at 40,000 km over 48 months. You need about 60,000 km. Kilometres over the cap cost about 0.15–0.22 €/km, and unused kilometres are not refunded ([finaro.fi](https://finaro.fi/yksityisleasing/)).\n\n| Model | Quoted price | Terms | Notes |\n|---|---|---|---|\n| Kia EV3 Air | 449.89 €/kk, 0 € down | 48 mo / 40,000 km | Includes service, repairs and two tyre sets; kasko required; valid to 31.12.2026 ([autokeskus.fi](https://vauriokorjaamo.autokeskus.fi/tarjoukset/tarjous/kia-ev3-yksityisleasingilla-alk-449-eur-kk/)). Astrum's version lapsed 31.10 ([astrum.fi](https://astrum.fi/kia-ev3-yksityisleasing/)) |\n| Škoda Elroq | from 459 €/kk | 48 mo / 40,000 km | [hedinautomotive.skoda.fi](https://hedinautomotive.skoda.fi/tarjoukset/taysin-uusi-skoda-elroq-nyt-hedin-drive-sopimuksella-alkaen-459-kk/) |\n| VW ID.3 / ID.4 | 519 / 699 €/kk | 48 mo / 40,000 km | Over-km charge 0.17 / 0.22 €/km ([volkswagen.fi](https://www.volkswagen.fi/fi/auton-hankinta/leasing.html)) |\n| Tesla Model Y RWD | 668 €/kk | 48 mo / 10,000 km/yr | [gomore.fi](https://gomore.fi/leasing/electric-hybrid). Ayvens 679 €/kk, mileage not stated ([autokauppa.ayvens.com](https://autokauppa.ayvens.com/fi/autohaku/yksityisleasing/)) |\n| Toyota bZ4X Active | 723 €/kk (36 mo: 763) | 48 mo / **15,000 km/yr** | Only quote found at your mileage ([nelipyora.fi](https://www.nelipyora.fi/nelipyora-yksityisleasing-toyota)) |\n\nOn Nelipyörä's figures, the extra 5,000 km a year adds about 40–50 €/month. At VW's 0.17 €/km, 20,000 km over a 40,000 km cap would cost about 3,400 €, or roughly 70 €/month. No like-for-like 60,000 km quote could be obtained for the Elroq, EV3 or Model Y. That is the biggest gap in this comparison.\n\n## Buying: prices and financing\n\nNew list prices run from €24,590 (BYD Dolphin Surf). Examples include the Elroq 60 at €38,995, the bZ4X at €39,390 and the Model Y RWD at €41,990 ([evuutiset.fi](https://evuutiset.fi/sahkoautot)). Dealers may discount from these.\n\nThe interest rate matters more than the headline monthly payment:\n\n- **Toyota Easy Osamaksu:** 2.99% nominal, 3.92% effective, a €399 setup fee and €15/month. The bZ4X example has a 21,306 € balloon on 49,100 € and a 50,000 km cap ([toyota.fi](https://www.toyota.fi/tarjoukset-kampanjat/sahkoautomallisto)). At your mileage you would exceed that cap within a five-year term.\n- **OP osamaksu:** typically 5–8%. The example given is 5.9% nominal, 7.1% effective ([turvalaina.fi](https://turvalaina.fi/pankit/op/)).\n- **Santander:** Euribor (2.653%) plus 5–9.9 points, variable ([santanderconsumer.fi](https://www.santanderconsumer.fi/laina/autolaina)).\n\n## Depreciation decides the comparison\n\nAutoUncle found 2022 EVs fell 52% to a median of about €30,900 by mid-2026. Model Y fell 52% and Enyaq 50%, against 26–47% for petrol cars. The yearly decline has slowed to about 12% ([autotoday.fi](https://autotoday.fi/hurja-pudotus-sahkoautojen-hinnoissa/); [autouncle.fi](https://www.autouncle.fi/fi/insights/markkina-analyysi/vuoden-2022-sahkoautot-menettaneet-52-prosenttia-hinnastaan-2026-08/)).\n\nCurrent listings show what a three- to four-year-old car fetches:\n\n- 2023 Model Y Long Range, 76,000 km: €35,900 ([nettiauto.com](https://www.nettiauto.com/tesla/model-y/16097898))\n- 2022 Enyaq 80, 65,000 km: €34,900 ([nettiauto.com](https://www.nettiauto.com/skoda/enyaq/16085419))\n- 2022 ID.4, 135,000 km: €24,400 ([nettiauto.com](https://www.nettiauto.com/volkswagen/id-4/16090263))\n\nMarket-wide figures conflict. eCar Browser gives a July median of €41,900 ([eCar Browser](https://ecarbrowser.fi/markkinaraportti/2026-07)), while [Iltalehti](https://www.iltalehti.fi/autouutiset/a/ea2725a7-befe-46a0-adbb-14b2c9f88c76) gives €35,500. Neither is age-matched, so I rely on the AutoUncle cohort data instead.\n\nTwo other points affect resale risk:\n\n- **Battery health is not the main worry.** Saka's tests of 7,000 cars found an average of 91% of original capacity at about 90,000 km, although this is a dealer's own sample ([Auto Bild Suomi](https://autobild.fi/artikkeli/kaytetyn-sahkoauton-akkupelko-on-turhaa--7000-kaytetyn-akun-keskikunto-tutkimuksissa-ylittaa-90--6.182.178257.9d6e6e546f)).\n- **Repair rules are a newer risk.** Unclear July 2026 battery-repair guidance could depress used values, according to [Autoliitto](https://www.autoliitto.fi/uutiset/sahkoautojen-akkujen-korjaaminen-on-mahdollistettava-epaselva-saantely-uhkaa-kaytettyjen-sahkoautojen-arvoa-ja-kauppaa/).\n\n## Four-year comparison for the Elroq (my estimate)\n\nThe lease figure uses an assumed 0.17 €/km over-km rate. The buy figure uses the €38,995 list price, about €3,000 interest and fees at dealer rates with a balloon, and about €1,000 for servicing and tyre changes (servicing about 200–300 € ([polestarsuomi.fi](https://polestarsuomi.fi/polestar-huolto-ja-hinnat/)), seasonal tyre changes 50–80 € ([rengashalli.fi](https://rengashalli.fi/sahkoauton-renkaiden-vaihto/))).\n\n| Scenario | 4-year cost |\n|---|---|\n| Lease: 459 × 48 + 20,000 km over cap | ≈ 25,400 € |\n| Buy, keeps 50% of value | ≈ 23,500 € |\n| Buy, keeps 40% of value | ≈ 27,400 € |\n| Buy at 7.1% bank rate | add roughly 3,000 € |\n\nCaveats on these figures:\n\n- The two options break even at roughly 45% residual value. That is close to what 2022 cars actually retained.\n- The buyer must also buy tyre sets, which the lease includes. I found no price for these.\n- Hedin's exact inclusions were not confirmed.\n- The bZ4X lease (723 × 48 ≈ 34,700 €) loses clearly to buying.\n- Lainatesti's worked example puts the break-even at a 59% residual over 36 months. That page is commercial and uses its author's own assumptions ([lainatesti.fi](https://lainatesti.fi/yleinen/leasingauto-kannattaako-vertailu/)).\n\n## Costs that are the same either way\n\n| Item | Per year | Source |\n|---|---|---|\n| Vehicle tax | ≈ 345 € (base tax 171.18 € + use tax at 1.9 c per 100 kg per day) | [evuutiset.fi](https://evuutiset.fi/artikkelit/sahkoauton-verotus-2026-verot-ja-vahennykset), [Ayvens](https://www.ayvens.com/fi-fi/tietoa-meista/uutiset-ja-artikkelit/uutiset/ajoneuvoverot-2026/) |\n| Home electricity (Caruna Espoo) | ≈ 470–580 € | [caruna.fi](https://caruna.fi/tuotteet-ja-palvelut/kotiin-ja-kiinteistoon/verkkopalveluhinnastot/verkkopalveluhinnasto-caruna-0) |\n| Public charging only (≈ 0.38 €/kWh) | ≈ 1,100 € | [lataa.app](https://lataa.app/operaattorit/plugit/) |\n| Traffic + kasko insurance (EV average) | 908–1,106 €; Model Y LR 1,084–1,543 € | [evuutiset.fi](https://evuutiset.fi/artikkelit/sahkoauton-vakuutus-suomessa-2026-kasko-akku-ja-vertailu) |\n\n- **Insurance sources disagree.** I trust Taloustaito's comparison of actual insurers over the 1,600–2,400 € that [bydsuomi.com](https://bydsuomi.com/byd-vs-tesla-suomessa/) quotes without comparing insurers. Leases usually require kasko.\n- **There is no purchase subsidy and no car tax on EVs.** The 2,500 € scrappage premium applies to buyers who scrap a car from 2015 or earlier ([Traficom](https://uutiskirje.traficom.fi/liikenne/romutuspalkkioita-voi-hakea-1.1.2026-alkaen.html)). Whether a lease qualifies is unconfirmed.\n- **Housing company charging grants:** a 2026 source says the ARA charging grant ended in 2023 ([selectra.fi](https://selectra.fi/uusiutuva-energia/sahkoauton-lataus/taloyhtiossa)). Older pages still describe it, so check before planning around it.\n- **Home charger installation** in a housing company can cost 1,500–4,000 € ([grivolt.fi](https://grivolt.fi/blog/sahkoauton-lataus-taloyhtiossa-2026-laki-vuokralainen)).\n\n## Contract risks\n\n- **Early termination is expensive.** The Consumer Disputes Board accepted a 30% penalty on the remaining rents (minimum three months), which produced a bill of €7,877 ([kuluttajariita.fi](https://www.kuluttajariita.fi/paatokset/auton-vuokrasopimuksen-sopimussakkoa-koskevan-ehdon-kohtuullisuus/)). If your job, family or location might change within four years, leasing carries this risk and buying does not.\n- **Return condition is charged.** Wear beyond normal use is billed when you hand the car back.\n- **Leases count as credit.** A lease is recorded in the credit register like a loan.\n- **Buying carries the resale risk instead.** If values fall further, you absorb the loss.\n\n## What the answer depends on\n\n- **Established:** taxes, energy and insurance costs, and that leases quoted at 40,000 km understate what you would pay.\n- **Likely:** a campaign lease is roughly cost-neutral against buying with dealer finance, and a used three-year-old EV is the cheapest route. That second point assumes you accept battery and repair-rule risk.\n- **Uncertain:** real 60,000 km lease prices and future residual values.\n- **Depends on you:** home charging access, how likely you are to need to exit early, and whether you would borrow at bank rates or use dealer finance.\n\n## Next steps\n\n1. Ask Hedin (Elroq) and Autokeskus (EV3) for written quotes at 60,000 km over 48 months. Confirm what is included and the over-km rate.\n2. For the same cars, get dealer financing quotes with a 60,000 km balloon cap. Avoid financing at 7% or more.\n3. Compare those quotes against nearly-new used cars with 20–40k km and a battery-health report.\n4. Get an If or LähiTapiola quote for your exact model and age in Espoo.\n5. Confirm with your housing company the charger cost and monthly fee before choosing either option.",
 "sources": [
  {
   "url": "https://vauriokorjaamo.autokeskus.fi/tarjoukset/tarjous/kia-ev3-yksityisleasingilla-alk-449-eur-kk/",
   "title": "Kia EV3 yksityisleasingillä alk. 449 €/kk | Autokeskus",
   "domain": "vauriokorjaamo.autokeskus.fi",
   "snippet": "Kia yksityisleasing on helppo, vaivaton ja riskitön tapa hankkia uusi auto. Maksat vain auton käytöstä - määräaikaishuollot, korjaukset ja talvirenkaat sisältyv"
  },
  {
   "url": "https://ok-auto.sivuviidakko.fi/yritys/tarjoukset-ja-kampanjat/toyota-bz4x-limited-edition.html",
   "title": "Toyota bZ4X Limited Edition - O.K. Auto Oy",
   "domain": "ok-auto.sivuviidakko.fi",
   "snippet": "Toyota Easy Osamaksu 302,43 €/kk. Sopimusaika 60 kk. Kilometrit 50 000 km. Käsiraha 20,00 % ( ... 398,00 €). Suurempi viimeinen osamaksuerä / taattu hyvityshint"
  },
  {
   "url": "https://www.is.fi/autot/art-2000011905826.html",
   "title": "Tuore selvitys: Sähköautojen arvo sulaa polttomoottoreita nopeammin - Ilta-Sanomat",
   "domain": "is.fi",
   "snippet": "Käytetyt sähköautot menettävät arvoaan huomattavasti polttomoottoriajoneuvoja nopeammin. Näin selviää ainakin autojen verkkokauppaan erikoistuneen Carvagon tuor"
  },
  {
   "url": "https://secto.fi/sahkoauton-verotus-tyosuhdeautona",
   "title": "Sähköauto verotus työsuhdeautona ja autoetu veroedut | Secto Automotive",
   "domain": "secto.fi",
   "snippet": "Täyssähköautot, jotka on rekisteröity vuoden 2021 jälkeen, on vapautettu autoverosta. Keskimäärin tämä tarkoittaa noin 1500 euron alennusta sähköauton hankintah"
  },
  {
   "url": "https://oikeasahkonhinta.fi/fi/siirtohinta-caruna-espoo/",
   "title": "Caruna Espoo siirtohinta 2026: pörssisähkö kaikkineen",
   "domain": "oikeasahkonhinta.fi",
   "snippet": "## Hinnasto 1. tammikuuta 2026 alkaen Hinnasto voimassa 1. tammikuuta 2026 alkaen, yhtiön oma hinnasto, sis. alv 25,5 %, €/kk. Kun kerrostalohintaa ei ole, käyt"
  },
  {
   "url": "https://www.santanderconsumer.fi/ajoneuvorahoitus/yksityisleasing/sopimusehdot",
   "title": "Yksityisleasing sopimusehdot",
   "domain": "santanderconsumer.fi",
   "snippet": "Sopimuksen purkautuessa Santanderilla on oikeus veloittaa myös ylikilometrikorvaus, joka lasketaan vertaamalla ajettua kilometrimäärää Sopimuksen mukaiseen sall"
  },
  {
   "url": "https://gomore.fi/leasing/tesla",
   "title": "Tesla-autojen yksityisleasing | Sis. huolto ja vakuutus",
   "domain": "gomore.fi"
  },
  {
   "url": "https://evuutiset.fi/artikkelit/sahkoauton-vakuutus-suomessa-2026-kasko-akku-ja-vertailu",
   "title": "Sähköauton vakuutus 2026: hinnat, kasko ja akku - Evuutiset",
   "domain": "evuutiset.fi"
  },
  {
   "url": "https://www.nettiauto.com/tesla/model-y/16097898",
   "title": "Tesla Model Y Long Range ** Premium audio / AMD Ryzen / Lasikatto / Nahkasisusta / Autopil",
   "domain": "nettiauto.com"
  },
  {
   "url": "https://gomore.fi/leasing/electric-hybrid",
   "title": "Sähkö- ja hybridiautojen yksityisleasing - Sis. huolto ja vakuutus",
   "domain": "gomore.fi"
  },
  {
   "url": "https://www.toyota.fi/tarjoukset-kampanjat/sahkoautomallisto",
   "title": "Toyotan sähköautomallisto | Toyota Suomi",
   "domain": "toyota.fi"
  },
  {
   "url": "https://ecarbrowser.fi/markkinaraportti/2026-07",
   "title": "Käytettyjen sähköautojen markkinat heinäkuu 2026 | eCar Browser",
   "domain": "ecarbrowser.fi"
  },
  {
   "url": "https://evuutiset.fi/artikkelit/sahkoauton-autoetu-2026-tyosuhdeauton-verotus",
   "title": "Sähköauton autoetu 2026 - työsuhdeauton verotus - Evuutiset",
   "domain": "evuutiset.fi"
  },
  {
   "url": "https://kauppa.tiikman.fi/tuote-osasto/sahkoauton-latausasema/suosituimmat-latauspisteet-taloyhtioon/",
   "title": "Suosituimmat latauspisteet taloyhtiöön - Asennettuna",
   "domain": "kauppa.tiikman.fi"
  },
  {
   "url": "https://autot.kaitainen.net/vinkit/santander-nelipyora-yr-auto/",
   "title": "Santander \"leasing\" Nelipyörästä, palautus YR-Autolle - Autoblogi",
   "domain": "autot.kaitainen.net"
  },
  {
   "url": "http://autokauppa.ayvens.com/fi/autohaku/yksityisleasing/",
   "title": "Ayvens yksityisleasing-autot | Autohaku | Autokauppa Ayvens",
   "domain": "autokauppa.ayvens.com"
  },
  {
   "url": "https://www.verkkouutiset.fi/a/autovakuutuksissa-jopa-960-euron-hintaero-taloustaito-tama-on-halvin/",
   "title": "Autovakuutuksissa jopa 960 euron hintaero – Taloustaito: Tämä on halvin - Verkkouutiset",
   "domain": "verkkouutiset.fi"
  },
  {
   "url": "https://www.nettiauto.com/tesla/model-y/16098473",
   "title": "Tesla Model Y Long Range ** Vetokoukku / Premium audio / AMD Ryzen / Autopilot / Lasikatto",
   "domain": "nettiauto.com"
  },
  {
   "url": "https://www.santanderconsumer.fi/laina/autolaina",
   "title": "Autolaina - Lainaa 2 000–50 000 € netistä",
   "domain": "santanderconsumer.fi"
  },
  {
   "url": "https://www.iltalehti.fi/autouutiset/a/ea2725a7-befe-46a0-adbb-14b2c9f88c76",
   "title": "Käytettyjen sähköautojen arvo kääntyi – Nyt tapahtuu jotain odottamatonta",
   "domain": "iltalehti.fi"
  },
  {
   "url": "https://www.finlex.fi/api/media/government-proposal/690588/mainPdf/main.pdf?timestamp=2024-09-22T21%3A00%3A00.000Z",
   "title": "HE 107/2024 vp",
   "domain": "finlex.fi"
  },
  {
   "url": "https://muuttoopas.fi/opas/caruna-siirtomaksu/",
   "title": "Carunan siirtomaksu 2026 – hinnat ja tuotteet | Muuttoopas",
   "domain": "muuttoopas.fi"
  },
  {
   "url": "https://www.taloustaito.fi/vapaalla/oma-talous-sakkaa---joustaako-yksityisleasing-vaikeuksissa/",
   "title": "Oma talous sakkaa – joustaako yksityisleasing vaikeuksissa? - Taloustaito.fi",
   "domain": "taloustaito.fi"
  },
  {
   "url": "https://autokauppa.ayvens.com/fi/yksityisleasing/auto/tesla-model-y-rear-wheel-drive/",
   "title": "Tesla Model Y Rear-Wheel Drive Ayvens yksityisleasing-auto | Autokauppa Ayvens",
   "domain": "autokauppa.ayvens.com"
  },
  {
   "url": "https://vakuutus24.fi/autovakuutuslaskuri/",
   "title": "Autovakuutuslaskuri 2026 – laske liikennevakuutus ja kasko | Vakuutus24",
   "domain": "vakuutus24.fi"
  },
  {
   "url": "https://www.nettiauto.com/skoda/enyaq/16085419",
   "title": "Skoda Enyaq 80 Launch Edition iV ** Vetokoukku / Crystal Face / HUD / DCC / Keyless / P.ka",
   "domain": "nettiauto.com"
  },
  {
   "url": "https://autoleasing.fi/artikkelit/tesla-model-3/",
   "title": "Tesla Model 3 » Hinta & Tekniset tiedot - Nordea Autoleasing",
   "domain": "autoleasing.fi"
  },
  {
   "url": "https://polestarsuomi.fi/santander-autorahoitus-op-nordea-vertailu/",
   "title": "Santander vs OP ja Nordea. Automarkkinan rahoitusansa paljastui",
   "domain": "polestarsuomi.fi"
  },
  {
   "url": "https://www.iltalehti.fi/sahkoautot/a/549b96af-1471-420b-bf68-a0c101494ac4",
   "title": "Sähköautojen arvot saattoivat juuri romahtaa Suomessa – Jesse Haapala: \"Me ollaan lirissä\"",
   "domain": "iltalehti.fi"
  },
  {
   "url": "https://mma.fi/ajankohtaista/uutiset-ja-tiedotteet/uutinen/vuoden-2026-luontoisetujen-laskentaperusteet/",
   "title": "Vuoden 2026 luontoisetujen laskentaperusteet | MMA",
   "domain": "mma.fi"
  },
  {
   "url": "https://www.korpilataus.fi/tietopankki/sahkoauton-latausasema-taloyhtioon-opas-hankintaan",
   "title": "Sähköauton latausasemat taloyhtiöön – Opas hankintaan 2026 | Korpilataus",
   "domain": "korpilataus.fi"
  },
  {
   "url": "https://rahankulutus.fi/leasingsopimus-ennen-aikojaan-nain-valtat-kalliit-virheet-auton-irtisanomisessa-tai-siirrossa/",
   "title": "Leasingsopimus ennen aikojaan? Näin vältät kalliit virheet auton irtisanomisessa tai siirr",
   "domain": "rahankulutus.fi"
  },
  {
   "url": "https://hedinautomotive.skoda.fi/tarjoukset/taysin-uusi-skoda-elroq-nyt-hedin-drive-sopimuksella-alkaen-459-kk/",
   "title": "Täysin uusi Škoda Elroq nyt Hedin Drive -sopimuksella alkaen 459 €/kk ilman käsirahaa!",
   "domain": "hedinautomotive.skoda.fi"
  },
  {
   "url": "https://grivolt.fi/blog/sahkoauton-vakuutus-2026-kasko-vertailu-6-yhtiota-mallit",
   "title": "Sähköauton vakuutus 2026 – 6 yhtiön kasko-vertailu | GRIVOLT",
   "domain": "grivolt.fi"
  },
  {
   "url": "https://www.nettiauto.com/en/toyota/bz4x/16068327",
   "title": "Toyota bZ4X 71,4kWh AWD Premium All-terrain SUV 2023 - Used vehicle - Nettiauto",
   "domain": "nettiauto.com"
  },
  {
   "url": "https://www.xpeng.com/fi/xpeng-yksityisleasing",
   "title": "XPENG Yksityisleasing",
   "domain": "xpeng.com"
  }
 ]
};

// The same run part of the way through its second round, as the interface is sent it while the team works:
// no findings, a few sources per angle, the counts so far.
const lastId = researchFixture.agents[researchFixture.agents.length - 1].id;
export const researchLoadingFixture: ResearchData = {
  ...researchFixture,
  status: "researching",
  stage: "Following up on 3 open points",
  pagesChecked: 566,
  sourceCount: 208,
  report: undefined,
  sources: [],
  agents: researchFixture.agents.map((a): ResearchAgent =>
    a.round === 2
      ? { ...a, findings: undefined, sources: [], status: a.id === lastId ? "queued" : "working", steps: a.id === lastId ? [] : a.steps.slice(0, 2), sourceCount: a.id === lastId ? 0 : Math.round((a.sourceCount ?? 0) / 3) }
      : { ...a, findings: undefined, sources: a.sources.slice(0, 3).map(({ url, title, domain }) => ({ url, title, domain })) },
  ),
};
