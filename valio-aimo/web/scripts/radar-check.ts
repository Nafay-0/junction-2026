/**
 * The recall radar, once, against the real sources: the opt-in live check (tests never touch the network).
 *
 *   pnpm radar:check              check every source now, read new notices, match, print what matched
 *   pnpm radar:check ruokavirasto-fi rasff
 *   pnpm radar:check --rematch     run matching again on notices already read (undecided matches only)
 *
 * Uses CONTEXT_DEV_API_KEY and EXA_API_KEY from .env.local and writes the same state file the server reads
 * (.data/radar/state.json), so a server started afterwards does not read the same notices again.
 */
import { loadLocalEnv } from "./lib/env";

async function main() {
  loadLocalEnv();
  process.env.RADAR_POLL = "off";
  const { getRuntime } = await import("@/server/runtime");
  const { radar } = await import("@/server/radar/registry");
  const { SOURCES } = await import("@/server/radar/sources");
  const { radarStore } = await import("@/server/radar/store");
  const rt = await getRuntime();
  const r = radar(rt);
  const args = process.argv.slice(2);
  if (args.includes("--rematch")) console.log("rematched:", await r.rematchAll());
  const wanted = args.filter((a) => !a.startsWith("--"));
  const ids = SOURCES.filter((s) => !s.drill && (!wanted.length || wanted.includes(s.id))).map((s) => s.id);
  for (const id of ids) {
    const t = Date.now();
    const st = await r.checkSource(id, { force: true });
    console.log(`${id}: ${st.status} in ${Math.round((Date.now() - t) / 1000)} s, ${st.listedLastTime ?? 0} listed, ${st.noticesRead} read${st.lastError ? ` (${st.lastError})` : ""}`);
  }
  await r.ensureMonitors();
  await r.pollMonitors();
  await new Promise((ok) => setTimeout(ok, 8000)); // corroboration searches run in the background
  const s = r.state;
  const real = s.notices.filter((n) => !n.drill && n.state === "read");
  const matched = new Set(s.matches.filter((m) => !m.drill).map((m) => m.noticeId));
  console.log(`\n${real.length} real notices read; ${matched.size} matched anything in the assortment.`);
  for (const m of s.matches.filter((x) => !x.drill)) {
    const n = s.notices.find((x) => x.noticeId === m.noticeId)!;
    console.log(`- ${n.publishedOn} ${n.sourceId}: "${n.title}" -> ${m.productId} ${m.strength} (${m.basis}), ${m.status}${m.holdId ? ", HELD" : ""}`);
  }
  const unreadable = s.notices.filter((n) => n.state === "unreadable");
  console.log(`\nunreadable: ${unreadable.length ? unreadable.map((n) => `${n.url}: ${n.readError}`).join("\n  ") : "none"}`);
  console.log(`corroborated: ${s.notices.filter((n) => n.corroboration.length).length}`);
  console.log(`spend: ${s.spend.contextDevCredits} Context.dev credits (${s.spend.contextDevCalls} calls, ${s.spend.contextDevRemaining ?? "?"} left), $${s.spend.exaDollars} Exa (${s.spend.exaCalls} searches)`);
  radarStore(rt.dock).flush();
  process.exit(0);
}

void main();
