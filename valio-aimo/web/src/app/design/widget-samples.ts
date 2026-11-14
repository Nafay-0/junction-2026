import type { Lang } from "../_i18n/lang";
import type { TodayItem } from "../_ui/agent-home";
import type { Candidate, DayChoice, MenuDish, MenuProposal, PickerRow } from "../_ui/widgets";

/**
 * Made-up data for the widget gallery, in English and Finnish (Swedish shows the English samples: the widgets' own
 * words are translated, the data a page passes in is the page's business). Nothing here is partner data.
 */
const fi = (lang: Lang) => lang === "fi";

export const money = (cents: number) => `${(cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export type SampleProduct = { id: string; name: string; pack: string; art: string; litres: number; cents: number };

export function sampleProducts(lang: Lang): Record<string, SampleProduct> {
  const f = fi(lang);
  return {
    semi1: { id: "semi1", name: f ? "Laktoositon kevytmaitojuoma 1 l" : "Lactose-free semi-skimmed milk drink 1 l", pack: f ? "1 l tölkki" : "1 l carton", art: "tile-milk-1l-blue", litres: 1, cents: 101 },
    uht1: { id: "uht1", name: f ? "Laktoositon kevytmaitojuoma UHT 1 l" : "Lactose-free semi-skimmed milk drink UHT 1 l", pack: f ? "1 l tölkki, UHT" : "1 l carton, UHT", art: "tile-milk-carton", litres: 1, cents: 156 },
    bib10: { id: "bib10", name: f ? "Laktoositon kevytmaitojuoma 10 l hanapakkaus" : "Lactose-free semi-skimmed milk drink 10 l bag-in-box", pack: f ? "10 l hanapakkaus" : "10 l bag-in-box", art: "tile-milk-bib-blue", litres: 10, cents: 990 },
    skim1: { id: "skim1", name: f ? "Laktoositon rasvaton maitojuoma 1 l" : "Lactose-free skimmed milk drink 1 l", pack: f ? "1 l tölkki" : "1 l carton", art: "tile-milk-1l-light", litres: 1, cents: 98 },
    oat1: { id: "oat1", name: f ? "Kaurajuoma barista 1 l" : "Oat drink barista 1 l", pack: f ? "1 l tölkki" : "1 l carton", art: "tile-plant-drink", litres: 1, cents: 189 },
  };
}

export function sampleDays(lang: Lang): DayChoice[] {
  const f = fi(lang);
  return [
    { id: "2026-11-16", weekday: f ? "ma" : "Mon", date: "16.11.", orderBy: f ? "su 17.00" : "Sun 17.00", possible: true },
    { id: "2026-11-17", weekday: f ? "ti" : "Tue", date: "17.11.", orderBy: f ? "ma 15.00" : "Mon 15.00", possible: true },
    { id: "2026-11-18", weekday: f ? "ke" : "Wed", date: "18.11.", orderBy: f ? "ti 15.00" : "Tue 15.00", possible: true },
    { id: "2026-11-15", weekday: f ? "su" : "Sun", date: "15.11.", possible: false, reason: f ? "ei toimituksia" : "no deliveries" },
    { id: "2026-11-14", weekday: f ? "la" : "Sat", date: "14.11.", possible: false, reason: f ? "tilausaika päättyi" : "cut-off passed" },
  ];
}

export function sampleRows(lang: Lang): PickerRow[] {
  const f = fi(lang);
  return [
    { key: "delivery", label: f ? "Toimitus" : "Delivery" },
    { key: "fat", label: f ? "Rasva" : "Fat" },
    { key: "keeps", label: f ? "Säilyvyys" : "Keeps" },
    { key: "diet", label: f ? "Ruokavalio" : "Dietary" },
    { key: "carbon", label: f ? "Hiilijalanjälki" : "Carbon" },
  ];
}

export function sampleCandidates(lang: Lang, litres: number): Candidate[] {
  const f = fi(lang);
  const p = sampleProducts(lang);
  const total = (x: SampleProduct) => money(Math.round((litres / x.litres) * x.cents));
  const per = (x: SampleProduct) => `${(x.cents / x.litres / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2 })} €/l`;
  const mon = f ? "ma 16.11." : "Mon 16.11.";
  const lf = f ? "Laktoositon" : "Lactose-free";
  return [
    {
      id: "semi1", name: p.semi1.name, pack: p.semi1.pack, art: p.semi1.art, price: total(p.semi1), per: per(p.semi1), badge: "current",
      headline: f ? "Halvin, joka ehtii maanantaiksi" : "Cheapest that arrives Monday",
      cells: { delivery: { text: mon, tone: "same" }, fat: { text: "1,5 %", tone: "same" }, keeps: { text: f ? "9 päivää kylmässä" : "9 days chilled", tone: "same" }, diet: { text: lf, tone: "same" }, carbon: { text: "1,1 kg CO2e/kg", tone: "same" } },
    },
    {
      id: "bib10", name: p.bib10.name, pack: p.bib10.pack, art: p.bib10.art, price: total(p.bib10), per: per(p.bib10), badge: "usual",
      headline: f ? "Tavallinen valintasi, mutta tulee päivää myöhemmin" : "Your usual, but arrives a day later",
      cells: { delivery: { text: f ? "ti 17.11." : "Tue 17.11.", tone: "worse" }, fat: { text: "1,5 %", tone: "same" }, keeps: { text: f ? "12 päivää kylmässä" : "12 days chilled", tone: "better" }, diet: { text: lf, tone: "same" }, carbon: { text: "0,9 kg CO2e/kg", tone: "better" } },
    },
    {
      id: "uht1", name: p.uht1.name, pack: p.uht1.pack, art: p.uht1.art, price: total(p.uht1), per: per(p.uht1),
      headline: f ? "UHT: säilyy huoneenlämmössä" : "UHT: keeps without a fridge",
      signOff: f ? "Yli 500 € rajasi: tarvitsee Ainon hyväksynnän" : "Over your 500 € limit: needs Aino's OK",
      cells: { delivery: { text: mon, tone: "same" }, fat: { text: "1,5 %", tone: "same" }, keeps: { text: f ? "4 kk avaamattomana" : "4 months unopened", tone: "better" }, diet: { text: lf, tone: "same" }, carbon: { text: "1,3 kg CO2e/kg", tone: "worse" } },
    },
    {
      id: "skim1", name: p.skim1.name, pack: p.skim1.pack, art: p.skim1.art, price: total(p.skim1), per: per(p.skim1),
      headline: f ? "3 senttiä halvempi litralta, rasvaton" : "3 cents less a litre, skimmed",
      cells: { delivery: { text: mon, tone: "same" }, fat: { text: f ? "0 %, ei tavallinen valintasi" : "0 %, not your usual", tone: "worse" }, keeps: { text: f ? "9 päivää kylmässä" : "9 days chilled", tone: "same" }, diet: { text: lf, tone: "same" }, carbon: { text: "1,0 kg CO2e/kg", tone: "better" } },
    },
  ];
}

export function sampleFilters(lang: Lang): { id: string; label: string }[] {
  const f = fi(lang);
  return [
    { id: "cheapest", label: f ? "Halvin" : "Cheapest" },
    { id: "soonest", label: f ? "Nopeimmin perillä" : "Arrives soonest" },
    { id: "lactose", label: f ? "Laktoositon" : "Lactose-free" },
    { id: "organic", label: f ? "Luomu" : "Organic" },
    { id: "carbon", label: f ? "Pienin hiilijalanjälki" : "Lowest carbon" },
    { id: "finnish", label: f ? "Suomalainen" : "Finnish" },
  ];
}

export function sampleProposals(lang: Lang): MenuProposal[] {
  const f = fi(lang);
  return [
    {
      id: "m1", art: "tile-vegetables", title: f ? "Punajuuri kolmella tavalla" : "Beetroot three ways", around: f ? "punajuuri" : "beetroot",
      dishes: f ? ["Paahdettu punajuuri ja vuohenjuusto", "Punajuuririsotto", "Marjakiisseli ja kauravaahto"] : ["Roast beetroot with goat's cheese", "Beetroot risotto", "Berry kissel with oat foam"],
      respects: f ? ["ei pähkinöitä", "laktoositon"] : ["no nuts", "lactose-free"], perCover: f ? "3,40 € / annos" : "3,40 € per cover",
    },
    {
      id: "m2", art: "tile-fish", title: f ? "Punajuuri ja savukala" : "Beetroot and smoked fish", around: f ? "punajuuri" : "beetroot",
      dishes: f ? ["Punajuurikeitto ja smetana", "Savulohi, punajuuri ja peruna", "Ruisleipä ja voi"] : ["Beetroot soup with sour cream", "Smoked salmon, beetroot and potato", "Rye bread and butter"],
      respects: f ? ["ei pähkinöitä", "laktoositon"] : ["no nuts", "lactose-free"], perCover: f ? "4,85 € / annos" : "4,85 € per cover",
      warning: f ? "Savulohi ehtii vasta keskiviikoksi." : "The smoked salmon only arrives by Wednesday.",
    },
    {
      id: "m3", art: "tile-grain-pasta", title: f ? "Punajuuripasta ja salaatti" : "Beetroot pasta and salad", around: f ? "punajuuri" : "beetroot",
      dishes: f ? ["Punajuuripasta ja fetajuusto", "Vihersalaatti ja sinappikastike"] : ["Beetroot pasta with feta", "Green salad with mustard dressing"],
      respects: f ? ["ei pähkinöitä"] : ["no nuts"], perCover: f ? "2,60 € / annos" : "2,60 € per cover",
    },
  ];
}

export function sampleDishes(lang: Lang, covers: number): MenuDish[] {
  const f = fi(lang);
  const kg = (per: number) => `${((per * covers) / 1000).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} kg`;
  const l = (per: number) => `${((per * covers) / 1000).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} l`;
  return [
    {
      id: "d1", name: f ? "Paahdettu punajuuri ja vuohenjuusto" : "Roast beetroot with goat's cheese", note: f ? "Alkuruoka" : "Starter",
      ingredients: [
        { id: "i1", name: f ? "Punajuuri" : "Beetroot", amount: kg(150), product: { name: f ? "Punajuuri, kuorittu 5 kg" : "Beetroot, peeled 5 kg", packs: `${Math.ceil((150 * covers) / 5000)} × 5 kg`, price: money(Math.ceil((150 * covers) / 5000) * 1190), art: "tile-vegetables" } },
        { id: "i2", name: f ? "Vuohenjuusto" : "Goat's cheese", amount: kg(40), product: { name: f ? "Vuohenjuusto 1 kg" : "Goat's cheese log 1 kg", packs: `${Math.ceil((40 * covers) / 1000)} × 1 kg`, price: money(Math.ceil((40 * covers) / 1000) * 1640), art: "tile-cheese-soft" } },
        { id: "i3", name: f ? "Hasselpähkinärouhe" : "Hazelnut crumb", amount: kg(10), product: { name: f ? "Hasselpähkinärouhe 1 kg" : "Chopped hazelnuts 1 kg", packs: "1 × 1 kg", price: money(1890), art: "tile-sweets" }, conflict: f ? "Sisältää hasselpähkinää; keittiön sääntö on ei pähkinöitä. Vaihda tai poista." : "Contains hazelnut; the kitchen's rule is no nuts. Swap it or drop it." },
      ],
    },
    {
      id: "d2", name: f ? "Punajuuririsotto" : "Beetroot risotto", note: f ? "Pääruoka" : "Main",
      ingredients: [
        { id: "i4", name: f ? "Risottoriisi" : "Risotto rice", amount: kg(90), product: { name: f ? "Risottoriisi arborio 5 kg" : "Arborio risotto rice 5 kg", packs: "1 × 5 kg", price: money(2140), art: "tile-grain-pasta" } },
        { id: "i5", name: f ? "Kasvisliemi" : "Vegetable stock", amount: l(300), have: true, product: { name: f ? "Kasvisliemi 1 l" : "Vegetable stock 1 l", packs: "12 × 1 l", price: money(2280), art: "tile-sauce-stock" } },
        { id: "i6", name: f ? "Laktoositon ranskankerma" : "Lactose-free crème fraîche", amount: kg(30), missing: f ? "Laktoositonta ranskankermaa ei ehdi torstaiksi." : "No lactose-free crème fraîche arrives by Thursday." },
      ],
    },
  ];
}

export function sampleToday(lang: Lang): TodayItem[] {
  const f = fi(lang);
  const noop = () => {};
  return [
    { id: "t1", kind: "signoff", title: f ? "1 000 l maitoa odottaa hyväksyntääsi" : "1 000 L of milk needs your OK", detail: f ? "Yli 500 € rajasi. Toimitus ma 16.11." : "Over your 500 € limit. Delivery Mon 16.11.", figure: "1 010,00 €", primary: { label: f ? "Katso ja hyväksy" : "Look and OK it", onClick: noop } },
    { id: "t2", kind: "cutoff", title: f ? "Maanantain maidon tilausaika päättyy tänään 17.00" : "Order by 17.00 today for Monday's milk", detail: f ? "Tilaat tavallisesti 400 l maanantaiksi." : "You usually order 400 L for Mondays.", figure: "17.00", primary: { label: f ? "Tilaa tavallinen 400 l" : "Order the usual 400 L", onClick: noop }, secondary: { label: f ? "Muuta määrää" : "Change the amount", onClick: noop } },
    { id: "t3", kind: "drift", title: f ? "Kerman kestotilaus on kasvanut" : "The cream standing order has crept up", detail: f ? "10 l → 14 l neljässä viikossa. Uusitaanko 14 litralla?" : "10 L to 14 L in four weeks. Renew at 14 L?", figure: "+40 %", primary: { label: f ? "Kyllä, 14 l" : "Yes, 14 L", onClick: noop }, secondary: { label: f ? "Takaisin 10 litraan" : "Back to 10 L", onClick: noop } },
    { id: "t4", kind: "recall", title: f ? "Takaisinveto koskee ostamaasi tuotetta" : "A recall touches something you bought", detail: f ? "Kaurakeksi 400 g, erä L2311. Sinulla on 2 laatikkoa 6.11. toimituksesta." : "Oat biscuit 400 g, lot L2311. You have 2 cases from the 6.11. delivery.", primary: { label: f ? "Näytä, mitä tehdä" : "See what to do", onClick: noop } },
    { id: "t5", kind: "delivery", title: f ? "Toimitus saapuu tänään 10–12" : "A delivery arrives today 10–12", detail: f ? "3 riviä, 124,80 €. Agentti tilasi sen yksin maanantaina." : "3 lines, 124,80 €. The agent placed it alone on Monday.", figure: f ? "tänään" : "today", secondary: { label: f ? "Näytä rivit" : "See the lines", onClick: noop } },
  ];
}
