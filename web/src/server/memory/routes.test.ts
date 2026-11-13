import { beforeEach, describe, expect, it } from "vitest";
import * as kitchenMemory from "@/app/ui-api/memory/kitchens/[kitchen]/route";
import * as interactions from "@/app/ui-api/memory/kitchens/[kitchen]/interactions/route";
import * as recallRoute from "@/app/ui-api/memory/kitchens/[kitchen]/recall/route";
import * as mandateRoute from "@/app/ui-api/memory/kitchens/[kitchen]/mandate/route";
import * as wholesaler from "@/app/ui-api/memory/wholesaler/route";
import * as proposals from "@/app/ui-api/memory/wholesaler/proposals/route";
import { resetRuntime } from "@/server/runtime";
import { resetMemoryService } from "./runtime";
import { OPS_COOKIE } from "./staff";

/** The routes the kitchen portal and the operations portal call, end to end on the in-process runtime. */

process.env.DOCK_MEMORY_LLM = "off"; // no model calls in tests: taps and statements only
const g = globalThis as typeof globalThis & { __dockOpsSessions?: Map<string, { token: string; name: string; expiresAt: string }> };
const STAFF = { cookie: `${OPS_COOKIE}=tok_staff` };

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  g.__dockOpsSessions = new Map([["tok_staff", { token: "tok_staff", name: "Pirjo (customer service)", expiresAt: new Date(Date.now() + 3600_000).toISOString() }]]);
});

const params = (kitchen: string) => ({ params: Promise.resolve({ kitchen }) }) as never;
const req = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://dock.test${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

const view = async (k: string) => json(await kitchenMemory.GET(req(`/ui-api/memory/kitchens/${k}`), params(k)));
const act = async (k: string, b: unknown) => json(await kitchenMemory.POST(req(`/ui-api/memory/kitchens/${k}`, b), params(k)));

describe("kitchen memory routes", () => {
  it("lists what the demo kitchen remembers, including the rule its head chef stated", async () => {
    const { status, body } = await view("kaari");
    expect(status).toBe(200);
    expect(body.items).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Always lactose-free", strength: "rule", origin: "stated", audience: "shared", confirmedBy: expect.objectContaining({ by: "Sanna Koskinen (head chef)" }) })]));
    expect(body.items.some((i: { kind: string }) => i.kind === "standing_order")).toBe(true); // Monday and Thursday milk, from six weeks of history
  });

  it("states, recalls, makes private, and forgets, all within the one kitchen", async () => {
    const stated = await act("laakso", { action: "state", fact: { kind: "allergen", allergen: "nut" }, text: "No nuts: we cook for a school" });
    expect(stated.status).toBe(200);
    const nut = stated.body.memory.items.find((i: { kind: string }) => i.kind === "allergen");
    expect(nut).toMatchObject({ text: "No nuts: we cook for a school", fact: { allergen: "nuts" }, strength: "rule" });
    expect((await view("kaari")).body.items.some((i: { id: string }) => i.id === nut.id)).toBe(false);

    const r = await json(await recallRoute.POST(req("/ui-api/memory/kitchens/laakso/recall", { text: "20 kg yoghurt for Monday", family: "yoghurt" }), params("laakso")));
    expect(r.body.items[0]).toMatchObject({ itemId: nut.id, use: "constrains" });
    expect((await json(await recallRoute.POST(req("/ui-api/memory/kitchens/kaari/recall", { text: "nuts" }), params("kaari")))).body.items.some((i: { itemId: string }) => i.itemId === nut.id)).toBe(false);

    const offers = await json(await mandateRoute.GET(req("/ui-api/memory/kitchens/laakso/mandate"), params("laakso")));
    expect(offers.body.offers).toEqual([]); // Laakso's mandate already forbids nuts: nothing to add

    expect((await act("kaari", { action: "forget", itemId: nut.id })).status).toBe(404); // not Kaari's
    const forgotten = await act("laakso", { action: "forget", itemId: nut.id });
    expect(forgotten.body.items.some((i: { id: string }) => i.id === nut.id)).toBe(false);
    expect(forgotten.body.forgotten).toEqual([expect.objectContaining({ kind: "allergen" })]);
  });

  it("learns from a tap through the interactions route, and refuses a rule slipped in as an event", async () => {
    const r = await json(
      await interactions.POST(
        req("/ui-api/memory/kitchens/kaari/interactions", {
          door: "substitute",
          segments: [{ id: "s1", source: "buyer", text: "No thanks, the foam is wrong for the cappuccinos." }],
          events: [
            { type: "substitute", family: "milk", productId: "X-OAT", name: "Oat barista", forName: "Milk 1.5 %", accepted: false, reason: "the foam is wrong" },
            { type: "rule_stated", fact: { kind: "goal", goal: "price" } },
          ],
        }),
        params("kaari"),
      ),
    );
    expect(r.status).toBe(200);
    expect(r.body.outcomes.map((o: { action: string; text?: string }) => [o.action, o.text])).toContainEqual(["stored", 'Turned down Oat barista as a substitute for Milk 1.5 %: "the foam is wrong"']);
    expect(r.body.outcomes.some((o: { text?: string }) => o.text?.includes("lowest price"))).toBe(false);
  });
});

describe("the wholesaler's read route", () => {
  it("needs an operations session", async () => {
    expect((await json(await wholesaler.GET(req("/ui-api/memory/wholesaler")))).status).toBe(401);
    expect((await json(await wholesaler.GET(req("/ui-api/memory/wholesaler", undefined, { cookie: `${OPS_COOKIE}=forged` })))).status).toBe(401);
  });

  it("shows shared items across kitchens with provenance, never private ones, and records the read for the kitchen", async () => {
    await view("kaari");
    const note = await act("kaari", { action: "note", text: "Jari wants to renegotiate prices in January" });
    const noteId = note.body.report.outcomes[0].itemId;
    const s = await json(await wholesaler.GET(req("/ui-api/memory/wholesaler", undefined, STAFF)));
    expect(s.status).toBe(200);
    const kaari = s.body.kitchens.find((k: { orgId: string }) => k.orgId === "org_ravintola_kaari");
    expect(kaari.items.map((i: { text: string }) => i.text)).toContain("Always lactose-free");
    expect(kaari.items.every((i: { audience: string }) => i.audience === "shared")).toBe(true);
    expect(JSON.stringify(s.body)).not.toContain("renegotiate");
    const back = await view("kaari");
    expect(back.body.staffReads[0]).toMatchObject({ by: "Pirjo (customer service)" });
    expect(back.body.items.find((i: { id: string }) => i.id === noteId)).toMatchObject({ audience: "private" });
  });

  it("drops an item from the staff view at once when the kitchen makes it private", async () => {
    const rule = (await view("kaari")).body.items.find((i: { text: string }) => i.text === "Always lactose-free");
    const ids = async () => (await json(await wholesaler.GET(req("/ui-api/memory/wholesaler?kitchen=org_ravintola_kaari", undefined, STAFF)))).body.kitchens.flatMap((k: { items: { id: string }[] }) => k.items.map((i) => i.id));
    expect(await ids()).toContain(rule.id);
    await act("kaari", { action: "audience", itemId: rule.id, audience: "private" });
    expect(await ids()).not.toContain(rule.id);
  });

  it("takes a staff proposal that changes nothing until the kitchen accepts it", async () => {
    const p = await json(await proposals.POST(req("/ui-api/memory/wholesaler/proposals", { orgId: "org_ravintola_kaari", text: "Your nut rule: add peanuts too?", fact: { kind: "allergen", allergen: "peanuts" } }, STAFF)));
    expect(p.status).toBe(200);
    expect((await view("kaari")).body.items.some((i: { fact: { allergen?: string } }) => i.fact.allergen === "peanuts")).toBe(false);
    expect((await view("kaari")).body.proposals[0]).toMatchObject({ status: "open", by: "Pirjo (customer service)" });
    const accepted = await act("kaari", { action: "proposal", proposalId: p.body.proposal.id, accept: true });
    expect(accepted.body.items.some((i: { fact: { allergen?: string } }) => i.fact.allergen === "peanuts")).toBe(true);
    expect((await json(await proposals.POST(req("/ui-api/memory/wholesaler/proposals", { orgId: "org_ravintola_kaari", text: "x" })))).status).toBe(401);
  });
});
