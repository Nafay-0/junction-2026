/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: reads untyped JSON replies. */
/**
 * A conversation driven over HTTP as a signed-in test account (the kitchen's own person), printing each reply:
 *
 *   pnpm tsx eval/thread/say.ts kahvila-sointu "burger buns for 40 on Tuesday" "yes" "yes" "yes"
 *
 * With --check rules-draft: the refusal offers to draft the change, the yes drafts it, the next yes confirms it, and the
 * agent never says it cannot do what it offered (exit 1 otherwise).
 */
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
(async () => {
  const base = "http://localhost:4522";
  const expects = process.argv.flatMap((a, i, all) => (all[i - 1] === "--expect" ? [new RegExp(a, "i")] : []));
  const args = process.argv.slice(2).filter((a, i, all) => a !== "--check" && all[i + 1] !== undefined || true).filter((a, i, all) => !["--check", "--expect", "--lang"].includes(a) && !["--check", "--expect", "--lang"].includes(all[i - 1]));
  const lang = process.argv.includes("--lang") ? process.argv[process.argv.indexOf("--lang") + 1] : "en";
  const check = process.argv.includes("--check") ? process.argv[process.argv.indexOf("--check") + 1] : undefined;
  const slug = args[0] ?? "kahvila-sointu";
  const lines: { line: string; cards: string }[] = [];
  const acc = TEST_ACCOUNTS.find((a) => a.username === slug)!;
  const r0 = await fetch(`${base}/ui-api/account/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: acc.username, password: acc.password }) });
  const cookie = (r0.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const call = (m: string, p: string, b?: unknown) => fetch(`${base}${p}`, { method: m, headers: { "content-type": "application/json", cookie }, ...(b ? { body: JSON.stringify(b) } : {}) }).then((r) => r.json());
  await call("POST", `/ui-api/kitchens/${slug}/thread/reset`, {});
  for (const text of args.slice(1)) {
    const sent = await call("POST", `/ui-api/kitchens/${slug}/thread/turns`, { door: "typed", via: "typed", text, lang });
    let a: any;
    for (let i = 0; i < 240; i++) { await new Promise((r) => setTimeout(r, 500)); const t = (await call("GET", `/ui-api/kitchens/${slug}/thread`)).thread; a = t.turns.find((x: any) => x.turnId === sent.agentTurnId); if (a && a.status !== "working") break; }
    const cards = (a?.cards ?? []).map((c: any) => c.type + (c.proposal ? `:${c.proposal.state}` : "")).join(",");
    lines.push({ line: a?.line ?? "", cards });
    console.log(`> ${text}\n  [${a?.status}; ${cards}] ${a?.line ?? ""}`);
  }
  // --expect: each pattern must be in the last reply (a guard's reply carries both figures, for instance).
  if (expects.length) {
    const last = lines.at(-1)?.line ?? "";
    const missing = expects.filter((re) => !re.test(last));
    console.log(missing.length ? `expect: FAIL (missing ${missing.map((r) => r.source).join(", ")})` : "expect: PASS");
    if (missing.length) process.exit(1);
  }
  if (check === "rules-draft") {
    const broken = lines.some((l) => /can't (send|draft|set)|cannot (send|draft)|not a change I can/i.test(l.line));
    const ok = /draft/i.test(lines[0]?.line ?? "") && /rules:open/.test(lines[1]?.cards ?? "") && /rules now|now (include|part)|now allow/i.test(lines[2]?.line ?? "") && !broken;
    console.log(ok ? "rules-draft: PASS" : "rules-draft: FAIL");
    process.exit(ok ? 0 : 1);
  }
})();
