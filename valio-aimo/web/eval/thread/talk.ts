/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: reads untyped JSON replies. */
/**
 * converse.ts with the steps: one conversation as a test account, printing each reply, its cards and its steps (label,
 * detail), for reading why a turn went the way it did.
 *
 *   pnpm tsx eval/thread/talk.ts --url http://localhost:4820 --kitchen kahvila-sointu --lang en "2 kg of butter" "yes"
 */
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

(async () => {
  const argv = process.argv.slice(2);
  const flag = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const base = flag("--url") ?? "http://localhost:4820";
  let slug = flag("--kitchen") ?? "hotel-lumo";
  const lang = flag("--lang") ?? "en";
  const quiet = argv.includes("--quiet");
  const says = argv.filter((a, i) => !a.startsWith("--") && !["--url", "--kitchen", "--lang"].includes(argv[i - 1] ?? ""));
  let cookie = "";
  // --kitchen fresh: a fresh kitchen of its own (no rules, a high limit), started as a visitor would.
  if (slug === "fresh") {
    const r0 = await fetch(`${base}/ui-api/account/fresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fresh: true }) });
    cookie = (r0.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    slug = String(((await r0.json()) as any).next ?? "").split("/").filter(Boolean).at(-1) ?? "";
    console.log(`fresh kitchen: ${slug}`);
  } else {
    const acc = TEST_ACCOUNTS.find((a) => a.username === slug);
    if (!acc) throw new Error(`not a test account: ${slug}`);
    const r0 = await fetch(`${base}/ui-api/account/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: acc.username, password: acc.password }) });
    cookie = (r0.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }
  const call = (m: string, p: string, b?: unknown) => fetch(`${base}${p}`, { method: m, headers: { "content-type": "application/json", cookie }, ...(b ? { body: JSON.stringify(b) } : {}) }).then((r) => r.json() as Promise<any>);
  if (!argv.includes("--keep")) await call("POST", `/ui-api/kitchens/${slug}/thread/reset`, {});
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
    const cards: string[] = (a?.cards ?? []).map((c: any) => c.type + (c.stage ? `:${c.stage}` : "") + (c.kind ? `:${c.kind}` : "") + (c.outcome ? `:${c.outcome}` : "") + (c.status ? `:${c.status}` : ""));
    console.log(`> ${text}\n  [${a?.status}; ${Math.round((Date.now() - t0) / 100) / 10} s; ${cards.join(",")}]\n  ${a?.line ?? ""}`);
    if (!quiet) {
      for (const s of a?.steps ?? []) console.log(`    · ${s.kind} ${s.status}: ${s.label}${s.detail ? ` | ${String(s.detail).slice(0, 400)}` : ""}`);
      for (const c of a?.cards ?? []) if (c.type === "notice" || c.type === "understood" || c.type === "anomaly") console.log(`    ${c.type}: ${JSON.stringify(c).slice(0, 600)}`);
      for (const c of a?.cards ?? []) if (c.type === "options") console.log(`    options: ${c.options.map((o: any) => `${o.title} ${o.totalCents} ${o.deliveryDate} ${o.lines.map((l: any) => `${l.quantity}x${l.packSize}${l.unit}`).join("+")} [${o.match}; ${(o.givesUp ?? []).join("; ")}]`).join(" | ")}\n    excluded: ${JSON.stringify(c.excluded).slice(0, 700)}`);
      for (const c of a?.cards ?? []) if (c.type === "sheet" || c.type === "order") console.log(`    ${c.type}: ${JSON.stringify(c.lines?.map((l: any) => [l.name, l.packs ?? l.quantity, l.packSize, l.unit]))} ${c.totalCents} ${c.deliveryDate} ${c.status ?? c.state ?? ""}`);
    }
    console.log("");
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
