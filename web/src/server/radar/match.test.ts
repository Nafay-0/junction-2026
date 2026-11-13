import { describe, expect, it } from "vitest";
import { buildFacts } from "./facts";
import { decide, deliveryAffected, matchNotice, newDeliveriesAffected, type AssortmentItem } from "./match";
import { findDates, findGtins, parsePack, sameCompany, validGtin } from "./text";
import type { NoticeFacts } from "./types";

const OAT: AssortmentItem = {
  id: "471694",
  names: { en: "10 x Elovena 2,5dl oat drink barista", fi: "10 x Elovena 2,5dl kaurajuoma kahviin", sv: "10 x Elovena 2,5dl havredryck i kaffe" },
  brand: "Elovena",
  vendor: "RAVINTORAISIO OY VIILEÄ",
  pack: parsePack("2,5dl"),
  gtins: ["6411200000082", "6411200000099"],
};
const OAT_BIG: AssortmentItem = { id: "471695", names: { fi: "Elovena kaurajuoma kahviin 1 l", en: "Elovena oat drink barista 1 l" }, brand: "Elovena", vendor: "RAVINTORAISIO OY", pack: parsePack("1 l"), gtins: ["6411200000105"] };
const OAT_PLAIN: AssortmentItem = { id: "471700", names: { fi: "Elovena kaurajuoma 1 l", en: "Elovena oat drink 1 l" }, brand: "Elovena", vendor: "RAVINTORAISIO OY", pack: parsePack("1 l"), gtins: ["6411200000112"] };
const OTHER_BRAND: AssortmentItem = { id: "480001", names: { fi: "Oatly kaurajuoma kahviin 2,5 dl", en: "Oatly oat drink barista 2,5 dl" }, brand: "Oatly", vendor: "OATLY AB", pack: parsePack("2,5 dl"), gtins: ["7394376616228"] };
const MILK: AssortmentItem = { id: "400100", names: { fi: "Valio laktoositon kevytmaitojuoma 10 l", en: "Valio lactose-free semi-skimmed milk drink 10 l" }, brand: "Valio", vendor: "VALIO OY", pack: parsePack("10 l"), gtins: ["6408430000017"] };
const ASSORTMENT = [OAT, OAT_BIG, OAT_PLAIN, OTHER_BRAND, MILK];

function facts(text: string, title = "Takaisinveto", publishedOn = "2026-04-02"): NoticeFacts {
  return buildFacts({ text, title, publishedOn, seenOn: "2026-11-14" });
}

const OAT_NOTICE = [
  "Raisio ilmoittaa vetävänsä myynnistä yhden erän tuotetta Elovena® kaurajuoma kahviin, 2,5 dl.",
  "Takaisinveto koskee erää, jonka parasta ennen -merkintä on 5.10.2026 (EAN-koodi 6411200000082).",
  "Osassa erän tuotteista säilyvyys ei vastaa vaatimuksia.",
].join(" ");

describe("text tools", () => {
  it("checks GS1 check digits and finds codes in text", () => {
    expect(validGtin("6411200000082")).toBe(true);
    expect(validGtin("6411200000083")).toBe(false);
    expect(findGtins("EAN: 6416345084065, puh. 06 723 2818")).toEqual(["6416345084065"]);
  });
  it("reads Finnish dates with and without a year", () => {
    expect(findDates("parasta ennen 28.10. tai aiempi", "2026-10-09")).toEqual(["2026-10-28"]);
    expect(findDates("parasta ennen 5.8.2027 ja 18.7.2027", "2026-06-26")).toEqual(["2027-07-18", "2027-08-05"]);
  });
  it("reads pack sizes the way names write them", () => {
    expect(parsePack("10 x Elovena 2,5dl kaurajuoma")).toMatchObject({ amount: 0.25, unit: "L", count: 10 });
    expect(parsePack("Görans 3x1 kg")).toMatchObject({ amount: 1, unit: "kg", count: 3 });
    expect(parsePack("Barebells 12x55g")).toMatchObject({ amount: 0.055, unit: "kg", count: 12 });
  });
  it("compares companies without legal forms and trade qualifiers", () => {
    expect(sameCompany("Raisio Oyj", "RAVINTORAISIO OY VIILEÄ")).toBe(true);
    expect(sameCompany("Munax Oy", "VALIO OY")).toBe(false);
  });
});

describe("matching a notice to the assortment", () => {
  it("exact: an EAN on the notice is one of the product's GTINs", () => {
    const m = matchNotice(facts(OAT_NOTICE), ASSORTMENT);
    const hit = m.find((x) => x.productId === OAT.id)!;
    expect(hit).toMatchObject({ strength: "confirmed", basis: "gtin" });
    expect(hit.lots.bestBefore).toEqual(["2026-10-05"]);
  });

  it("exact without an EAN: producer, exact name and pack size agree", () => {
    const f = facts("Tuote: Elovena kaurajuoma kahviin\nValmistaja: Raisio Oyj\nPakkauskoko: 2,5 dl\nTuotteessa on säilyvyysongelma.");
    const m = matchNotice(f, ASSORTMENT);
    expect(m.find((x) => x.productId === OAT.id)).toMatchObject({ strength: "confirmed", basis: "producer_name_pack" });
  });

  it("wrong pack: same name and brand in another pack size is only possible", () => {
    const f = facts("Tuote: Elovena kaurajuoma kahviin\nValmistaja: Raisio Oyj\nPakkauskoko: 1 l\nTuotteessa on säilyvyysongelma.");
    const m = matchNotice(f, ASSORTMENT);
    expect(m.find((x) => x.productId === OAT_BIG.id)).toMatchObject({ strength: "confirmed" });
    const small = m.find((x) => x.productId === OAT.id)!;
    expect(small.strength).toBe("possible");
    expect(small.why).toMatch(/pack is 1 l, ours 2,5 dl/);
  });

  it("possible: same brand and a similar product, never a hold by itself", () => {
    const f = facts("Tuote: Elovena kaurajuoma luomu\nValmistaja: Raisio Oyj\nPakkauskoko: 1 l\nTuotteessa on säilyvyysongelma.");
    const m = matchNotice(f, ASSORTMENT);
    const p = m.find((x) => x.productId === OAT_PLAIN.id)!;
    expect(p.strength).toBe("possible");
    expect(decide(p, { today: "2026-11-14", noticeAgeDays: 1 })).toMatchObject({ status: "review", hold: false });
  });

  it("look-alike names: another brand with the same words is not a match", () => {
    const f = facts("Tuote: Elovena kaurajuoma kahviin\nValmistaja: Raisio Oyj\nPakkauskoko: 2,5 dl\nTuotteessa on säilyvyysongelma.");
    expect(matchNotice(f, ASSORTMENT).some((x) => x.productId === OTHER_BRAND.id)).toBe(false);
  });

  it("no match: a notice about something the wholesaler does not sell", () => {
    const f = facts("Munax Oy ilmoittaa, että kanalassa on todettu salmonellaa. Pirkka Ulko M8 464g EAN: 6410405224316. Parasta ennen 28.10. tai aiempi.", "Kananmunien takaisinveto", "2026-10-09");
    expect(matchNotice(f, ASSORTMENT)).toEqual([]);
  });

  it("an unverified name never confirms: the model's sentence must be on the page", () => {
    const f = buildFacts({
      text: "Tuotteessa on säilyvyysongelma. Valmistaja: Raisio Oyj.",
      title: "x",
      publishedOn: "2026-11-13",
      seenOn: "2026-11-14",
      model: { products: [{ name: "Elovena kaurajuoma kahviin 2,5 dl", sentence: "Takaisinveto koskee tuotetta Elovena kaurajuoma kahviin 2,5 dl.", eans: ["6411200000082"] }], hazard: {} },
    });
    expect(f.products[0].name.verified).toBe(false);
    expect(f.products[0].eans).toEqual([]); // the model's EAN is not in the page text: dropped
    const m = matchNotice(f, ASSORTMENT);
    expect(m.every((x) => x.strength === "possible")).toBe(true);
  });
});

describe("lots: which deliveries a notice can concern", () => {
  const eggs = facts("Takaisinveto koskee vain kananmunia, joiden parasta ennen -päiväys on 28.10. tai aiempi.", "Kananmunien takaisinveto", "2026-10-09");

  it("reads 'or earlier' as every date up to it", () => {
    expect(eggs.lots.bestBeforeUpTo).toBe("2026-10-28");
  });

  it("wrong batch: a delivery after every affected best-before date cannot hold an affected pack", () => {
    expect(deliveryAffected(eggs.lots, "2026-11-02")).toBe(false);
    expect(deliveryAffected(eggs.lots, "2026-10-20")).toBe(true);
  });

  it("a confirmed match whose dates have all passed holds nothing", () => {
    expect(newDeliveriesAffected(eggs.lots, "2026-11-14")).toBe(false);
    expect(decide({ strength: "confirmed", lots: eggs.lots }, { today: "2026-11-14", noticeAgeDays: 36 })).toMatchObject({ status: "confirmed", hold: false });
  });

  it("batch codes alone cannot be ruled out by date: held", () => {
    const f = facts("Takaisinveto koskee eränumeroa L24311 ja L24312.", "Takaisinveto", "2026-11-13");
    expect(f.lots.batches).toEqual(["L24311", "L24312"]);
    expect(decide({ strength: "confirmed", lots: f.lots }, { today: "2026-11-14", noticeAgeDays: 1 })).toMatchObject({ status: "confirmed", hold: true });
  });

  it("a confirmed match on an older notice goes to a person", () => {
    const f = facts("Parasta ennen 5.8.2027.", "Takaisinveto", "2026-06-26");
    expect(decide({ strength: "confirmed", lots: f.lots }, { today: "2026-11-14", noticeAgeDays: 141 })).toMatchObject({ status: "review", hold: false });
  });
});
