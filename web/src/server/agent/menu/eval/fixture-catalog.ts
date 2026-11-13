// A small invented catalogue for the menu planner's tests: the pack formats, allergen gaps and cut-offs the real
// one has, with made-up names and figures. Not partner data.
import { InMemoryOutbox } from "@/core/approval";
import { MeteredCatalog } from "@/core/catalog";
import { buildCatalogIndex } from "@/core/catalog/partner";
import { rawProduct, type FixtureSpec } from "@/core/catalog/test-data";
import { generateEd25519KeyPair } from "@/core/keys";
import { Ledger } from "@/core/ledger";
import { createTrustRegistry } from "@/core/mandate";
import { InMemoryDockRepository, createDock } from "@/core/orders";
import { KITCHEN_ORG, demoKitchenKeyPair } from "../../../demo-kitchen";
import { DEMO_ORG, demoOrgKeyPair } from "../../../dev-fixtures";
import { fakeValioApi, type FakeScenario } from "../../../valio/fake-api";
import { ValioLiveClient } from "../../../valio/live-client";
import { ValioCatalog } from "../../../valio/valio-catalog";

const COOL = ["coolTemperature"];
const AMB = ["warmTemperature"];
const FROZEN = ["freezeTemperature"];
const kg = (n: number) => ({ netWeight: { value: n, unit: "KGM" } });
const l = (n: number) => ({ volume: { value: n, unit: "LTR" } });

export const MENU_FIXTURES: FixtureSpec[] = [
  { id: "800001", names: { fi: "LOHIFILEE TUORE 1KG", en: "SALMON FILLET FRESH 1KG" }, salesUnit: "KG", baseUnit: "KG", units: [["KG", 1]], category: "18701", allergens: [["AF", "CONTAINS"]], labels: COOL },
  { id: "800002", names: { fi: "Merisaalis lohifilee kuutio 1 kg", en: "Merisaalis salmon fillet cube 1 kg" }, salesUnit: "KG", baseUnit: "KG", units: [["KG", 1]], category: "18701", allergens: [["AF", "CONTAINS"]], labels: COOL },
  { id: "800003", names: { fi: "Merisaalis lohifilee pakaste 1 kg", en: "Merisaalis salmon fillet frozen 1 kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "41720", allergens: [["AF", "CONTAINS"]], labels: FROZEN, each: kg(1) },
  { id: "800004", names: { fi: "PERUNA PESTY 2KG", en: "POTATO WASHED 2KG" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "17421", labels: COOL, each: kg(2) },
  { id: "800005", names: { fi: "Juuri peruna kuorittu 5kg", en: "Juuri potato peeled 5kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "17422", allergens: [["AM", "UNDECLARED"]], freeFrom: ["AN", "AP"], labels: COOL, each: kg(5) },
  { id: "800006", names: { fi: "PORKKANA PESTY 1KG", en: "CARROT WASHED 1KG" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "17431", labels: COOL, each: kg(1) },
  { id: "800007", names: { fi: "Juuri porkkana viipale 1kg", en: "Juuri carrot slice 1kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "17444", freeFrom: ["AN", "AP"], labels: COOL, each: kg(1) },
  { id: "800008", names: { fi: "PURJO 1KG", en: "LEEK 1KG" }, salesUnit: "KG", baseUnit: "KG", units: [["KG", 1]], category: "17405", labels: COOL },
  { id: "800009", names: { fi: "Juuri purjorengas 1kg", en: "Juuri leek ring 1kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "17444", freeFrom: ["AN", "AP"], labels: COOL, each: kg(1) },
  { id: "800010", names: { fi: "Tunturi ruokakerma 15 % 1 l laktoositon", en: "Tunturi cooking cream 15 % 1 l lactose free" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "10401", claims: ["FREE_FROM_LACTOSE"], allergens: [["AM", "CONTAINS"]], labels: COOL, each: l(1) },
  { id: "800011", names: { fi: "Kuusi ruokakerma 15 % 1 l", en: "Kuusi cooking cream 15 % 1 l" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "10401", allergens: [["AM", "CONTAINS"]], labels: COOL, each: l(1) },
  { id: "800012", names: { fi: "Liemi kalaliemi 1 kg", en: "Liemi fish stock 1 kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "21902", allergens: [["AF", "CONTAINS"]], labels: AMB, each: kg(1) },
  { id: "800013", names: { fi: "TILLI 100G PUNTTI", en: "DILL 100G BUNCH" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "17451", labels: COOL, each: kg(0.1) },
  { id: "800014", names: { fi: "Mauste tilli 130g", en: "Mauste dill 130g" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "22630", freeFrom: ["AN", "AP"], labels: AMB, each: kg(0.13) },
  { id: "800015", names: { fi: "Pakkas tilli pakaste 250g", en: "Pakkas dill frozen 250g" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "41733", freeFrom: ["AN", "AP"], labels: FROZEN, each: kg(0.25) },
  { id: "800016", names: { fi: "Leipomo ruisleipä viipaloitu 1kg", en: "Leipomo rye bread sliced 1kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "10900", allergens: [["AW", "CONTAINS"], ["NR", "CONTAINS"], ["AN", "MAY_CONTAIN"]], labels: AMB, each: kg(1) },
  { id: "800017", names: { fi: "Kotileipä ruisleipä viipaloitu 1kg", en: "Kotileipa rye bread sliced 1kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "10900", allergens: [["AW", "CONTAINS"], ["NR", "CONTAINS"]], labels: AMB, each: kg(1) },
  { id: "800018", names: { fi: "Tunturi rahka 5 kg laktoositon", en: "Tunturi quark 5 kg lactose free" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "10430", claims: ["FREE_FROM_LACTOSE"], allergens: [["AM", "CONTAINS"]], labels: COOL, each: kg(5) },
  { id: "800019", names: { fi: "Metsä marjasekoitus pakaste 2,5kg", en: "Metsa mixed berries frozen 2,5kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "41740", freeFrom: ["AN", "AP"], labels: FROZEN, each: kg(2.5) },
  { id: "800020", names: { fi: "Pähkinä maapähkinävoi 1kg", en: "Pahkina peanut butter 1kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "21453", allergens: [["AP", "CONTAINS"]], labels: AMB, each: kg(1) },
  { id: "800021", names: { fi: "Siipi broilerin rintafilee 2,5kg", en: "Siipi chicken breast fillet 2,5kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "18750", freeFrom: ["AN", "AP"], labels: COOL, each: kg(2.5) },
  { id: "800022", names: { fi: "Jyvä riisi 5kg", en: "Jyva rice 5kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "21340", freeFrom: ["AN", "AP"], labels: AMB, each: kg(5) },
  { id: "800023", names: { fi: "SIPULI 10KG", en: "ONION 10KG" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "17405", labels: COOL, each: kg(10) },
];

export const MENU_NOW = new Date("2026-11-13T10:00:00.000Z"); // Friday 12:00 in Helsinki
const ok = (price: number, extra: Partial<FakeScenario> = {}): FakeScenario => ({ price, amount: 500, date: "2026-11-16", closingTime: "2026-11-15T17:00:00", ...extra });

/** Live answers: most products arrive Monday; the fresh salmon's cut-off has passed; the frozen one is a Terminal product. */
export const MENU_SCENARIOS: Record<string, FakeScenario> = {
  "800001": ok(14.9, { unit: "KG", closingTime: "2026-11-12T15:00:00" }),
  "800002": ok(16.4, { unit: "KG", closingTime: "2026-11-12T15:00:00" }),
  "800003": ok(13.2, { unit: "ST", logisticModel: "Terminal" }),
  "800004": ok(1.9, { unit: "ST" }),
  "800005": ok(7.5, { unit: "ST" }),
  "800006": ok(1.2, { unit: "ST" }),
  "800007": ok(2.1, { unit: "ST" }),
  "800008": ok(2.6, { unit: "KG" }),
  "800009": ok(3.4, { unit: "ST" }),
  "800010": ok(2.65, { unit: "ST" }),
  "800011": ok(2.2, { unit: "ST" }),
  "800012": ok(18.0, { unit: "ST" }),
  "800013": ok(1.95, { unit: "ST" }),
  "800014": ok(4.2, { unit: "ST" }),
  "800015": ok(5.1, { unit: "ST" }),
  "800016": ok(3.9, { unit: "ST" }),
  "800017": ok(4.1, { unit: "ST" }),
  "800018": ok(16.0, { unit: "ST" }),
  "800019": ok(9.8, { unit: "ST" }),
  "800020": ok(8.0, { unit: "ST" }),
  "800021": ok(17.5, { unit: "ST" }),
  "800022": ok(6.4, { unit: "ST" }),
  "800023": ok(8.9, { unit: "ST" }),
};

/** A Dock over the fixture catalogue and a fake live API, trusting the two demo kitchens' keys. */
export async function menuTestDock(scenarios: Record<string, FakeScenario> = MENU_SCENARIOS) {
  const index = buildCatalogIndex(MENU_FIXTURES.map(rawProduct), "productId,reliability\n", "productId,carbon\n", MENU_NOW);
  const api = fakeValioApi(scenarios, { timeNow: "2026-11-13T12:00:00" });
  const live = new ValioLiveClient({ baseUrl: "https://valio.test", apiKey: "test-key", fetch: api.fetch, now: () => MENU_NOW, sleep: async () => {} });
  const valio = new ValioCatalog(index, live, { now: () => MENU_NOW });
  const [kaari, laakso] = [await demoKitchenKeyPair(), await demoOrgKeyPair()];
  const outbox = new InMemoryOutbox();
  const dock = createDock({
    catalog: new MeteredCatalog(valio),
    repo: new InMemoryDockRepository(),
    ledger: new Ledger(),
    trustedIssuers: createTrustRegistry([
      { kid: kaari.kid, orgId: KITCHEN_ORG.orgId, publicKey: kaari.publicKey },
      { kid: laakso.kid, orgId: DEMO_ORG.orgId, publicKey: laakso.publicKey },
    ]),
    wholesalerKey: await generateEd25519KeyPair("test-wholesaler"),
    notifier: outbox,
    now: () => MENU_NOW,
  });
  return { dock, valio, api, outbox };
}
