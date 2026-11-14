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
  const args = process.argv.slice(2).filter((a, i, all) => a !== "--check" && all[i - 1] !== "--check");
  const check = process.argv.includes("--check") ? process.argv[process.argv.indexOf("--check") + 1] : undefined;
  const slug = args[0] ?? "kahvila-sointu";
  const lines: { line: string; cards: string }[] = [];
  const acc = TEST_ACCOUNTS.find((a) => a.username === slug)!;
  const r0 = await fetch(`${base}/ui-api/account/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: acc.username, password: acc.password }) });
  const cookie = (r0.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const call = (m: string, p: string, b?: unknown) => fetch(`${base}${p}`, { method: m, headers: { "content-type": "application/json", cookie }, ...(b ? { body: JSON.stringify(b) } : {}) }).then((r) => r.json());
  await call("POST", `/ui-api/kitchens/${slug}/thread/reset`, {});
  for (const text of args.slice(1)) {
    const sent = await call("POST", `/ui-api/kitchens/${slug}/thread/turns`, { door: "typed", via: "typed", text, lang: "en" });
    let a: any;
    for (let i = 0; i < 240; i++) { await new Promise((r) => setTimeout(r, 500)); const t = (await call("GET", `/ui-api/kitchens/${slug}/thread`)).thread; a = t.turns.find((x: any) => x.turnId === sent.agentTurnId); if (a && a.status !== "working") break; }
    const cards = (a?.cards ?? []).map((c: any) => c.type + (c.proposal ? `:${c.proposal.state}` : "")).join(",");
    lines.push({ line: a?.line ?? "", cards });
    console.log(`> ${text}\n  [${a?.status}; ${cards}] ${a?.line ?? ""}`);
  }
  if (check === "rules-draft") {
    const broken = lines.some((l) => /can't (send|draft|set)|cannot (send|draft)|not a change I can/i.test(l.line));
    const ok = /draft/i.test(lines[0]?.line ?? "") && /rules:open/.test(lines[1]?.cards ?? "") && /rules now|now (include|part)|now allow/i.test(lines[2]?.line ?? "") && !broken;
    console.log(ok ? "rules-draft: PASS" : "rules-draft: FAIL");
    process.exit(ok ? 0 : 1);
  }
})();
