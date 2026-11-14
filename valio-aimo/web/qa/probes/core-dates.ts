/**
 * Dates and time zones, in process against the pure core with an injected clock (no server, no network):
 * the gate and the intake must agree on "today" and on the latest delivery date in Helsinki time, at every
 * hour of the day, including just after local midnight and around the daylight-saving change.
 */
import { localNow, addDaysIso } from "@/core/kitchen";
import { evaluatePolicy } from "@/core/policy";
import { demoMandate } from "@/server/dev-fixtures";
import type { Quote } from "@/core/quote";
import type { Probe } from "../lib/probe";

function quoteFor(deliveryDate: string, now: Date): Quote {
  return {
    quoteId: "qt_qa",
    buyerOrgId: "org_laakso_catering",
    agentId: "agent_laakso_buyer_01",
    mandateId: "mnd_qa",
    requestId: "req_qa",
    currency: "EUR",
    lines: [{ productId: "VA-1001", name: "milk", category: "milk", unit: "L", packSize: 1, attributes: ["lactose_free"], allergens: ["milk"], certificates: [], quantity: 1, unitPriceCents: 100, lineTotalCents: 100, deliveryDate }],
    totalCents: 100,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
  };
}

export const coreDateProbes: Probe[] = [
  {
    id: "dates.gate_latest_day_helsinki",
    area: "dates",
    kind: "boundary",
    title: "The gate's latest delivery day (maxLeadDays) is counted in Helsinki days at every hour, as the intake counts it",
    findings: ["F-GATE-UTC-DATE"],
    async run({ check }) {
      let cases = 0;
      const bad: string[] = [];
      // Every hour over two days around a normal date and the end of daylight saving time (25 Oct 2026).
      for (const start of ["2026-11-13T00:00:00Z", "2026-10-24T00:00:00Z", "2026-03-28T00:00:00Z"]) {
        for (let h = 0; h < 48; h++) {
          const now = new Date(Date.parse(start) + h * 3600_000);
          const mandate = demoMandate(now, { mandateId: "mnd_qa", weeklyBudgetCents: 1e9 });
          const localToday = localNow(now).date;
          const latestLocal = addDaysIso(localToday, mandate.delivery.maxLeadDays);
          const d = evaluatePolicy(mandate, { agentId: mandate.agentId, quote: quoteFor(latestLocal, now), lines: [{ productId: "VA-1001", quantity: 1, unitPriceCents: 100 }] }, { now, spentThisWeekCents: 0, quoteAlreadyUsed: false });
          cases++;
          const r = d.rules.find((x) => x.rule === "delivery_deadline")!;
          if (r.outcome !== "pass") bad.push(`${now.toISOString()} (Helsinki ${localToday} ${localNow(now).time}): delivery on ${latestLocal}, ${mandate.delivery.maxLeadDays} Helsinki days ahead, refused: ${r.reason}`);
        }
      }
      check.expect(bad.length === 0, `${bad.length} of ${cases} hours refuse a delivery exactly maxLeadDays ahead in Helsinki; first: ${bad[0]}`);
      return { cases };
    },
  },
];
