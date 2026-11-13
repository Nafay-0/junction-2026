/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: probes read untyped JSON replies. */
/**
 * The kitchen portal's own back end (/ui-api/kitchens/<kitchen>/...), called as a stranger with no session:
 * credentials it hands out, memory it lets anyone change, live lookups and model calls it spends.
 */
import { joinAsVisitor } from "../lib/actors";
import { agent, consoleCall } from "../lib/http";
import { driveIntake } from "../lib/intake";
import type { Probe } from "../lib/probe";

export const portalProbes: Probe[] = [
  {
    id: "portal.connect_hands_out_mandate",
    area: "mandate",
    kind: "authority",
    title: "GET /ui-api/kitchens/<visitor kitchen>/connect gives a stranger that kitchen's signed mandate, usable on the public API",
    findings: ["F-CONNECT-MANDATE"],
    cases: 2,
    async run({ http, check }) {
      const v = await joinAsVisitor(http);
      if ("error" in v) return void check.expect(false, `join failed: ${v.error}`);
      const c = await http.get(`/ui-api/kitchens/${v.sandboxId}/connect`); // no cookie
      const token = c.body?.mandate;
      check.expect(!token, `anonymous /connect returned the visitor kitchen's mandate token (${String(token).slice(0, 16)}..., agent ${c.body?.agentId})`);
      if (token) {
        const r = await agent(http, token, c.body.agentId).post("/api/v1/requests", { text: "qa: opened by a stranger with a mandate from /connect" });
        check.expect(r.status !== 201, `the stranger opened a request as ${v.sandboxId}'s agent on the public API (${r.status})`);
      }
    },
  },
  {
    id: "portal.memory_rule_forgotten_by_stranger",
    area: "memory",
    kind: "authority",
    title: "A stranger makes Kaari forget its stated 'always lactose-free' rule; the next milk request offers regular milk",
    findings: ["F-PORTAL-MEMORY-OPEN"],
    async run({ http, check }) {
      const before = await consoleCall(http, "kaari")("GET", "/api/v1/kitchen");
      const pref = (before.body?.kitchen?.stated ?? before.body?.kitchen?.statedPreferences ?? []).find((p: any) => /lactose/i.test(p.text ?? ""));
      if (!pref) return { skip: "Kaari has no stated lactose rule on this server (already forgotten?)" };
      const f = await http.post("/ui-api/kitchens/kaari/memory", { action: "forget", preferenceId: pref.id });
      check.expect(f.status >= 400, `anonymous POST /ui-api/kitchens/kaari/memory forget ${pref.id}: ${f.status}`);
      const t = await driveIntake(consoleCall(http, "kaari") as never, { item: { text: "milk", category: "milk" }, quantity: { amount: 100, unit: "L" } }, { by: "Kitchen staff", onConcern: "confirm", placeOrder: false });
      const lines = (t.final?.options ?? []).flatMap((o: any) => o.lines);
      check.note(`after forgetting: ${t.steps.map((s) => s.state).join(" > ")}, products ${[...new Set(lines.map((l: any) => l.productId))].join(", ")}`);
      // restore (as the portal itself would): state the rule again
      await http.post("/ui-api/kitchens/kaari/memory", { action: "rule", family: "milk", dimension: "lactose", choice: "lactose_free" });
    },
  },
  {
    id: "portal.catalog_live_drains_allowance",
    area: "dependency",
    kind: "exhaustion",
    title: "One stranger browsing (or scripting) catalogue live checks uses up a visitor kitchen's live-lookup hour; the next real request is refused",
    findings: ["F-SHARED-LIVE-ALLOWANCE"],
    async run({ http, check }) {
      if ((await http.get("/ui-api/wall")).body?.catalogue?.kind !== "seed") return { skip: "needs the seed catalogue (would spend live lookups)" };
      const v = await joinAsVisitor(http);
      if ("error" in v) return void check.expect(false, `join failed: ${v.error}`);
      let n = 0;
      for (; n < 40; n++) {
        const r = await http.post(`/ui-api/kitchens/${v.sandboxId}/catalog/live`, { productIds: ["VA-1001"] });
        if (r.status === 429) break;
      }
      const t = await driveIntake(consoleCall(v.http, v.sandboxId) as never, { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 50, unit: "L" } }, { by: v.approverName, onConcern: "confirm", placeOrder: false });
      const blocked = t.steps.some((s) => s.code === "live_lookup_budget_exceeded");
      check.expect(!blocked, `after ${n} anonymous catalogue live checks on ${v.sandboxId}, the visitor's own request was refused (${t.steps.map((s) => s.code ?? s.state).join(" > ")})`);
    },
  },
];
