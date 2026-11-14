/**
 * The agent thread end to end in-process, no browser: `pnpm tsx scripts/thread-smoke.ts kaari "100 litres of lactose-free milk for Thursday" ["the second one" ...]`.
 * Prints every event as it arrives with milliseconds since the turn was sent. Real models (costs a few cents).
 */
import { loadLocalEnv } from "./lib/env";
loadLocalEnv();

async function main() {
  const [kitchen = "kaari", ...turns] = process.argv.slice(2);
  const { submitTurn, threadStore } = await import("@/server/thread/engine");
  const store = await threadStore();
  for (const text of turns.length ? turns : ["I need 1,000 litres of lactose-free milk by Monday"]) {
    if (text === "@approve") {
      // The approver signs on their phone: here with the one-time link token the outbox holds (the demo kitchens' way).
      const rt = await (await import("@/server/runtime")).getRuntime();
      const m = rt.outbox.messages().at(-1)!;
      const token = /[?&]t(?:oken)?=([^&]+)/.exec(m.link)?.[1] ?? m.link.split("/").at(-1)!;
      const t0 = Date.now();
      const waitLine = new Promise<void>((done) => {
        const off = store.subscribe(kitchen, (e) => {
          const ms = Date.now() - t0;
          if (e.type === "card") console.log(`${String(ms).padStart(6)} card  ${e.card.type} ${JSON.stringify(e.card).slice(0, 200)}`);
          if (e.type === "line") console.log(`${String(ms).padStart(6)} line  ${e.text}`);
          if (e.type === "status" && e.status === "done") {
            off();
            done();
          }
        });
      });
      console.log(`\n>>> approver signs ${m.approvalId} (${m.link})`);
      await rt.dock.decideApproval(m.approvalId, { decision: "approve", proof: { kind: "link_token", token: decodeURIComponent(token) } });
      await Promise.race([waitLine, new Promise((r) => setTimeout(r, 20_000))]);
      continue;
    }
    const t0 = Date.now();
    let agentTurnId = "";
    console.log(`\n>>> ${text}`);
    const finished = new Promise<void>((done) => {
      const off = store.subscribe(kitchen, (e) => {
        const ms = Date.now() - t0;
        if (e.type === "step") console.log(`${String(ms).padStart(6)} step  ${e.step.status.padEnd(8)} ${e.step.label}${e.step.detail ? ` (${e.step.detail})` : ""}`);
        else if (e.type === "card") console.log(`${String(ms).padStart(6)} card  ${e.card.type} ${JSON.stringify(e.card).slice(0, process.env.THREAD_SMOKE_FULL ? undefined : 260)}`);
        else if (e.type === "line") console.log(`${String(ms).padStart(6)} line  ${e.text}`);
        else if (e.type === "status") {
          console.log(`${String(ms).padStart(6)} status ${e.status} ${JSON.stringify(e.marks ?? {})}`);
          if (e.turnId === agentTurnId && e.status !== "working") {
            off();
            done();
          }
        }
      });
    });
    // "@choose": the first menu offered; "@menu": put the open menu card on the order sheet; "@sheet": place the open order sheet.
    const held = store.peek(kitchen);
    const cards = held && text.startsWith("@") ? store.cards(held).map((x) => x.card) : [];
    const menu = text === "@menu" || text === "@choose" ? cards.filter((c) => c.type === "menu" && !c.sheetId).at(-1) : undefined;
    const sheet = text === "@sheet" ? cards.filter((c) => c.type === "sheet" && c.state === "editing").at(-1) : undefined;
    const body =
      menu?.type === "menu" && text === "@choose"
        ? { door: "typed", via: "tap", action: { type: "menu_choose", planId: menu.planId, proposalId: menu.proposals[0]?.proposalId ?? "p1" }, label: "Cook this" }
        : menu?.type === "menu"
        ? { door: "typed", via: "tap", action: { type: "menu_to_sheet", planId: menu.planId }, label: "Put on the order sheet" }
        : sheet?.type === "sheet"
          ? { door: "typed", via: "tap", action: { type: "sheet_place", sheetId: sheet.sheetId, version: sheet.version }, label: "Place the order" }
          : text.startsWith("{")
            ? JSON.parse(text)
            : { door: "typed", via: "typed", text };
    const reply = await submitTurn(kitchen, body);
    agentTurnId = reply.agentTurnId;
    console.log(`       accepted in ${Date.now() - t0} ms`);
    await finished;
  }
  const t = store.peek(kitchen)!;
  const rt0 = await (await import("@/server/runtime")).getRuntime();
  for (const e of rt0.dock.ledger.entries({}).filter((x) => x.type === "agent" && (x.data as { event?: string }).event === "menu")) console.log("menu record:", JSON.stringify((e.data as Record<string, unknown>).shown), JSON.stringify((e.data as Record<string, unknown>).planner));
  console.log("\nledger agent entries:", (await (await import("@/server/runtime")).getRuntime()).dock.ledger.entries({}).filter((e) => e.type === "agent").length, "thread", t.threadId);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
