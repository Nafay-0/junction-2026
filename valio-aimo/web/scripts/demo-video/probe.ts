/** A short probe take: is the screencast sharp at 1920x1080, does the pointer show, how many frames a second? */
import { context, deliver, launch, moveTo, opt, scrollBy, sleep, Take } from "./rec";

async function main() {
  const base = opt("--url", "http://localhost:5142")!;
  const browser = await launch();
  const ctx = await context(browser, base);
  const page = await ctx.newPage();
  await page.goto("/k");
  await sleep(1500);
  const take = new Take("probe");
  await take.record(page);
  await moveTo(page, 300, 300);
  await moveTo(page, 900, 500);
  await page.mouse.down();
  await page.mouse.up();
  await scrollBy(page, 400);
  await sleep(800);
  await take.stop();
  console.log("frames", take.recorders[0].frames.length, "over", take.now(), "ms");
  deliver(take, { id: "zz-probe", chapter: "probe", what: "probe" });
  await browser.close();
}
main();
