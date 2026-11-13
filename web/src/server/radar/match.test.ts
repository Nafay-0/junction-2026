import { describe, expect, it } from "vitest";
import { buildFacts } from "./facts";
import { decide, deliveryAffected, matchNotice, newDeliveriesAffected, type AssortmentItem } from "./match";
import { findDates, findGtins, parsePack, sameCompany, validGtin } from "./text";
import type { NoticeFacts } from "./types";

/** A valid GTIN-13 from twelve digits. */
function gtin(twelve: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  return twelve + ((10 - (sum % 10)) % 10);
}

// An invented assortment (never the partner's product data, which may not be copied into code or tests). The first
// item carries the EAN printed on a public Ruokavirasto notice (2 April 2026), so the real notice text can match it.
const OAT: AssortmentItem = {
  id: "T-OAT-25",
  names: { en: "10 x Kauravakka 2,5dl oat drink barista", fi: "10 x Kauravakka 2,5dl kaurajuoma kahviin", sv: "10 x Kauravakka 2,5dl havredryck i kaffe" },
  brand: "Kauravakka",
  vendor: "KAURAVAKKA OY VIILEÄ",
  pack: parsePack("2,5dl"),
  gtins: ["6411200000082", gtin("641999000001")],
};
const OAT_BIG: AssortmentItem = { id: "T-OAT-1L", names: { fi: "Kauravakka kaurajuoma kahviin 1 l", en: "Kauravakka oat drink barista 1 l" }, brand: "Kauravakka", vendor: "KAURAVAKKA OY", pack: parsePack("1 l"), gtins: [gtin("641999000002")] };
const OAT_PLAIN: AssortmentItem = { id: "T-OAT-PLAIN", names: { fi: "Kauravakka kaurajuoma 1 l", en: "Kauravakka oat drink 1 l" }, brand: "Kauravakka", vendor: "KAURAVAKKA OY", pack: parsePack("1 l"), gtins: [gtin("641999000003")] };
const OTHER_BRAND: AssortmentItem = { id: "T-OTHER", names: { fi: "Kaurasampo kaurajuoma kahviin 2,5 dl", en: "Kaurasampo oat drink barista 2,5 dl" }, brand: "Kaurasampo", vendor: "KAURASAMPO AB", pack: parsePack("2,5 dl"), gtins: [gtin("739999000001")] };
const MILK: AssortmentItem = { id: "T-MILK", names: { fi: "Meijerimaa laktoositon kevytmaitojuoma 10 l", en: "Meijerimaa lactose-free semi-skimmed milk drink 10 l" }, brand: "Meijerimaa", vendor: "MEIJERIMAA OY", pack: parsePack("10 l"), gtins: [gtin("640999000001")] };
const ASSORTMENT = [OAT, OAT_BIG, OAT_PLAIN, OTHER_BRAND, MILK];

function facts(text: string, title = "Takaisinveto", publishedOn = "2026-04-02"): NoticeFacts {
  return buildFacts({ text, title, publishedOn, seenOn: "2026-11-14" });
}

const OAT_NOTICE = [
  "Kauravakka ilmoittaa vetävänsä myynnistä yhden erän tuotetta Kauravakka® kaurajuoma kahviin, 2,5 dl.",
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
    expect(parsePack("10 x Kauravakka 2,5dl kaurajuoma")).toMatchObject({ amount: 0.25, unit: "L", count: 10 });
    expect(parsePack("Kebabila 3x1 kg")).toMatchObject({ amount: 1, unit: "kg", count: 3 });
    expect(parsePack("Patukka 12x55g")).toMatchObject({ amount: 0.055, unit: "kg", count: 12 });
  });
  it("compares companies without legal forms and trade qualifiers", () => {
    expect(sameCompany("Vakka Oyj", "RAVINTOVAKKA OY VIILEÄ")).toBe(true);
    expect(sameCompany("Kanala Oy", "MEIJERIMAA OY")).toBe(false);
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
    const f = facts("Tuote: Kauravakka kaurajuoma kahviin\nValmistaja: Kauravakka Oy\nPakkauskoko: 2,5 dl\nTuotteessa on säilyvyysongelma.");
    const m = matchNotice(f, ASSORTMENT);
    expect(m.find((x) => x.productId === OAT.id)).toMatchObject({ strength: "confirmed", basis: "producer_name_pack" });
  });

  it("wrong pack: same name and brand in another pack size is only possible", () => {
    const f = facts("Tuote: Kauravakka kaurajuoma kahviin\nValmistaja: Kauravakka Oy\nPakkauskoko: 1 l\nTuotteessa on säilyvyysongelma.");
    const m = matchNotice(f, ASSORTMENT);
    expect(m.find((x) => x.productId === OAT_BIG.id)).toMatchObject({ strength: "confirmed" });
    const small = m.find((x) => x.productId === OAT.id)!;
    expect(small.strength).toBe("possible");
    expect(small.why).toMatch(/pack is 1 l, ours 2,5 dl/);
  });

  it("possible: same brand and a similar product, never a hold by itself", () => {
    const f = facts("Tuote: Kauravakka kaurajuoma luomu\nValmistaja: Kauravakka Oy\nPakkauskoko: 1 l\nTuotteessa on säilyvyysongelma.");
    const m = matchNotice(f, ASSORTMENT);
    const p = m.find((x) => x.productId === OAT_PLAIN.id)!;
    expect(p.strength).toBe("possible");
    expect(decide(p, { today: "2026-11-14", noticeAgeDays: 1 })).toMatchObject({ status: "review", hold: false });
  });

  it("look-alike names: another brand with the same words is not a match", () => {
    const f = facts("Tuote: Kauravakka kaurajuoma kahviin\nValmistaja: Kauravakka Oy\nPakkauskoko: 2,5 dl\nTuotteessa on säilyvyysongelma.");
    expect(matchNotice(f, ASSORTMENT).some((x) => x.productId === OTHER_BRAND.id)).toBe(false);
  });

  it("no match: a notice about something the wholesaler does not sell", () => {
    const f = facts("Kanala Oy ilmoittaa, että kanalassa on todettu salmonellaa. Kanamuna Ulko M8 464g EAN: 6410405224316. Parasta ennen 28.10. tai aiempi.", "Kananmunien takaisinveto", "2026-10-09");
    expect(matchNotice(f, ASSORTMENT)).toEqual([]);
  });

  it("an unverified name never confirms: the model's sentence must be on the page", () => {
    const f = buildFacts({
      text: "Tuotteessa on säilyvyysongelma. Valmistaja: Kauravakka Oy.",
      title: "x",
      publishedOn: "2026-11-13",
      seenOn: "2026-11-14",
      model: { products: [{ name: "Kauravakka kaurajuoma kahviin 2,5 dl", sentence: "Takaisinveto koskee tuotetta Kauravakka kaurajuoma kahviin 2,5 dl.", eans: ["6411200000082"] }], hazard: {} },
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
