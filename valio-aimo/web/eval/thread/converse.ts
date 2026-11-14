/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: reads untyped JSON replies. */
/**
 * One conversation as a signed-in test account, against any running server, printing and saving every reply as the
 * buyer reads it (the agent's line, the cards beside it, the seconds it took):
 *
 *   pnpm tsx eval/thread/converse.ts --url http://localhost:4780 --kitchen hotel-lumo --lang en \
 *        --out /tmp/c1.json "20 l lactose free milk for friday" "the first one"
 *
 * Used to read a build's replies against the agent's playbook (src/server/thread/instructions.ts). It starts the
 * conversation over ("Start over") unless --keep is given. No checks: a person, or a reviewer, reads the output.
 */
import { writeFileSync } from "node:fs";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

(async () => {
  const argv = process.argv.slice(2);
  const flag = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const base = flag("--url") ?? "http://localhost:4780";
  const slug = flag("--kitchen") ?? "hotel-lumo";
  const lang = flag("--lang") ?? "en";
  const out = flag("--out");
  const keep = argv.includes("--keep");
  const says = argv.filter((a, i) => !a.startsWith("--") && !["--url", "--kitchen", "--lang", "--out"].includes(argv[i - 1] ?? ""));
  const acc = TEST_ACCOUNTS.find((a) => a.username === slug);
  if (!acc) throw new Error(`not a test account: ${slug}`);
  const r0 = await fetch(`${base}/ui-api/account/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: acc.username, password: acc.password }) });
  const cookie = (r0.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const call = (m: string, p: string, b?: unknown) => fetch(`${base}${p}`, { method: m, headers: { "content-type": "application/json", cookie }, ...(b ? { body: JSON.stringify(b) } : {}) }).then((r) => r.json() as Promise<any>);
  if (!keep) await call("POST", `/ui-api/kitchens/${slug}/thread/reset`, {});
  const turns: { said: string; reply: string; status: string; cards: string[]; seconds: number }[] = [];
  for (const text of says) {
    const t0 = Date.now();
    const sent = await call("POST", `/ui-api/kitchens/${slug}/thread/turns`, { door: "typed", via: "typed", text, lang });
    let a: any;
    for (let i = 0; i < 360; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const t = (await call("GET", `/ui-api/kitchens/${slug}/thread`)).thread;
      a = t?.turns?.find((x: any) => x.turnId === sent?.agentTurnId);
      if (a && a.status !== "working") break;
    }
    const cards: string[] = (a?.cards ?? []).map((c: any) => c.type + (c.stage ? `:${c.stage}` : "") + (c.state ? `:${c.state}` : "") + (c.outcome ? `:${c.outcome}` : "") + (c.status ? `:${c.status}` : ""));
    const row = { said: text, reply: a?.line ?? "", status: a?.status ?? "none", cards, seconds: Math.round((Date.now() - t0) / 100) / 10 };
    turns.push(row);
    console.log(`> ${text}\n  [${row.status}; ${row.seconds} s; ${cards.join(",")}]\n  ${row.reply}\n`);
  }
  if (out) writeFileSync(out, JSON.stringify({ url: base, kitchen: slug, lang, turns }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
