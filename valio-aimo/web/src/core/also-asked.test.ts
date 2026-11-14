import { describe, expect, it } from "vitest";
import { alsoAskedIn, alsoAskedNote, groupsIn } from "./also-asked";

const need = (text: string, amount?: number, unit = "L") => ({ item: { text, attributes: [], excludedAttributes: [] }, quantity: amount ? { amount, unit: unit as "L" } : undefined, sameAsLastTime: false });
const groups = (text: string, n: ReturnType<typeof need>) => alsoAskedIn(text, n).map((x) => x.group);

describe("nothing the buyer asked for vanishes silently (plain code against their words)", () => {
  // QA's multi-need corpus (qa/corpus/requests.json, category multi_need): the need is the first item, as the model makes it.
  it.each([
    ["Need 100 L milk plus 20 kg yoghurt by Tuesday please.", need("milk", 100), ["yoghurt"]],
    ["Hi, can you order 60 litres of lactose-free milk and some cream for Monday? Thanks, Sari", need("lactose-free milk", 60), ["cream"]],
    ["30 L oat drink on Wednesday and the same again next Monday.", need("oat drink", 30), ["repeat"]],
    ["Butter 20 packs, and some cheese too, for Thursday. We have a kid with a nut allergy so nothing with nuts.", need("butter", 20, "pcs"), ["cheese"]],
    ["School kitchen order: 5 L cream, 40 L milk 1.5% fat and 15 kg natural yoghurt. Deliver Wed.", need("cream", 5), ["milk", "yoghurt"]],
    ["Tarvitaan 100 litraa maitoa ja 20 kg jogurttia tiistaiksi.", need("maito", 100), ["yoghurt"]],
    ["Maanantaiksi 40 L maitoa ja keskiviikoksi 15 kg voita, kiitos.", need("maito", 40), ["butter"]],
    ["Vegaaniselle linjalle kauramaitoa 60 L ja kasvivoita 5 kg keskiviikoksi, ja gluteenittomuus on pakollinen.", need("kauramaito", 60), ["plant spread"]],
    ["Hej! Vi behöver 100 liter mjölk och 20 kg yoghurt till tisdag, tack.", need("mjölk", 100), ["yoghurt"]],
    ["Hotellet behöver 5 kg smör, 30 l grädde och 12 kg ost på onsdag.", need("smör", 5, "kg"), ["cream", "cheese"]],
    ["Kan ni skicka 200 l ekologisk havredryck och 50 l mjölk till tisdag?", need("havredryck", 200), ["milk"]],
    ["Hei, koulun keittiölle 100 L maitoa + 20 kg jogurttia, no nuts anywhere, lauantaina tai sunnuntaina jos ehtii.", need("maito", 100), ["yoghurt"]],
    ["Moi, saisinko 20 kg cheddaria ja 10 kg edamia?", need("cheddar", 20, "kg"), ["cheese"]],
  ])("%s", (text, n, want) => {
    expect(groups(text, n)).toEqual(want);
  });

  it.each([
    ["100 L lactose-free milk for Thursday", need("lactose-free milk", 100)],
    ["5 crates lactose free milk, 1.5% fat, by Wednesday. We have a guest with an egg allergy this week.", need("lactose free milk", 5, "pcs")],
    ["Tarvitaan kaurakermaa 30 dl vegaaniseen kakkuun, ei saa olla maitoa, munaa eikä pähkinää. Torstaiksi.", need("kaurakerma", 30, "dl")],
    ["Aamiaiselle jogurttia 5 kg, ei saa sisältää maitoproteiinia (asukkaalla allergia).", need("jogurtti", 5, "kg")],
    ["Hi, 6 kg vegan cheese please, the cow's milk kind. Needed by Friday the 20th.", need("vegan cheese", 6, "kg")],
    ["Hello! 3 kg of natural yoghurt tomorrow if possible, 1,5 kg of that should be fat free.", need("natural yoghurt", 3, "kg")],
    ["Viikonlopuksi tarvitaan juustoa, 8 kg edamia ja 4 kg emmentalia.", need("juusto", 12, "kg")],
  ])("one item, no note: %s", (text, n) => {
    expect(alsoAskedIn(text, n)).toEqual([]);
  });

  it("keeps the buyer's own words and amount, and says plainly that nothing was ordered for them", () => {
    const also = alsoAskedIn("Need 100 L milk plus 20 kg yoghurt by Tuesday please.", need("milk", 100));
    expect(also).toEqual([{ text: "20 kg yoghurt by Tuesday please.", group: "yoghurt", amount: { amount: 20, unit: "kg" } }]);
    expect(alsoAskedNote(also)).toMatch(/You also asked for "20 kg yoghurt by Tuesday please\."\. .*nothing has been ordered for it: ask for it next\./);
  });

  it("oat drink is not milk, cream cheese is not cream", () => {
    expect(groupsIn("kauramaitoa")).toEqual(["oat drink"]);
    expect(groupsIn("8 packs of cream cheese")).toEqual(["cheese"]);
  });
});
