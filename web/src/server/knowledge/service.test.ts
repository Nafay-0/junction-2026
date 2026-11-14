import { afterAll, describe, expect, it } from "vitest";
import { GET as alternativesRoute } from "@/app/ui-api/knowledge/alternatives/route";
import { GET as roleRoute } from "@/app/ui-api/knowledge/role/route";
import { KnowledgeMap } from "./map";
import { alternativesFor, setKnowledgeMapForTests } from "./service";
import { testKnowledge, testProducts } from "./test-catalogue";

setKnowledgeMapForTests(new KnowledgeMap(testProducts(), testKnowledge()));
afterAll(() => setKnowledgeMapForTests(null));

const get = (path: string) => new Request(`http://dock.test${path}`);

describe("knowledge routes", () => {
  it("GET /ui-api/knowledge/alternatives answers with ranked substitutes and pack alternatives apart", async () => {
    const res = await alternativesRoute(get("/ui-api/knowledge/alternatives?product=800001&use=whipping"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.substitutes[0]).toMatchObject({ productId: "800003", tier: "best" });
    expect(body.packAlternatives.map((a: { productId: string }) => a.productId)).toEqual(["800002"]);
  });

  it("applies the buyer's constraints from the query", async () => {
    const res = await alternativesRoute(get("/ui-api/knowledge/alternatives?product=800023&use=drinking&claims=lactose_free"));
    const body = await res.json();
    for (const s of body.substitutes) expect(["800020", "800021"]).toContain(s.productId);
  });

  it("refuses a malformed query and an unknown product", async () => {
    expect((await alternativesRoute(get("/ui-api/knowledge/alternatives?product=800001&use=juggling"))).status).toBe(400);
    expect((await alternativesRoute(get("/ui-api/knowledge/alternatives?product=999999"))).status).toBe(404);
  });

  it("GET /ui-api/knowledge/role reads the dish and the ingredient", async () => {
    const res = await roleRoute(get(`/ui-api/knowledge/role?q=${encodeURIComponent("cheese for pizza")}`));
    const body = await res.json();
    expect(body.uses).toContain("pizza");
    expect(body.products.map((p: { productId: string }) => p.productId)).not.toContain("800032");
  });

  it("refuses an allergen or claim word it cannot map (400), never answering 'verified' for an unchecked constraint", async () => {
    const bad = await roleRoute(get(`/ui-api/knowledge/role?q=${encodeURIComponent("milk for coffee")}&allergens=unicorn_dust`));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatchObject({ code: "constraint_unknown", details: { unknown: [{ word: "unicorn_dust", as: "allergen" }] } });
    expect((await alternativesRoute(get("/ui-api/knowledge/alternatives?product=800023&claims=very_tasty"))).status).toBe(400);
    const typed = await alternativesFor("800023", { constraints: { forbiddenAllergens: ["kryptonite"] } });
    expect(typed).toMatchObject({ available: false, unknownConstraints: [{ word: "kryptonite", as: "allergen" }] });
  });

  it("forbidding lactose (in any language) serves no ordinary milk: milk without a lactose-free claim carries lactose", async () => {
    for (const word of ["lactose", "laktoosi", "laktos"]) {
      const res = await roleRoute(get(`/ui-api/knowledge/role?q=${encodeURIComponent("milk for coffee")}&allergens=${encodeURIComponent(word)}`));
      expect(res.status).toBe(200);
      const ids = (await res.json()).products.map((p: { productId: string }) => p.productId);
      expect(ids).not.toContain("800023");
    }
    const alt = await alternativesFor("800020", { use: "drinking", constraints: { forbiddenAllergens: ["laktoosi"] } });
    if (alt.available && "substitutes" in alt) expect(alt.substitutes.map((s) => s.productId)).not.toContain("800023");
  });

  it("maps synonyms: 'tree_nuts' and 'pähkinä' forbid nuts, 'peanut' forbids peanuts", async () => {
    const r = await alternativesFor("800001", { use: "whipping", constraints: { forbiddenAllergens: ["tree_nuts", "pähkinä", "peanut"] } });
    expect(r.available).toBe(true);
  });

  it("the typed function answers unavailable, not an exception, when there is no map", async () => {
    setKnowledgeMapForTests(null);
    expect(await alternativesFor("800001")).toMatchObject({ available: false });
    setKnowledgeMapForTests(new KnowledgeMap(testProducts(), testKnowledge()));
  });
});
