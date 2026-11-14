/**
 * Play the week in-process against whatever catalogue this machine runs (the partner's real one when the index and
 * VALIO_API_KEY are present), printing each day as it lands. A passkey made by a software authenticator plays the
 * visitor's phone, so the sign-off is a real WebAuthn assertion bound to the order.
 *
 *   pnpm exec tsx scripts/show/week-live.ts            sign Thursday's order
 *   pnpm exec tsx scripts/show/week-live.ts --nobody   let the sign-off time out (the agent withdraws the order)
 */
import * as approvalRoute from "@/app/api/v1/approvals/[approvalId]/route";
import * as challengeRoute from "@/app/api/v1/approvals/[approvalId]/challenge/route";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import type { DockEvent } from "@/core/events";
import { shutdownAiven } from "@/server/aiven";
import { getRuntime } from "@/server/runtime";
import { startWeek, weekDone } from "@/server/show/registry";
import { TEST_PACE } from "@/server/show/week";
import { loadLocalEnv } from "../lib/env";

loadLocalEnv();
const nobody = process.argv.includes("--nobody");
const ORIGIN = "https://dock.test";

async function main() {
  const rt = await getRuntime();
  console.log(`catalogue: ${rt.catalogSource.kind}`);
  const auth = new SoftwareAuthenticator(ORIGIN);
  const rp = { id: "dock.test", name: "Dock", origins: [ORIGIN] };
  const { options } = await rt.sandboxes.beginJoin(rp);
  const { sandbox } = await rt.sandboxes.completeJoin(auth.register(options) as never);
  if (!nobody) {
    rt.events.subscribe(
      (e: DockEvent) => e.type === "approval_requested" && e.orgId === sandbox.orgId,
      (e) =>
        void (async () => {
          const approvalId = e.approvalId!;
          const post = (path: string, body: unknown) => new Request(ORIGIN + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          const ch = (await (await challengeRoute.POST(post(`/api/v1/approvals/${approvalId}/challenge`, { decision: "approve" }), { params: Promise.resolve({ approvalId }) })).json()) as { options: never };
          await approvalRoute.POST(post(`/api/v1/approvals/${approvalId}`, { decision: "approve", proof: { kind: "webauthn", response: auth.assert(ch.options) } }), { params: Promise.resolve({ approvalId }) });
          console.log(`  (phone) approved ${approvalId} with the passkey`);
        })(),
    );
  }
  const t0 = Date.now();
  const run = await startWeek(rt, { sandboxId: sandbox.sandboxId, pace: TEST_PACE, signOffTimeoutMs: nobody ? 1500 : 4000 });
  const done = (await weekDone(run.runId))!;
  for (const s of done.steps) {
    console.log(`\n${s.day.padEnd(9)} ${s.title}  [${s.status}]  delivery ${s.delivery}  live calls ${s.liveCalls}`);
    console.log(`  asked: ${s.asked}`);
    for (const d of s.did) console.log(`  - ${d}`);
    for (const m of s.memory) console.log(`  memory: ${m}`);
    if (s.concern) console.log(`  concern ${s.concern.code}: ${s.concern.message}\n    -> ${s.concern.answer}`);
    for (const o of s.options) console.log(`  [${o.rank}${o.chosen ? " *" : ""}] ${o.title} ${o.totalCents / 100} € ${o.labels.join(",")}`);
    for (const e of s.excluded) console.log(`  excluded${e.simulated ? " (SIMULATED)" : ""}: ${e.name}: ${e.reason}`);
    if (s.gate) console.log(`  gate: ${s.gate.outcome} ${s.gate.rule ?? ""}: ${s.gate.reasons[0]}`);
    if (s.signOff) console.log(`  sign-off: ${s.signOff.state}`);
    if (s.order) console.log(`  order: ${s.order.status} ${s.order.totalCents / 100} €`);
    if (s.note) console.log(`  note: ${s.note}`);
  }
  console.log(`\n${done.state} in ${((Date.now() - t0) / 1000).toFixed(1)} s; tally ${JSON.stringify(done.tally)}; partner calls ${done.liveCalls}`);
  console.log(`clean-up: ${done.cleanup?.join(" ")}`);
}
main()
  .then(() => shutdownAiven())
  .then(() => process.exit(0)) // the recall radar keeps a timer: exit when the week is done
  .catch((e) => (console.error(e), process.exit(1)));
