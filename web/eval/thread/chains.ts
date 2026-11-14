/**
 * Follow-up chains on the real agent, in-process (real models, a few cents a chain):
 *
 *   pnpm tsx eval/thread/chains.ts [--lang en|fi] [--door typed|voice] [--only cake,milk] [--kitchen hotel-lumo]
 *
 * Each chain is a few short turns that build on one another ("chocolate cake" then "10 portions"). Per turn it prints
 * what the agent understood and said; per chain, whether it ended on the thing asked for, and how many times the agent
 * asked for something the buyer had already said in the chain (the target is zero).
 */
import { loadLocalEnv } from "../../scripts/lib/env";
loadLocalEnv();

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const lang = (opt("--lang", "en") as "en" | "fi")!;
const door = (opt("--door", "typed") as "typed" | "voice")!;
const kitchen = opt("--kitchen", "hotel-lumo")!;
const only = opt("--only")?.split(",");

type Said = "item" | "amount" | "day";
type Chain = { id: string; kitchen?: string; turns: { text: string; says: Said[] }[]; expect: { item: RegExp; amount?: number; day?: boolean; weekday?: number; lastSaysTime?: boolean } };

const CHAINS: Record<"en" | "fi", Chain[]> = {
  en: [
    { id: "cake", turns: [{ text: "chocolate cake", says: ["item"] }, { text: "10 portions", says: ["amount"] }], expect: { item: /chocolate|cake/i, amount: 10 } },
    { id: "milk", turns: [{ text: "lactose-free milk", says: ["item"] }, { text: "200 litres", says: ["amount"] }, { text: "for Friday", says: ["day"] }], expect: { item: /milk/i, amount: 200, day: true } },
    { id: "correct", turns: [{ text: "100 litres of lactose-free milk for Friday", says: ["item", "amount", "day"] }, { text: "no, 200", says: ["amount"] }], expect: { item: /milk/i, amount: 200, day: true } },
    { id: "add", turns: [{ text: "50 litres of lactose-free milk for Friday", says: ["item", "amount", "day"] }, { text: "and 12 litres of oat drink too", says: ["item", "amount"] }], expect: { item: /oat|milk/i, day: true } },
    // A follow-up the agent cannot place at once: asked once, then never again in other words (its best reading instead).
    { id: "again", turns: [{ text: "salmon soup for 10 on Monday", says: ["amount", "day"] }, { text: "12 litres", says: [] }, { text: "12 litres", says: [] }], expect: { item: /./ } },
    // A kitchen that receives on Tuesdays and Fridays: told Monday is not a delivery day, the yes to Tuesday is the day ordered.
    { id: "agreed-day", kitchen: "kahvila-sointu", turns: [{ text: "I need 30 litres of lactose-free milk by Monday", says: ["item", "amount", "day"] }, { text: "yes", says: [] }], expect: { item: /milk/i, day: true, weekday: 2 } },
    // The café's oat drink: the usual amount offered, a yes orders it, on one of the café's delivery days (Tue, Fri).
    { id: "cafe-oat", kitchen: "kahvila-sointu", turns: [{ text: "oat drink for coffee", says: ["item"] }, { text: "yes", says: [] }], expect: { item: /oat/i, day: true } },
    // "When is the cut-off?" is answered with the wholesaler's own order time.
    { id: "cutoff", turns: [{ text: "200 litres of lactose-free milk for Wednesday", says: ["item", "amount", "day"] }, { text: "when is the cut-off?", says: [] }], expect: { item: /milk/i, amount: 200, day: true, lastSaysTime: true } },
    { id: "back", turns: [{ text: "30 litres of lactose-free milk for Friday", says: ["item", "amount", "day"] }, { text: "what did we spend this week?", says: [] }, { text: "make it 40", says: ["amount"] }], expect: { item: /milk/i, amount: 40, day: true } },
  ],
  fi: [
    { id: "cake", turns: [{ text: "suklaakakku", says: ["item"] }, { text: "10 annosta", says: ["amount"] }], expect: { item: /suklaa|kakku|chocolate|cake/i, amount: 10 } },
    { id: "milk", turns: [{ text: "laktoositonta maitoa", says: ["item"] }, { text: "200 litraa", says: ["amount"] }, { text: "perjantaiksi", says: ["day"] }], expect: { item: /maito|milk/i, amount: 200, day: true } },
    { id: "correct", turns: [{ text: "100 litraa laktoositonta maitoa perjantaiksi", says: ["item", "amount", "day"] }, { text: "ei, 200", says: ["amount"] }], expect: { item: /maito|milk/i, amount: 200, day: true } },
    { id: "add", turns: [{ text: "50 litraa laktoositonta maitoa perjantaiksi", says: ["item", "amount", "day"] }, { text: "ja 12 litraa kaurajuomaa myös", says: ["item", "amount"] }], expect: { item: /kaura|oat|maito|milk/i, day: true } },
    { id: "again", turns: [{ text: "lohikeitto 10 hengelle maanantaiksi", says: ["amount", "day"] }, { text: "12 litraa", says: [] }, { text: "12 litraa", says: [] }], expect: { item: /./ } },
    { id: "back", turns: [{ text: "30 litraa laktoositonta maitoa perjantaiksi", says: ["item", "amount", "day"] }, { text: "paljonko käytimme tällä viikolla?", says: [] }, { text: "tee siitä 40", says: ["amount"] }], expect: { item: /maito|milk/i, amount: 40, day: true } },
  ],
};

// What a question in the agent's words asks for.
const ASKS: Record<Said, RegExp> = {
  amount: /how (much|many)|what amount|how large|kuinka (paljon|monta|monelle)|montako|paljonko|mikä määrä|monelleko|hur mycket|hur många/i,
  day: /which day|what day|when (do|should|would)|for when|by when|mille päivälle|minä päivänä|milloin|mihin mennessä|vilken dag|när/i,
  item: /what (would you like|do you need|should i order)|which product|mitä (tilaan|tarvitset|haluat)|mikä tuote|vad behöver/i,
};

async function main() {
  const { submitTurn, threadStore, resetThread } = await import("@/server/thread/engine");
  const { codeLeaks } = await import("@/server/thread/refusal");
  const { resolveKitchen } = await import("@/server/console-kitchens");
  const k = (await resolveKitchen(kitchen))!;
  const store = await threadStore();
  const summary: string[] = [];
  for (const chain of CHAINS[lang]) {
    if (only && !only.includes(chain.id)) continue;
    const slug = chain.kitchen ?? kitchen;
    const kk = (await resolveKitchen(slug))!;
    await resetThread(kk as never);
    const said = new Set<Said>();
    let repeated = 0;
    let codes = 0;
    let lastAsked = "";
    const log: string[] = [];
    for (const turn of chain.turns) {
      const t0 = Date.now();
      const reply = await submitTurn(slug, { door, via: door === "voice" ? "speech" : "typed", text: turn.text, lang });
      for (;;) {
        await new Promise((r) => setTimeout(r, 400));
        const a = store.agentTurn(store.peek(slug)!, reply.agentTurnId);
        if (a && a.status !== "working") break;
        if (Date.now() - t0 > 120_000) break;
      }
      const a = store.agentTurn(store.peek(slug)!, reply.agentTurnId)!;
      const line = (a.line ?? "").replace(/\*\*|\{\{|\}\}/g, "");
      // A question about something said earlier in the chain (or in this very turn) is a repeated question.
      for (const s of turn.says) said.add(s);
      const questions = line.split(/(?<=[.!?])\s+/).filter((x) => x.trim().endsWith("?"));
      const asks = (Object.keys(ASKS) as Said[]).filter((k) => said.has(k) && questions.some((q) => ASKS[k].test(q)));
      const incomplete = a.cards.find((c) => c.type === "notice" && c.kind === "incomplete");
      const missing = incomplete?.type === "notice" ? (incomplete.missing ?? []) : [];
      const missedSaid = missing.filter((m) => (/amount|how much|quantity/i.test(m) && said.has("amount")) || (/what to buy|item/i.test(m) && said.has("item")) || (/day|date/i.test(m) && said.has("day")));
      // The same clarification as last turn (asked again in other words) is a repeated question too.
      const askedNow = missing.length ? missing.join("+") : "";
      const again = !!askedNow && askedNow === lastAsked;
      lastAsked = askedNow;
      if (again) missedSaid.push(`the same as last turn (${askedNow})`);
      if (asks.length || missedSaid.length) repeated++;
      // No code ever reaches a sentence (a category code, a product id, a rule or reason code, a snake_case word).
      const leaks = codeLeaks(line);
      if (leaks.length) codes += leaks.length;
      const u = a.cards.filter((c) => c.type === "understood").at(-1);
      const menu = store.cards(store.peek(slug)!).map((x) => x.card).filter((c) => c.type === "menu").at(-1);
      log.push(
        `  > ${turn.text}\n    ${u?.type === "understood" ? `understood: ${u.item}${u.amount ? `, ${u.amount.amount} ${u.amount.unit}` : ""}${u.deliverOn ?? u.deliverBy ? `, ${u.deliverOn ?? u.deliverBy}` : ""}${u.basedOn ? " (a change)" : ""}` : `cards: ${a.cards.map((c) => c.type).join(",") || "none"}`}${menu?.type === "menu" ? ` | menu ${menu.stage} ${menu.covers ?? ""}` : ""}\n    agent (${line.split(/\s+/).filter(Boolean).length} w, ${Math.round((Date.now() - t0) / 100) / 10} s): ${line}${asks.length || missedSaid.length ? `\n    REPEATED: asks again for ${[...asks, ...missedSaid].join(", ")}` : ""}`,
      );
    }
    // Where the chain ended: the newest understood card (or menu) against what the buyer asked for.
    const cards = store.cards(store.peek(slug)!).map((x) => x.card);
    const u = cards.filter((c) => c.type === "understood").at(-1);
    const menu = cards.filter((c) => c.type === "menu").at(-1);
    const sheet = cards.filter((c) => c.type === "sheet").at(-1);
    const item = [u?.type === "understood" ? u.item : "", menu?.type === "menu" ? `${menu.dishes?.map((d) => d.name).join(" ")} ${menu.proposals?.map((p) => p.title).join(" ")}` : "", sheet?.type === "sheet" ? sheet.lines.map((l) => l.name).join(" ") : ""].join(" ");
    const amount = u?.type === "understood" ? u.amount?.amount : undefined;
    const covers = menu?.type === "menu" ? menu.covers : undefined;
    const day = u?.type === "understood" ? (u.deliverOn ?? u.deliverBy) : undefined;
    const okItem = chain.expect.item.test(item);
    const okAmount = chain.expect.amount === undefined || amount === chain.expect.amount || covers === chain.expect.amount;
    // The day the buyer agreed to is the day of what is offered or ordered.
    const offered = cards.filter((c) => c.type === "options").at(-1);
    const orderDay = cards.filter((c) => c.type === "order").at(-1);
    const dayOf = orderDay?.type === "order" ? orderDay.deliveryDate : offered?.type === "options" ? offered.options[0]?.deliveryDate : day;
    const weekdayOk = chain.expect.weekday === undefined || (!!dayOf && ((new Date(`${dayOf}T12:00:00Z`).getUTCDay() + 6) % 7) + 1 === chain.expect.weekday);
    const okDay = (!chain.expect.day || !!day || !!(sheet?.type === "sheet" && sheet.deliveryDate)) && weekdayOk;
    const lastLine = (store.agentTurn(store.peek(slug)!, [...store.peek(slug)!.turns].reverse().find((x) => x.role === "agent")!.turnId)?.line ?? "").replace(/\*\*|\{\{|\}\}/g, "");
    const okTime = !chain.expect.lastSaysTime || /\b\d{1,2}[.:]\d{2}\b/.test(lastLine);
    const ok = okItem && okAmount && okDay && okTime;
    console.log(`\n${lang}/${door} ${chain.id}: ${ok ? "right" : "WRONG"} after ${chain.turns.length} turns, ${repeated} repeated question${repeated === 1 ? "" : "s"}, ${codes} code${codes === 1 ? "" : "s"} in replies${ok ? "" : ` (item ${okItem}, amount ${okAmount}, day ${okDay})`}\n${log.join("\n")}`);
    summary.push(`${chain.id}: ${ok && !codes ? "right" : "WRONG"}, ${chain.turns.length} turns, ${repeated} repeated, ${codes} codes`);
  }
  console.log(`\n${lang}/${door}: ${summary.join("; ")}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
