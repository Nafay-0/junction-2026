import { describe, expect, it } from "vitest";
import { dayStated, mentionsDay, numbersIn } from "./grounding";

/**
 * Days and amounts the buyer states in the forms people use (cases from the second reader's evaluation,
 * web/eval/second-reader/), and the other direction: a day or amount the words do not contain is still not stated.
 * Today is Saturday 14 Nov 2026 (Helsinki).
 */
const TODAY = "2026-11-14";
const stated = (text: string, iso: string) => dayStated(text, iso, TODAY);

describe("a day the words state survives", () => {
  it.each([
    ["Huomiseksi 50 kiloa maustamatonta jogurttia", "2026-11-15"],
    ["5,5 kg voita huomiseksi", "2026-11-15"],
    ["Kaksi tusinaa purkkia kermaa ylihuomiseksi", "2026-11-16"],
    ["Kaksisataa litraa kevytmaitoa ylihuomiseksi", "2026-11-16"],
    ["5,5 kg smör till övermorgon", "2026-11-16"],
    ["Tvåhundra liter lättmjölk till i övermorgon", "2026-11-16"],
    ["50 kg naturell yoghurt till i morgon", "2026-11-15"],
    ["5 kg glutenfri riven mozzarella till den 19:e", "2026-11-19"],
    ["5 kg of grated mozzarella, gluten free, for the 19th", "2026-11-19"],
    ["5 kg gluteenitonta mozzarellaraastetta 19. päiväksi", "2026-11-19"],
    ["Pe 20.11. mennessä 400 l maitoa", "2026-11-20"],
    ["Beställ 2.000 liter laktosfri mjölk till 16/11", "2026-11-16"],
    ["Luomumaitoa 80 litraa ensi tiistaiksi", "2026-11-17"],
    ["Luomumaitoa 80 litraa ensi tiistaiksi", "2026-11-24"],
    ["4.500 litraa maitoa ensi viikon tiistaiksi", "2026-11-24"],
    ["Tarvitsen 1000 litraa laktoositonta maitoa maanantaiksi", "2026-11-16"],
    ["30 laatikkoa kauramaitoa keskiviikoksi", "2026-11-18"],
    ["Vi behöver 1000 liter laktosfri mjölk till måndag", "2026-11-16"],
    ["18 kg of cottage cheese, organic, before Tuesday", "2026-11-16"],
    ["Order 2,000 litres of lactose-free milk for 16.11.", "2026-11-16"],
    ["100 kg yoghurt by 20 November", "2026-11-20"],
    ["100 kg jogurttia 20. marraskuuta", "2026-11-20"],
    ["Milk 100 litres for next week", "2026-11-18"],
  ])("%s -> %s", (text, iso) => {
    expect(stated(text, iso)).toBe(true);
  });
});

describe("a day the words do not contain is still not stated", () => {
  it.each([
    ["300 litres of milk, cheapest option, no rush", "2026-11-15"],
    ["Huomiseksi 50 kiloa maustamatonta jogurttia", "2026-11-16"], // tomorrow is the 15th
    ["50 kg naturell yoghurt till i morgon", "2026-11-17"],
    ["Tarvitsen 1000 litraa laktoositonta maitoa maanantaiksi", "2026-11-17"], // a Tuesday
    ["a dozen cases of butter for Friday", "2026-11-16"],
    ["5 kg glutenfri riven mozzarella till den 19:e", "2026-11-20"],
    ["Order 2,000 litres of lactose-free milk for 16.11.", "2026-12-16"],
    ["Tilaa 12 litraa vispikermaa, halvin vaihtoehto", "2026-11-15"],
  ])("%s -/-> %s", (text, iso) => {
    expect(stated(text, iso)).toBe(false);
  });

  it("without today, the older check: the words must say anything about when", () => {
    expect(dayStated("5,5 kg voita huomiseksi", "2026-11-15")).toBe(true);
    expect(mentionsDay("5 kg glutenfri riven mozzarella till den 19:e")).toBe(true);
    expect(dayStated("300 litres of milk, no rush", "2026-11-15")).toBe(false);
  });
});

describe("amounts stated in words", () => {
  const values = (t: string) => numbersIn(t).map((n) => n.value);
  it.each([
    ["a dozen cases of butter for Friday", 12],
    ["Two dozen cartons of lactose-free milk for Monday", 24],
    ["Tusina laatikkoa voita perjantaiksi", 12],
    ["Kaksi tusinaa purkkia kermaa ylihuomiseksi", 24],
    ["Tarvitaan kaksi tusinaa voirasiaa torstaiksi", 24],
    ["Ett dussin lådor smör till fredag", 12],
    ["Två dussin paket laktosfri grädde till måndag", 24],
    ["Order fifty litres of milk for Friday", 50],
    ["Viisikymmentä litraa maitoa perjantaiksi", 50],
    ["Tvåhundra liter lättmjölk till i övermorgon", 200],
  ])("%s has %d", (text, n) => {
    expect(values(text)).toContain(n);
  });

  it("'double the usual' gives the factor 2", () => {
    expect(values("We usually take 100 litres a week; this week we need double")).toEqual(expect.arrayContaining([100, 2]));
  });
});
