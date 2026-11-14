/**
 * Authority and data exposure: what a stranger with no mandate, or one kitchen's console, can read or do about
 * another kitchen; approvals and sign-off; visitor sandboxes.
 */
import { joinAsVisitor, kaariAgent, laaksoAgent, passkeyDecide } from "../lib/actors";
import { buy, openRequest } from "../lib/flow";
import { consoleCall } from "../lib/http";
import { driveIntake } from "../lib/intake";
import type { Probe } from "../lib/probe";

const BIG = { weeklyBudgetCents: 1_000_000_000 };
const MARK = () => `QA-SECRET-${Math.random().toString(36).slice(2, 10)}`;

export const exposureProbes: Probe[] = [
  {
    id: "exposure.ledger_public",
    area: "ledger",
    kind: "authority",
    title: "A stranger with no credentials reads another kitchen's request text from GET /api/v1/ledger",
    findings: ["F-LEDGER-OPEN"],
    async run({ http, check }) {
      const mark = MARK();
      const k = await kaariAgent(http, BIG);
      await openRequest(k, `qa private note ${mark}: 3 L for the chef's anniversary party`);
      const r = await http.get("/api/v1/ledger"); // no Authorization header
      check.expect(!(r.text.includes(mark)), `unauthenticated ledger read returned Kaari's request text (status ${r.status}, ${r.body?.entries?.length} entries across ${new Set((r.body?.entries ?? []).map((e: { actor?: string }) => e.actor)).size} actors)`);
    },
  },
  {
    id: "exposure.console_ledger_cross_kitchen",
    area: "ledger",
    kind: "authority",
    title: "Kaari's console back end returns Laakso's ledger entries",
    findings: ["F-LEDGER-OPEN"],
    async run({ http, check }) {
      const mark = MARK();
      const l = await laaksoAgent(http, BIG);
      await openRequest(l, `qa laakso private ${mark}`);
      const r = await consoleCall(http, "kaari")("GET", "/api/v1/ledger");
      check.expect(!r.text.includes(mark), `/ui-api/kitchens/kaari/call GET /api/v1/ledger contains Laakso's request (${r.status})`);
    },
  },
  {
    id: "exposure.approvals_public",
    area: "sandbox",
    kind: "authority",
    title: "GET /api/v1/approvals and GET /api/v1/approvals/{id} with no credentials show other kitchens' pending orders and mandates",
    findings: ["F-APPROVALS-OPEN"],
    cases: 2,
    async run({ http, check }) {
      const a = await laaksoAgent(http, { ...BIG, perOrderLimitCents: 100 });
      const { o } = await buy(a, [{ productId: "VA-1001", quantity: 2 }], { text: `qa pending ${MARK()}` });
      const apr = o?.body?.order?.approval?.approvalId;
      const list = await http.get("/api/v1/approvals");
      check.expect(!(list.body?.approvals ?? []).some((x: { approvalId: string }) => x.approvalId === apr), `anonymous GET /api/v1/approvals lists Laakso's pending ${apr} (${list.body?.approvals?.length} pending across ${new Set((list.body?.approvals ?? []).map((x: { orgName: string }) => x.orgName)).size} orgs)`);
      const one = await http.get(`/api/v1/approvals/${apr}`);
      check.expect(one.status === 401 || one.status === 403 || one.status === 404, `anonymous GET /api/v1/approvals/${apr}: ${one.status} with ${Object.keys(one.body?.view ?? {}).join(",").slice(0, 120)}`);
    },
  },
  {
    id: "exposure.events_public",
    area: "sandbox",
    kind: "authority",
    title: "GET /api/v1/events with no credentials streams every kitchen's events",
    findings: ["F-APPROVALS-OPEN"],
    async run({ http, check }) {
      const ctrl = new AbortController();
      const res = await fetch(new URL("/api/v1/events?since=0", http.base), { signal: ctrl.signal, headers: { accept: "text/event-stream" } });
      const reader = res.body!.getReader();
      let text = "";
      const t0 = Date.now();
      while (Date.now() - t0 < 1500 && text.length < 20_000) {
        const chunk = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), 800))]);
        if (chunk.done) break;
        text += new TextDecoder().decode(chunk.value);
      }
      ctrl.abort();
      const orgs = new Set([...text.matchAll(/"orgId":"([^"]+)"/g)].map((m) => m[1]));
      check.expect(orgs.size <= 1, `anonymous event stream replayed events of ${orgs.size} organisations (${[...orgs].slice(0, 4).join(", ")})`);
    },
  },
  {
    id: "exposure.agent_cannot_approve",
    area: "gate",
    kind: "authority",
    title: "The agent cannot approve its own order: mandate headers, a guessed token, demo tap or session proofs are refused",
    cases: 5,
    async run({ http, check }) {
      const a = await laaksoAgent(http, { ...BIG, perOrderLimitCents: 100 });
      const { o } = await buy(a, [{ productId: "VA-1001", quantity: 2 }]);
      const apr = o?.body?.order?.approval?.approvalId;
      check.expect(!!apr, "no approval was created");
      const tries: [string, unknown][] = [
        ["no proof", { decision: "approve" }],
        ["guessed token", { decision: "approve", token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }],
        ["demo tap without session", { decision: "approve", proof: { kind: "demo_tap" } }],
        ["session decline without cookie", { decision: "decline", proof: { kind: "session" } }],
        ["webauthn garbage", { decision: "approve", proof: { kind: "webauthn", response: { id: "x", rawId: "x", type: "public-key", response: { clientDataJSON: "x", authenticatorData: "x", signature: "x" } } } }],
      ];
      for (const [name, body] of tries) {
        const r = await a.post(`/api/v1/approvals/${apr}`, body);
        check.expect(r.status >= 400 && r.status < 500 && r.body?.order?.status !== "committed", `${name}: ${r.status} ${r.body?.error?.code}`);
      }
      const dev = await http.get("/api/v1/dev/outbox");
      check.expect(dev.status === 404, `dev outbox (one-time approval links) reachable: ${dev.status}`);
      const after = await a.get(`/api/v1/orders/${o?.body?.order?.orderId}`);
      check.expect(after.body?.order?.status === "pending_approval", `order is now ${after.body?.order?.status}`);
    },
  },
  {
    id: "sandbox.passkey_approval_e2e",
    area: "sandbox",
    kind: "plausible",
    title: "Visitor joins with a passkey, the demo order needs their sign-off, the passkey approves it, the ledger verifies",
    async run({ http, check }) {
      const v = await joinAsVisitor(http);
      if ("error" in v) return void check.expect(false, `join failed: ${v.error}`);
      const d = await v.http.post("/api/v1/approver/demo-order", {});
      check.expect(d.status === 201, `demo order: ${d.status} ${d.text.slice(0, 200)}`);
      const apr = d.body?.order?.approvalId;
      if (!apr) return;
      const r = await passkeyDecide(v, apr, "approve");
      check.expect(r.status === 200 && r.body?.order?.status === "committed", `passkey approve: ${r.status} ${r.body?.order?.status ?? r.body?.error?.code}`);
      const again = await passkeyDecide(v, apr, "approve");
      check.expect(again.status === 409, `approving twice: ${again.status} ${again.body?.error?.code}`);
      const l = await http.get("/api/v1/ledger");
      check.expect(l.body?.verification?.ok === true, "ledger does not verify after a passkey sign-off");
    },
  },
  {
    id: "sandbox.other_visitor_cannot_approve",
    area: "sandbox",
    kind: "authority",
    title: "Visitor B's passkey and session cannot approve or decline visitor A's order",
    cases: 2,
    async run({ http, check }) {
      const A = await joinAsVisitor(http);
      const B = await joinAsVisitor(http);
      if ("error" in A || "error" in B) return void check.expect(false, "join failed");
      const d = await A.http.post("/api/v1/approver/demo-order", {});
      const apr = d.body?.order?.approvalId;
      if (!apr) return void check.expect(false, `no approval: ${d.text.slice(0, 200)}`);
      const ch = await B.http.post(`/api/v1/approvals/${apr}/challenge`, { decision: "approve" });
      if (ch.status === 200) {
        const resp = B.auth.assert(ch.body.options, { origin: new URL(http.base).origin });
        const r = await B.http.post(`/api/v1/approvals/${apr}`, { decision: "approve", proof: { kind: "webauthn", response: resp } });
        check.expect(r.status >= 400 && r.status < 500, `B's passkey approving A's order: ${r.status} ${r.body?.order?.status ?? r.body?.error?.code}`);
      }
      const dec = await B.http.post(`/api/v1/approvals/${apr}`, { decision: "decline", proof: { kind: "session" } });
      check.expect(dec.status >= 400 && dec.status < 500, `B's session declining A's order: ${dec.status} ${dec.body?.order?.status ?? dec.body?.error?.code}`);
    },
  },
  {
    id: "sandbox.stranger_triggers_demo_order",
    area: "sandbox",
    kind: "authority",
    title: "A stranger lists visitor kitchens and makes their agent order (sign-off requests land on the visitor's phone)",
    findings: ["F-SANDBOX-OPEN"],
    async run({ http, check }) {
      const v = await joinAsVisitor(http);
      if ("error" in v) return void check.expect(false, `join failed: ${v.error}`);
      const list = await http.get("/api/v1/sandboxes");
      const listed = (list.body?.sandboxes ?? []).some((s: { sandboxId: string }) => s.sandboxId === v.sandboxId);
      const r = await http.post(`/api/v1/sandboxes/${v.sandboxId}/demo-order`, {});
      check.expect(!(listed && r.status === 201), `anonymous: sandbox listed=${listed}, POST demo-order -> ${r.status} (approval ${r.body?.order?.approvalId}) on someone else's kitchen`);
    },
  },
  {
    id: "sandbox.stranger_spends_visitor_budget",
    area: "sandbox",
    kind: "authority",
    title: "Through /ui-api/kitchens/<visitor>/call a stranger acts as that visitor's agent (intake, quote, order within the mandate)",
    findings: ["F-CONSOLE-OPEN"],
    async run({ http, check }) {
      const v = await joinAsVisitor(http);
      if ("error" in v) return void check.expect(false, `join failed: ${v.error}`);
      const call = consoleCall(http, v.sandboxId);
      const t = await driveIntake(call as never, { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 20, unit: "L" }, optimise: "price" }, { by: "a stranger", onConcern: "confirm" });
      check.note(`stranger on ${v.sandboxId}: ${t.steps.map((s) => s.state).join(" > ")}`);
      const committed = t.order?.status === "committed";
      check.expect(!committed, `a stranger with only the visitor's kitchen slug committed an order on that visitor's kitchen`);
    },
  },
  {
    id: "exposure.interpret_unmetered",
    area: "interpreter",
    kind: "exhaustion",
    title: "The model interpreter is reachable with no credentials through the console back end, with no rate limit",
    findings: ["F-MODEL-SPEND"],
    async run({ http, check }) {
      const call = consoleCall(http.anonymous(), "kaari"); // an anonymous visitor: no kitchen session
      const rs = [];
      for (let i = 0; i < 3; i++) rs.push(await call("POST", "/api/v1/agent/interpret", { text: `${10 + i} litres of milk for Tuesday` }));
      const paid = rs.filter((r) => r.status === 200).length;
      const limited = rs.some((r) => r.status === 429 || r.headers.get("ratelimit-remaining") !== null || r.headers.get("x-ratelimit-remaining") !== null);
      check.note(`3 anonymous interpret calls: statuses ${rs.map((r) => r.status).join(",")}`);
      check.expect(paid === 0 || limited, `anonymous visitor made ${paid} paid model calls with no rate limit or quota signal`);
    },
  },
  {
    id: "exposure.oversized_and_malformed",
    area: "rest",
    kind: "hostile",
    title: "Malformed JSON, wrong content type, 5 MB bodies, deep nesting, odd encodings: 4xx, never 5xx",
    cases: 7,
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const big = JSON.stringify({ text: "x".repeat(5_000_000) });
      const deep = "[".repeat(50_000) + "]".repeat(50_000);
      const cases: [string, string, BodyInit, Record<string, string>][] = [
        ["malformed", "/api/v1/requests", "{text:", { "content-type": "application/json" }],
        ["5 MB text", "/api/v1/requests", big, { "content-type": "application/json" }],
        ["deep nesting", "/api/v1/quotes", deep, { "content-type": "application/json" }],
        ["text/plain", "/api/v1/requests", "hello", { "content-type": "text/plain" }],
        ["lone surrogate", "/api/v1/requests", '{"text":"\\ud800 milk"}', { "content-type": "application/json" }],
        ["NUL and RTL", "/api/v1/requests", JSON.stringify({ text: "milk\u0000‮klim" }), { "content-type": "application/json" }],
        ["array body", "/api/v1/intake", "[1,2,3]", { "content-type": "application/json" }],
      ];
      for (const [name, path, body, headers] of cases) {
        const r = await a.raw("POST", path, { body, headers });
        check.expect(r.status >= 400 && r.status < 500 || (name.includes("NUL") || name.includes("surrogate")) && r.status < 300, `${name}: ${r.status} ${r.text.slice(0, 120)}`);
      }
      const c = await http.raw("POST", "/ui-api/kitchens/kaari/call", { body: "{", headers: { "content-type": "application/json" } });
      check.expect(c.status === 400, `console malformed: ${c.status}`);
    },
  },
];
