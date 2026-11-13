 
/**
 * The shared demo kitchens (/k/laakso, /k/kaari) as many judges would use them on one deployment, through the
 * console's own back end. These probes want a freshly started server on the seed catalogue: they skip when the
 * kitchen has already been used, and never run against the real catalogue (they would spend live lookups).
 */
import { consoleCall, type Http } from "../lib/http";
import { driveIntake } from "../lib/intake";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import type { Probe } from "../lib/probe";

async function catalogueKind(http: Http): Promise<string | undefined> {
  return (await http.get("/ui-api/wall")).body?.catalogue?.kind;
}
function nextWeekday(days: number[]): string {
  let d = addDaysIso(localNow(new Date()).date, 1);
  while (!days.includes(isoWeekday(d))) d = addDaysIso(d, 1);
  return d;
}

export const demoProbes: Probe[] = [
  {
    id: "demo.headline_twice_laakso",
    area: "gate",
    kind: "sequence",
    title: "Valio's own example on /k/laakso, tried by two judges in a row: the second still gets options",
    findings: ["F-PENDING-HOLDS-BUDGET", "F-DEMO-KITCHEN-UNSIGNABLE", "F-NO-OPTION-REASON"],
    cases: 2,
    async run({ http, check }) {
      if ((await catalogueKind(http)) !== "seed") return { skip: "needs the seed catalogue" };
      const call = consoleCall(http, "laakso");
      const need = { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy: nextWeekday([1, 2, 3, 4, 5]) };
      const first = await driveIntake(call as never, need, { by: "Judge 1", onConcern: "confirm" });
      if (first.order?.status !== "pending_approval") return { skip: `first attempt did not reach sign-off (${first.steps.map((s) => s.state).join(" > ")}): server not fresh` };
      const apr = first.order.approval.approvalId;
      const qr = await http.get(`/ui-api/kitchens/laakso/approval/${apr}`);
      check.expect(qr.body?.mode !== "view_only", `the console offers no way to sign the demo kitchen's order (mode ${qr.body?.mode}): it stays pending`);
      const second = await driveIntake(call as never, need, { by: "Judge 2", onConcern: "confirm", placeOrder: false });
      const end = second.steps.at(-1)?.state;
      check.expect(end === "options_ready" || end === "quoted", `second judge: ${second.steps.map((s) => s.state).join(" > ")}; ${second.final?.notes?.[0]?.slice(0, 220)}`);
      const overBudget = (second.final?.excluded ?? []).filter((e: { code?: string }) => e.code === "over_budget");
      if (end === "no_options" && overBudget.length) check.expect(/budget/i.test(second.final.notes[0]), `the buyer is told "${second.final.notes[0].slice(0, 160)}..." but ${overBudget.length} products were excluded only by the weekly budget the first, unsignable order still holds`);
    },
  },
  {
    id: "demo.shared_live_allowance_kaari",
    area: "dependency",
    kind: "exhaustion",
    title: "Thirty-one visitors each make one request on /k/kaari within an hour: all of them get an answer",
    findings: ["F-SHARED-LIVE-ALLOWANCE"],
    cases: 31,
    async run({ http, check }) {
      if ((await catalogueKind(http)) !== "seed") return { skip: "needs the seed catalogue (would spend live lookups)" };
      const call = consoleCall(http, "kaari");
      for (let i = 1; i <= 31; i++) {
        const r = await call("POST", "/api/v1/intake", { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 90 + i, unit: "L" }, deliverBy: nextWeekday([1, 4]) }, by: `Visitor ${i}` });
        if (r.status === 429) return void check.expect(false, `visitor ${i} on /k/kaari got 429 ${r.body?.error?.code}: "${r.body?.error?.message}" (the allowance is per agent, and every visitor of the demo kitchen is the same agent)`);
      }
    },
  },
];
