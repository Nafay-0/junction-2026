/**
 * Ten ordinary first requests per test kitchen, typed as a chef would (typos, English and Finnish), against a running
 * production build: what the agent said to each, its words, and any code in the reply. A reading aid, not a pass/fail:
 *
 *   pnpm tsx eval/thread/first-requests.ts --url http://localhost:PORT [--only hotel-lumo]
 */
import { codeLeaks } from "@/server/thread/refusal";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
import type { AgentTurn, Thread } from "@/server/thread/types";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4522")!;
const only = opt("--only")?.split(",");

const REQUESTS: Record<string, { text: string; lang: "en" | "fi" }[]> = {
  "hotel-lumo": [
    { text: "need 200l laktose free milk for tuesday", lang: "en" },
    { text: "breakfast for 60 guests tomorow, something simple", lang: "en" },
    { text: "12 kg butter unsalted by wednesday", lang: "en" },
    { text: "do we have enough cream for the weekend?", lang: "en" },
    { text: "whats the cheapest whipping cream", lang: "en" },
    { text: "tarviin 50 litraa kermaa torstaiksi", lang: "fi" },
    { text: "juustoa aamiaiselle 5 kiloa", lang: "fi" },
    { text: "maitoa niinkuin yleensä", lang: "fi" },
    { text: "lohta 8 kg perjantaiksi", lang: "fi" },
    { text: "raise the limit to 800", lang: "en" },
  ],
  "koulu-metsola": [
    { text: "60 l semi skimmed milk for monday lunch", lang: "en" },
    { text: "lunch for 120 pupils on friday, no nuts", lang: "en" },
    { text: "yoghurt for 120 kids wednesday", lang: "en" },
    { text: "can we get oat drink instead of milk for 10 vegan kids?", lang: "en" },
    { text: "rye bread 40 loaves tuesday", lang: "en" },
    { text: "kevytmaitoa 60 litraa maanantaiksi", lang: "fi" },
    { text: "lounas 120 oppilaalle perjantaina, ei pähkinöitä", lang: "fi" },
    { text: "jogurttia 30 litraa keskiviikoksi", lang: "fi" },
    { text: "paljonko meillä on budjettia jäljellä tällä viikolla?", lang: "fi" },
    { text: "pesto for pasta day, 3 kg", lang: "en" },
  ],
  "kahvila-sointu": [
    { text: "burger buns for 40 burgers on Monday", lang: "en" },
    { text: "oat milk for the coffee machine, 24 litres", lang: "en" },
    { text: "coffee beans 5kg", lang: "en" },
    { text: "cinnamon buns for saturday, 60", lang: "en" },
    { text: "whats in season this month?", lang: "en" },
    { text: "kaurajuomaa 24 litraa kahviin", lang: "fi" },
    { text: "kahvipapuja 5 kg perjantaiksi", lang: "fi" },
    { text: "korvapuusteja 60 kpl lauantaiksi", lang: "fi" },
    { text: "maitoa 30 l ja kermaa 5 l torstaiksi", lang: "fi" },
    { text: "who has to ok orders over the limit?", lang: "en" },
  ],
};

async function main() {
  for (const [slug, reqs] of Object.entries(REQUESTS)) {
    if (only && !only.includes(slug)) continue;
    const acc = TEST_ACCOUNTS.find((a) => a.username === slug)!;
    let cookie = "";
    const r0 = await fetch(`${base}/ui-api/account/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: acc.username, password: acc.password }) });
    cookie = (r0.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const call = (method: string, path: string, body?: unknown) => fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", cookie }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((r) => r.json());
    console.log(`\n=== ${slug}`);
    for (const q of reqs) {
      await call("POST", `/ui-api/kitchens/${slug}/thread/reset`, {});
      const t0 = Date.now();
      const sent = await call("POST", `/ui-api/kitchens/${slug}/thread/turns`, { door: "typed", via: "typed", text: q.text, lang: q.lang });
      let a: AgentTurn | undefined;
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const t = (await call("GET", `/ui-api/kitchens/${slug}/thread`)).thread as Thread;
        a = t.turns.find((x): x is AgentTurn => x.role === "agent" && x.turnId === sent.agentTurnId);
        if (a && a.status !== "working") break;
      }
      const line = a?.line ?? "";
      const words = line.replace(/\*\*|\{\{|\}\}/g, "").split(/\s+/).filter(Boolean).length;
      const leaks = codeLeaks(line);
      console.log(`> ${q.text}\n  [${a?.status}; ${(a?.cards ?? []).map((c) => c.type + ("kind" in c ? `:${(c as { kind: string }).kind}` : "")).join(",")}; ${words} w; ${Math.round((Date.now() - t0) / 100) / 10} s${leaks.length ? `; CODES ${leaks.join(",")}` : ""}]\n  ${line || "(no line)"}`);
    }
  }
}
main();
