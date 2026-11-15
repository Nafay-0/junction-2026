import { defineText } from "../../_i18n/lang";

/**
 * The quiet marks beside what the thread will buy (thread-marks.tsx): a product's delivery record, said as history
 * (server/reliability: "has arrived as ordered about 7 times in 10", never a forecast), and the carbon estimate, always
 * with "≈" because it is the product group's average per kilo, not a measurement.
 */
export const THREAD_MARKS_TEXT = defineText({
  en: {
    record: (n: number, of: number) => `about ${n} in ${of} arrived as ordered`,
    poor: "poor record",
    recordTitle: (n: number, of: number) => `Delivery record: about ${n} in ${of} past deliveries arrived as ordered`,
    co2: (v: string) => `≈ ${v} kg CO₂e`,
    co2Short: (v: string) => `≈${v} kg`,
    co2Title: (v: string) => `≈ ${v} kg CO₂e, from the product group's average per kilo`,
    allGood: (n: number) => (n === 1 ? "Good delivery record" : `All ${n} have a good delivery record`),
    somePoor: (p: number, n: number) => (n === 1 ? "Poor delivery record" : `${p} of ${n} ${p === 1 ? "has" : "have"} a poor delivery record`),
    someUnknown: (k: number, n: number) => `${k} of ${n} ${k === 1 ? "has" : "have"} a good delivery record, ${n - k} no record`,
    co2Of: (v: string, k: number, n: number) => `≈ ${v} kg CO₂e for ${k} of ${n}`,
    dish: (v: string, per?: string) => `≈ ${v} kg CO₂e for the dish${per ? `, ≈ ${per} kg a portion` : ""}`,
    menu: (v: string, per?: string) => `≈ ${v} kg CO₂e for the menu${per ? `, ≈ ${per} kg a portion` : ""}`,
    dishPoor: (n: number, of: number) => `about ${n} in ${of} arrived as ordered`,
    under: (v: string) => `under ${v}`,
  },
  fi: {
    record: (n: number, of: number) => `noin ${n}/${of} toimitettu tilatusti`,
    poor: "heikko historia",
    recordTitle: (n: number, of: number) => `Toimitushistoria: noin ${n} toimitusta ${of}:stä tuli tilatusti`,
    co2: (v: string) => `≈ ${v} kg CO₂e`,
    co2Short: (v: string) => `≈${v} kg`,
    co2Title: (v: string) => `≈ ${v} kg CO₂e, tuoteryhmän keskiarvosta kiloa kohden`,
    allGood: (n: number) => (n === 1 ? "Hyvä toimitushistoria" : `Kaikilla ${n} hyvä toimitushistoria`),
    somePoor: (p: number, n: number) => (n === 1 ? "Heikko toimitushistoria" : `${p}/${n}: heikko toimitushistoria`),
    someUnknown: (k: number, n: number) => `${k}/${n}: hyvä toimitushistoria, ${n - k}: ei tietoa`,
    co2Of: (v: string, k: number, n: number) => `≈ ${v} kg CO₂e (${k}/${n} tuotteesta)`,
    dish: (v: string, per?: string) => `≈ ${v} kg CO₂e ruoalle${per ? `, ≈ ${per} kg annokselta` : ""}`,
    menu: (v: string, per?: string) => `≈ ${v} kg CO₂e menulle${per ? `, ≈ ${per} kg annokselta` : ""}`,
    dishPoor: (n: number, of: number) => `toimitettu tilatusti noin ${n}/${of}`,
    under: (v: string) => `alle ${v}`,
  },
  sv: {
    record: (n: number, of: number) => `cirka ${n} av ${of} levererade som beställt`,
    poor: "svag historik",
    recordTitle: (n: number, of: number) => `Leveranshistorik: cirka ${n} av ${of} leveranser kom som beställt`,
    co2: (v: string) => `≈ ${v} kg CO₂e`,
    co2Short: (v: string) => `≈${v} kg`,
    co2Title: (v: string) => `≈ ${v} kg CO₂e, från produktgruppens medelvärde per kilo`,
    allGood: (n: number) => (n === 1 ? "Bra leveranshistorik" : `Alla ${n} har bra leveranshistorik`),
    somePoor: (p: number, n: number) => (n === 1 ? "Svag leveranshistorik" : `${p} av ${n} har svag leveranshistorik`),
    someUnknown: (k: number, n: number) => `${k} av ${n} har bra leveranshistorik, ${n - k} saknar uppgift`,
    co2Of: (v: string, k: number, n: number) => `≈ ${v} kg CO₂e för ${k} av ${n}`,
    dish: (v: string, per?: string) => `≈ ${v} kg CO₂e för rätten${per ? `, ≈ ${per} kg per portion` : ""}`,
    menu: (v: string, per?: string) => `≈ ${v} kg CO₂e för menyn${per ? `, ≈ ${per} kg per portion` : ""}`,
    dishPoor: (n: number, of: number) => `cirka ${n} av ${of} levererade som beställt`,
    under: (v: string) => `under ${v}`,
  },
});
