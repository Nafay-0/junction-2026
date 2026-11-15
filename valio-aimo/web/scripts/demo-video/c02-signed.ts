/**
 * c02-05 alone, after c02.ts has run (the order is signed): the sentence after the phone's OK and the state under the
 * order, held, then the wholesaler's view. Does not reset the conversation.
 *   npx tsx scripts/demo-video/c02-signed.ts --url http://localhost:5142
 */
import { signInKitchen } from "./kit";
import { click, context, deliver, hover, launch, opt, pointerAt, quiet, reveal, scrollBy, sleep, Take } from "./rec";

const base = opt("--url", "http://localhost:5142")!;
async function main() {
  const browser = await launch();
  const ctx = await context(browser, base);
  await signInKitchen(ctx, base, "hotel-lumo");
  const page = await ctx.newPage();
  await page.goto("/k/hotel-lumo");
  await quiet(page);
  await sleep(2500);
  await pointerAt(page, 900, 420);
  const said = page.getByText(/It's placed at the fixed price/).last();
  await said.waitFor({ timeout: 20_000 });
  await reveal(said, { block: "start", offset: 80, ms: 10 });
  await sleep(800);
  const take = new Take("c02-05");
  await take.record(page);
  await sleep(600);
  await hover(said);
  take.event("after the phone's OK: placed at the fixed price, now with the wholesaler's team to confirm");
  await sleep(2500);
  const state = page.getByText("With the wholesaler's team to confirm").last();
  if (await state.count()) await hover(state);
  take.event("the state under the order: With the wholesaler's team to confirm");
  await sleep(2500);
  const wholesale = page.getByRole("link", { name: /See this order as the wholesaler sees it/ }).last();
  await reveal(wholesale);
  await sleep(600);
  take.event("See this order as the wholesaler sees it");
  const href = await wholesale.getAttribute("href");
  await click(wholesale, { pause: 100 });
  if (href && page.url().indexOf(href) < 0) await page.goto(href).catch(() => undefined);
  await take.wait(() => quiet(page));
  await sleep(2500);
  await scrollBy(page, 360, { at: { x: 640, y: 400 } });
  await sleep(2500);
  await take.stop();
  deliver(take, { id: "c02-05-signed", chapter: "c02", what: "After the phone's OK: 'Kitchen manager OK'd it. It's placed at the fixed price for Monday 16 Nov and is now with the wholesaler's team to confirm for delivery…' and the state under the order; then the wholesaler's view" });
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
