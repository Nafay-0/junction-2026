/**
 * The audit time machine on MariaDB, reproduced with one command (from web/):
 *
 *   pnpm mariadb:reproduce
 *
 * Starts the pinned MariaDB container (infra/mariadb/compose.yaml, MariaDB 12.3 LTS), resets its database, seeds
 * three and a half weeks of a school kitchen's rules changing through the real order flow, then prints the answers
 * (the rules then and now, what changed and who changed it, and the real gate run again on past orders) and the
 * measurements: rows, history kept, and query times for the as-of queries and the combined vector query.
 *
 *   --no-docker        use DOCK_MARIADB_URL (or the default address) without starting the container
 *   --force            reset a database that is not on this machine (never needed for the container)
 *   --no-vectors       skip the embeddings even when OPENAI_API_KEY is set
 *   --scale=N          also time AS OF over a table with N history versions (default 100000; 0 skips)
 *   --runs=N           timing runs per query (default 200)
 *
 * Reads web/.env.local if present (for OPENAI_API_KEY), never prints a secret.
 */
import { MariaStore } from "../src/server/history/maria-store";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { attr, eurShort } from "../src/app/_ui/plain";
import { connectMaria, sqlTime, type Maria } from "../src/server/mariadb/client";
import { MARIADB_ENV, isLocalHost, parseMariaUrl } from "../src/server/mariadb/config";
import { SQL_RULES_AS_OF, SQL_CHANGES } from "../src/server/mariadb/history";
import { AURINKO, SCENARIO_WRITER, runScenario } from "../src/server/mariadb/scenario";
import { VERSIONED, dropSchema, ensureSchema } from "../src/server/mariadb/schema";
import { justBefore, timeMachineView } from "../src/server/mariadb/service";
import { SQL_SIMILAR, decisionDoc, embeddingOfOrder, embeddingTokens, indexDecisions, keywordSearch, openAiEmbedder, similarTo, vecText } from "../src/server/mariadb/vector";
import { outcomeWord, title, when } from "../src/server/mariadb/words";

const DEFAULT_URL = "mariadb://dock:dock@127.0.0.1:3407/dock_audit";
const args = new Set(process.argv.slice(2));
const opt = (name: string, dflt: number) => Number([...args].find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? dflt);
const envFile = path.resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const out = (s = "") => console.log(s);
const h = (s: string) => out(`\n== ${s} ${"=".repeat(Math.max(0, 100 - s.length))}`);

function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: q(0.5), p95: q(0.95), n: s.length };
}
const f2 = (n: number) => n.toFixed(2);

async function time(db: Maria, runs: number, sql: string, params: unknown[]) {
  for (let i = 0; i < 5; i++) await db.query(sql, params); // warm
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) ms.push((await db.query(sql, params)).ms);
  return stats(ms);
}

async function main() {
  const url = process.env[MARIADB_ENV]?.trim() || DEFAULT_URL;
  const cfg = parseMariaUrl(url);
  if (!args.has("--no-docker")) {
    out("Starting MariaDB (infra/mariadb/compose.yaml) ...");
    execFileSync("docker", ["compose", "-f", path.resolve(process.cwd(), "../infra/mariadb/compose.yaml"), "up", "-d", "--wait"], { stdio: "inherit" });
  }
  if (!isLocalHost(cfg.host) && !args.has("--force")) throw new Error(`Refusing to reset ${cfg.display}: not on this machine. Pass --force if that database is yours to reset.`);
  const db = connectMaria(url, { connections: 4, timeoutMs: 8000 });
  const runs = opt("runs", 200);
  try {
    const version = String((await db.query("SELECT VERSION() AS v")).rows[0].v);
    out(`Connected to ${cfg.display}, MariaDB ${version}.`);
    await dropSchema(db);
    await ensureSchema(db);

    h("Seeding the scenario through the real order flow");
    const t0 = performance.now();
    const sc = await runScenario(new MariaStore(db), { log: out });
    out(`Seeded in ${Math.round(performance.now() - t0)} ms: ${sc.counts.orders} orders, ${sc.counts.decisions} gate decisions, ${sc.counts.refusals} calls refused before an order, ${sc.counts.syncs} mirror transactions (${sc.counts.rows.insert} inserts, ${sc.counts.rows.update} updates, ${sc.counts.rows.touch} quiet updates, ${sc.counts.rows.delete} deletes).`);
    out(`Scenario starts ${when(sc.anchor)} (Helsinki); every row's ROW_START is the scenario's own moment.`);

    const now = new Date();
    const B = await timeMachineView(new MariaStore(db), { orderId: sc.orders.B, now });

    h(`The rules for ${AURINKO.name} the instant before order B (${when(B.at)}) and now`);
    const side = (rows: typeof B.rulesAt) => rows.flatMap((r) => [`  ${r.title}  (since ${when(r.since)}, by ${r.by})`, ...r.lines.map((l) => `      ${l}`)]);
    out("THEN");
    side(B.rulesAt).forEach((l) => out(l));
    out("NOW");
    side(B.rulesNow).forEach((l) => out(l));
    out(`\n  One statement each:\n${SQL_RULES_AS_OF.replace(/^/gm, "    ")}`);

    h("What changed in between, who changed it, when");
    for (const c of B.changes) out(`  ${c.when.padEnd(14)} ${c.area.padEnd(13)} ${c.what}  [${c.by}]`);
    out(`\n  One statement:\n${SQL_CHANGES.replace(/^/gm, "    ")}`);

    h("Would it pass today? The real gate (core/policy.ts evaluatePolicy), run again");
    const verdictLine = (label: string, v: NonNullable<typeof B.replay>["then"]) => `  ${label.padEnd(30)} ${outcomeWord(v.outcome)}`;
    for (const letter of ["A", "B", "D"] as const) {
      const v = await timeMachineView(new MariaStore(db), { orderId: sc.orders[letter], now });
      const r = v.replay!;
      out(`\nOrder ${letter}: ${v.order?.summary} (${eurShort(v.order?.totalCents ?? 0)}), placed ${when(v.order!.body.createdAt)}`);
      out(`  recorded then by the gate     ${v.order?.body.recorded.outcome}  -> replay reproduces it: ${r.reproduces.same ? "yes" : `NO (${r.reproduces.rules.join(", ")})`}; mirror terms match the order's own mandate: ${r.termsDisagree.length ? `NO (${r.termsDisagree.join(", ")})` : "yes"}`);
      out(verdictLine("with the rules then", r.then));
      out(verdictLine("with today's rules", r.now));
      for (const d of r.thenVsNow) out(`    differs: ${title(d.rule)} [${d.rule}]: ${d.then?.outcome ?? "-"} -> ${d.at?.outcome ?? "-"}. Today: ${d.at?.reason ?? ""}`);
      if (!r.thenVsNow.length) out("    no rule differs");
      out(`  kitchen reads: ${r.kitchenSentence}`);
    }
    const holdAt = sc.moments.find((m) => m.label.startsWith("Recall drill"))!.at;
    const suspendedAt = sc.moments.find((m) => m.label === "Agent suspended")!.at;
    for (const [label, at] of [["during the recall drill", new Date(Date.parse(holdAt) + 3600_000).toISOString()], ["while the agent was suspended", new Date(Date.parse(suspendedAt) + 1800_000).toISOString()]] as const) {
      const v = await timeMachineView(new MariaStore(db), { orderId: sc.orders.D, at, now });
      out(`\nOrder D slid to ${when(at)} (${label}): ${outcomeWord(v.replay!.at.outcome)}`);
      for (const d of v.replay!.atVsNow) out(`    differs from now: ${title(d.rule)} [${d.rule}]: ${d.then?.outcome} then, ${d.at?.outcome} now. ${d.then?.reason ?? ""}`);
    }

    h("Measurements");
    out("Rows now and versions kept (history = all versions minus current rows):");
    let total = 0;
    for (const t of VERSIONED) {
      const cur = Number((await db.query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n);
      const all = Number((await db.query(`SELECT COUNT(*) AS n FROM ${t} FOR SYSTEM_TIME ALL`)).rows[0].n);
      total += all;
      out(`  ${t.padEnd(20)} ${String(cur).padStart(6)} current  ${String(all - cur).padStart(6)} history`);
    }
    const size = (await db.query("SELECT table_name AS t, data_length + index_length AS b FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type IN ('BASE TABLE', 'SYSTEM VERSIONED') ORDER BY t")).rows;
    out(`  on disk (data + indexes, InnoDB pages): ${size.map((r) => `${r.t} ${Math.round(Number(r.b) / 1024)} KiB`).join(", ")}`);
    out(`  ${total} row versions in all.`);

    out(`\nQuery times, ${runs} runs each after 5 warm-up runs, median and p95, measured in Node around pool.query (network round trip to the container included):`);
    const before = sqlTime(justBefore(B.order!.body.createdAt));
    const q1 = await time(db, runs, SQL_RULES_AS_OF, [before, AURINKO.orgId]);
    out(`  rules AS OF a past moment (view over 5 versioned tables)   median ${f2(q1.median)} ms  p95 ${f2(q1.p95)} ms`);
    const q2 = await time(db, runs, SQL_RULES_AS_OF, [sqlTime(now), AURINKO.orgId]);
    out(`  rules AS OF now                                             median ${f2(q2.median)} ms  p95 ${f2(q2.p95)} ms`);
    const q3 = await time(db, runs, SQL_CHANGES, [before, sqlTime(now), AURINKO.orgId]);
    out(`  every version FROM then TO now (the changes)                median ${f2(q3.median)} ms  p95 ${f2(q3.p95)} ms`);
    const tReplay: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t1 = performance.now();
      await timeMachineView(new MariaStore(db), { orderId: sc.orders.B, now });
      tReplay.push(performance.now() - t1);
    }
    const qr = stats(tReplay);
    out(`  the whole page answer for one order (8 statements + 3 gate runs)  median ${f2(qr.median)} ms  p95 ${f2(qr.p95)} ms (50 runs)`);

    // ---- vectors ----
    const embedder = args.has("--no-vectors") ? undefined : openAiEmbedder();
    if (!embedder) out("\nVector search skipped: no OPENAI_API_KEY (or --no-vectors).");
    else {
      h("MariaDB Vector: decisions like this one, with the rules each was judged under");
      const docs = sc.ledger.map((e) => decisionDoc(e, (id) => sc.owner.get(id))).filter((d): d is NonNullable<typeof d> => !!d);
      const tIdx = performance.now();
      const added = await indexDecisions(db, SCENARIO_WRITER, docs, embedder);
      out(`Embedded and stored ${added} decisions in ${Math.round(performance.now() - tIdx)} ms (${embedder.id}, ${embeddingTokens()} tokens so far).`);
      const vB = await embeddingOfOrder(db, sc.orders.B);
      const like = await similarTo(db, vB!, 5);
      out("Decisions like order B's:");
      for (const s of like.rows) out(`  ${s.distance.toFixed(3)}  ${when(s.at)}  ${s.outcome.padEnd(21)} [${s.rulesHit.join(", ") || "all passed"}]  limit then ${s.termsThen ? eurShort(s.termsThen.perOrderLimitCents) : "?"}, never then: ${s.termsThen ? s.termsThen.forbiddenAllergens.map(attr).join(", ") || "-" : "?"}`);
      out(`\n  One statement:\n${SQL_SIMILAR.replace(/^/gm, "    ")}`);
      const q4 = await time(db, runs, SQL_SIMILAR, [vecText(vB!), 5]);
      out(`  combined vector + FOR SYSTEM_TIME query: median ${f2(q4.median)} ms  p95 ${f2(q4.p95)} ms (${runs} runs, ${added} decisions)`);
      const plan = (await db.query(`EXPLAIN ${SQL_SIMILAR}`, [vecText(vB!), 5])).rows.map((r) => `${r.table}:${r.key ?? "-"}`).join(", ");
      out(`  EXPLAIN (table:index): ${plan}`);

      // Does it earn its place? Staff questions in their own words, judged by the rule that actually decided.
      const QUESTIONS: { q: string; want: (rules: string[], outcome: string) => boolean }[] = [
        { q: "orders stopped because the product contained something the kitchen must never serve", want: (r) => r.includes("forbidden_allergens") },
        { q: "the agent tried to buy a kind of product the kitchen does not allow", want: (r) => r.includes("category_allowed") },
        { q: "too expensive for the agent to buy on its own, a manager had to approve", want: (r) => r.includes("per_order_limit") },
        { q: "the week's money had already run out", want: (r) => r.includes("weekly_budget") },
        { q: "it would have come too late", want: (r) => r.includes("delivery_deadline") },
        { q: "a different product than the one asked for, and it cost much more", want: (r) => r.includes("substitute_price") },
        { q: "swapped brand needed someone to say yes", want: (r) => r.includes("substitution_rule") },
        { q: "small orders that together were too big", want: (r) => r.includes("order_splitting") },
        { q: "milk that was not lactose free", want: (r) => r.includes("required_attributes") },
        { q: "went through without anyone having to check", want: (_r, o) => o === "auto_approve" },
      ];
      const qv = await embedder.embed(QUESTIONS.map((x) => x.q));
      const corpus = (await db.query("SELECT rules_hit, outcome FROM gate_decision")).rows.map((x) => ({ rules: String(x.rules_hit || "").split(",").filter(Boolean), outcome: String(x.outcome) }));
      let vecHits = 0;
      let kwHits = 0;
      let ceiling = 0;
      let kwQs = 0;
      out("\nDoes it earn its place? Ten questions staff might type, precision at 5 (share of the top 5 whose deciding rule is the one asked about):");
      for (let i = 0; i < QUESTIONS.length; i++) {
        const v = await similarTo(db, qv[i], 5);
        const k = await keywordSearch(db, QUESTIONS[i].q, 5);
        const pv = v.rows.filter((x) => QUESTIONS[i].want(x.rulesHit, x.outcome)).length;
        const pk = k.rows.filter((x) => QUESTIONS[i].want(x.rulesHit, x.outcome)).length;
        const relevant = corpus.filter((x) => QUESTIONS[i].want(x.rules, x.outcome)).length;
        vecHits += pv;
        kwHits += pk;
        ceiling += Math.min(5, relevant);
        kwQs += k.rows.length ? 1 : 0;
        out(`  ${QUESTIONS[i].q.slice(0, 66).padEnd(67)} vector ${pv}/5   FULLTEXT ${pk}/5   (${relevant} relevant in the corpus)`);
      }
      out(`  Mean precision at 5: vector ${f2(vecHits / (QUESTIONS.length * 5))}, FULLTEXT keyword baseline ${f2(kwHits / (QUESTIONS.length * 5))}, best possible on this corpus ${f2(ceiling / (QUESTIONS.length * 5))} (FULLTEXT returned anything for ${kwQs} of ${QUESTIONS.length} questions).`);
      out(`  Embedding tokens spent in this run: ${embeddingTokens()} (about $${((embeddingTokens() / 1e6) * 0.02).toFixed(5)}).`);
    }

    // ---- scale ----
    const scale = opt("scale", 100_000);
    if (scale > 0) {
      h(`Scale: AS OF over one versioned table with ${scale.toLocaleString("en-US")} history versions`);
      await db.query("DROP TABLE IF EXISTS scale_mandate");
      await db.query("CREATE TABLE scale_mandate (agent_id VARCHAR(100) NOT NULL PRIMARY KEY, per_order_limit_cents BIGINT NOT NULL, changed_by VARCHAR(100) NOT NULL) WITH SYSTEM VERSIONING");
      const agents = 100;
      const conn = await db.pool.getConnection();
      const start = Date.now() / 1000 - 400 * 86_400;
      const tLoad = performance.now();
      try {
        await conn.query("SET @@timestamp = ?", [start]);
        await conn.batch("INSERT INTO scale_mandate VALUES (?, ?, ?)", Array.from({ length: agents }, (_, i) => [`agent_${i}`, 40_000, "seed"]));
        const perAgent = Math.ceil(scale / agents);
        for (let v = 1; v <= perAgent; v++) {
          await conn.query("SET @@timestamp = ?", [start + v * ((399 * 86_400) / perAgent)]);
          await conn.query("UPDATE scale_mandate SET per_order_limit_cents = per_order_limit_cents + 100, changed_by = ?", [`v${v}`]);
        }
        await conn.query("SET @@timestamp = DEFAULT");
      } finally {
        await conn.release();
      }
      const hist = Number((await db.query("SELECT COUNT(*) AS n FROM scale_mandate FOR SYSTEM_TIME ALL")).rows[0].n) - agents;
      out(`  Loaded ${hist.toLocaleString("en-US")} history versions for ${agents} agents in ${Math.round(performance.now() - tLoad)} ms (one UPDATE per version step, with @@timestamp set).`);
      const mid = sqlTime(new Date((start + 200 * 86_400) * 1000));
      const one = await time(db, runs, "SELECT per_order_limit_cents, changed_by FROM scale_mandate FOR SYSTEM_TIME AS OF TIMESTAMP ? WHERE agent_id = ?", [mid, "agent_42"]);
      out(`  one agent's terms AS OF a moment 200 days back           median ${f2(one.median)} ms  p95 ${f2(one.p95)} ms`);
      const all = await time(db, Math.min(runs, 50), "SELECT agent_id, per_order_limit_cents FROM scale_mandate FOR SYSTEM_TIME AS OF TIMESTAMP ?", [mid]);
      out(`  all ${agents} agents AS OF that moment (scan)                   median ${f2(all.median)} ms  p95 ${f2(all.p95)} ms`);
      const sz = (await db.query("SELECT data_length + index_length AS b FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'scale_mandate'")).rows[0];
      out(`  table size ${Math.round(Number(sz.b) / 1024).toLocaleString("en-US")} KiB (data and indexes). The table is dropped afterwards, so the demo database stays as seeded.`);
      await db.query("DROP TABLE scale_mandate");
    }
    out(`\nDone. Point the app at the same database to explore it on /ops/time-machine:\n  ${MARIADB_ENV}=${DEFAULT_URL.replace("dock:dock", "dock:<password>")} (the container's password is in infra/mariadb/compose.yaml)`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
