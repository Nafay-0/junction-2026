import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
(async () => {
  const base = "http://localhost:4522"; const slug = "hotel-lumo";
  const acc = TEST_ACCOUNTS.find((a) => a.username === slug)!;
  const r0 = await fetch(`${base}/ui-api/account/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: acc.username, password: acc.password }) });
  const cookie = (r0.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const reset = await fetch(`${base}/ui-api/kitchens/${slug}/thread/reset`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" }).then((r) => r.json());
  console.log("after reset turns:", JSON.stringify(reset).slice(0, 300));
  for (const ms of [500, 3000, 8000]) {
    await new Promise((r) => setTimeout(r, ms));
    const t = await fetch(`${base}/ui-api/kitchens/${slug}/thread`, { headers: { cookie } }).then((r) => r.json());
    const today = t.thread.turns.flatMap((x: any) => x.cards ?? []).find((c: any) => c.type === "today");
    console.log(ms, "today:", JSON.stringify(today ? { pending: today.pending, items: today.items.map((i: any) => i.kind) } : null));
  }
})();
