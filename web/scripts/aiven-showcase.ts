/**
 * The Aiven showcase from the command line (the operations portal's Platform section does the same from a page).
 *
 *   pnpm aiven:showcase launch [valio|within|refused]   start the Aiven Managed Agent buyer and follow it to the end
 *   pnpm aiven:showcase record <agentId> <sessionId> [preset]
 *                                                      save a finished session as the recording the page plays when
 *                                                      the day's runs are used (src/server/aiven/showcase/recordings/)
 *   pnpm aiven:showcase ask "<question>"               ask the operations copilot, print the card
 *   pnpm aiven:showcase mcp                            is the Aiven MCP server on, and what can it do with our token
 *
 * Reads web/.env.local. Prints no secrets (every card and message is redacted the way the page shows them).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { showcaseConfig } = await import("@/server/aiven/showcase/config");
  if (cmd === "launch") {
    const { launch, getRun } = await import("@/server/aiven/showcase/launcher");
    const r = await launch((rest[0] as "valio") ?? "valio", { by: "command line" });
    if ("refused" in r) throw new Error(r.refused.reason);
    console.log(`${r.run.recorded ? "RECORDING" : "live run"} ${r.run.runId}: "${r.run.question}"`);
    let shown = 0;
    for (;;) {
      const run = getRun(r.run.runId)!;
      for (const m of run.messages.slice(shown)) console.log(`  ${m.at.slice(11, 19)} ${m.type.padEnd(11)} ${m.tool ?? ""} ${m.text.replace(/\s+/g, " ").slice(0, 160)}`);
      shown = run.messages.length;
      if (run.status === "done" || run.status === "failed") {
        console.log(`\n${run.status}: request ${run.requestId ?? "-"}, order ${run.orderId ?? "-"}, outcome ${run.outcome ?? "-"}${run.error ? `\n${run.error}` : ""}${run.usage ? `\nusage ${JSON.stringify(run.usage)}` : ""}`);
        console.log(`session ${run.sessionId ?? "-"}`);
        break;
      }
      await new Promise((res) => setTimeout(res, 2_000));
    }
    return;
  }
  if (cmd === "record") {
    const [agentId, sessionId, preset = "valio"] = rest;
    const cfg = showcaseConfig();
    const { aivenApi } = await import("@/server/aiven/showcase/aiven-api");
    const { toRunMessages, outcomeOf, PRESETS } = await import("@/server/aiven/showcase/launcher");
    const r = await aivenApi<{ messages: Parameters<typeof toRunMessages>[0] }>(cfg.readToken!, "GET", `/organization/${cfg.organization}/project/${cfg.project}/managed-agents/agent/${agentId}/session/${sessionId}/message`);
    const messages = toRunMessages(r.messages);
    const agent = await aivenApi<{ model: string }>(cfg.readToken!, "GET", `/organization/${cfg.organization}/project/${cfg.project}/managed-agents/agent/${agentId}`);
    const rec = { recordedAt: messages[0]?.at ?? new Date().toISOString(), preset, question: PRESETS.find((p) => p.id === preset)?.message ?? messages[0]?.text, model: agent.model, messages, ...outcomeOf(messages) };
    const file = path.resolve("src/server/aiven/showcase/recordings", `${preset}.json`);
    writeFileSync(file, JSON.stringify(rec, null, 1) + "\n");
    console.log(`wrote ${file}: ${messages.length} messages, outcome ${rec.outcome ?? "-"}`);
    return;
  }
  if (cmd === "ask") {
    const { ask } = await import("@/server/aiven/showcase/copilot");
    const card = await ask(rest.join(" "));
    console.log(`${card.answer}\n[${card.path}] ${card.pathNote}`);
    for (const s of card.steps) {
      console.log(`\n-- ${s.label} (${s.kind}, ${s.path}${s.as ? `, as ${s.as}` : ""}${s.ms !== undefined ? `, ${s.ms} ms` : ""})\n${s.query}`);
      if (s.error) console.log(`error: ${s.error}`);
      else console.table(s.rows.slice(0, 12));
    }
    return;
  }
  if (cmd === "mcp") {
    const { mcpStatus } = await import("@/server/aiven/showcase/aiven-mcp");
    console.log(await mcpStatus(true));
    return;
  }
  console.log("usage: pnpm aiven:showcase launch|record|ask|mcp");
}

main()
  .then(async () => {
    const { shutdownAiven } = await import("@/server/aiven");
    await shutdownAiven();
    process.exit(0);
  })
  .catch((err) => {
    console.error(`aiven:showcase failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
