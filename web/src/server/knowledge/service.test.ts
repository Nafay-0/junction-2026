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

  it("the typed function answers unavailable, not an exception, when there is no map", async () => {
    setKnowledgeMapForTests(null);
    expect(await alternativesFor("800001")).toMatchObject({ available: false });
    setKnowledgeMapForTests(new KnowledgeMap(testProducts(), testKnowledge()));
  });
});
