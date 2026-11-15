/**
 * c03 (guardrails), after c03-01 which c02.ts records: the mistake check and its one-tap correction (Hotel Lumo);
 * a product outside the rules refused in Kahvila Sointu with the rule named and the offer to change it; the rules
 * change that needs the approver's passkey.
 *
 *   npx tsx scripts/demo-video/c03.ts --url http://localhost:5142 [--only mistake,refused]
 */
import { click, deliver, hover, launch, opt, reveal, sleep, Take } from "./rec";
import { Kitchen } from "./talk";

const base = opt("--url", "http://localhost:5142")!;
const only = opt("--only")?.split(",");
const on = (s: string) => !only || only.includes(s);

async function main() {
  const browser = await launch();

  if (on("mistake")) {
    const k = await new Kitchen(browser, base, "hotel-lumo").open({ resetAccounts: true });
    const take = new Take("c03-02");
    await take.record(k.page);
    await sleep(800);
    let t = await k.say(take, "Order 4,200 litres of Valio Eila® semi skimmed milk drink 10 l novobox lactose free for Tuesday.", { cps: 26, label: "typed: an order ten times the usual amount" });
    take.event("the mistake check: it asks before ordering anything");
    await sleep(3200);
    // the one-tap correction: the question's first offered answer that is not "yes"
    const an = k.cards(t).filter((c) => c.type === "anomaly").at(-1);
    const q = k.cards(t).filter((c) => c.type === "question").at(-1);
    const labels = an?.type === "anomaly" ? an.concerns.flatMap((x) => x.corrections.map((o) => o.label)) : q?.type === "question" ? q.questions.flatMap((x) => x.options.map((o) => o.label)) : [];
    console.log("  options:", labels.join(" | "));
    const fix = labels.find((l) => /\b(4\d0|420)\b|usual|meant|instead/i.test(l) && !/right/i.test(l)) ?? labels.find((l) => !/right|yes/i.test(l));
    if (fix) {
      const b = k.page.getByText(fix, { exact: true }).last();
      if (await b.count()) {
        await hover(b);
        await sleep(900);
        await click(b);
        take.event(`one tap: ${fix}`);
        const before = (await k.thread()).turns.length;
        await take.wait(async () => {
          const end = Date.now() + 120_000;
          while (Date.now() < end) {
            const th = await k.thread();
            const last = th.turns.at(-1);
            if (th.turns.length > before && last?.role === "agent" && last.status !== "working") return;
            await sleep(500);
          }
        });
        t = await k.thread();
        await sleep(800);
        await k.bottom();
        take.event("corrected amount carried on");
        await sleep(3500);
      }
    }
    await take.stop();
    deliver(take, { id: "c03-02-mistake", chapter: "c03", what: "Hotel Lumo: an order ten times the usual amount; the agent stops and asks before ordering; one tap corrects it" });
    await k.ctx.close();
  }

  if (only?.includes("alone")) {
    const k = await new Kitchen(browser, base, "hotel-lumo").open();
    const take = new Take("c02-06");
    await take.record(k.page);
    await sleep(800);
    await k.say(take, "Order 420 litres of lactose-free milk for Tuesday.", { label: "typed: an order within the limit" });
    take.event("options at fixed prices");
    await sleep(3500);
    const t = await k.say(take, "The first one.");
    take.event("placed alone (under the 500 € limit): recorded at the fixed price, now with the wholesaler's team to confirm");
    const team = k.page.getByText(/wholesaler's team/).last();
    if (await team.count()) await reveal(team, { block: "center" }).catch(() => undefined);
    console.log("  ON SCREEN:", (await k.page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(-900));
    void t;
    await sleep(5000);
    await take.stop();
    deliver(take, { id: "c02-06-placed-alone", chapter: "c02", what: "Hotel Lumo: 420 L within the 500 € limit is placed by the agent alone; the sentence that it is recorded at the fixed price and now with the wholesaler's team to confirm, and the state under the order" });
    await k.ctx.close();
  }

  if (on("refused")) {
    const k = await new Kitchen(browser, base, "kahvila-sointu").open();
    let take = new Take("c03-03");
    await take.record(k.page);
    await sleep(800);
    let t = await k.say(take, "Order 3 kg of salmon fillet for Tuesday.", { label: "typed: salmon, outside the café's product groups" });
    take.event("refused with the rule named, and the offer to change the rules");
    await sleep(4500);
    await take.stop();
    deliver(take, { id: "c03-03-refused", chapter: "c03", what: "Kahvila Sointu: salmon is outside the café's product groups; refused with the rule named and an offer to change the rules" });

    take = new Take("c03-04");
    await take.record(k.page);
    await sleep(600);
    t = await k.say(take, "Yes, let the agent buy fish too.", { label: "typed: yes, widen the rules" });
    take.event("the change drafted: meat and fish added; needs the owner's passkey");
    await sleep(3500);
    t = await k.say(take, "Yes, send it to the owner.", { label: "typed: yes, send it to the owner" });
    await sleep(800);
    const slab = k.page.locator("[data-slab]").last();
    if (await slab.count()) await reveal(slab, { block: "start", offset: 90 });
    take.event("widening the rules waits for the approver's passkey: the rule-change sign-off");
    await sleep(4500);
    await take.stop();
    deliver(take, { id: "c03-04-rule-change", chapter: "c03", what: "Widening the rules in words: the change is drafted and waits for the owner's passkey (rule-change sign-off slab)" });
    console.log("  cards:", k.cards(t).map((c) => c.type).join(","));
    await k.ctx.close();
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
