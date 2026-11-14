import { chromium, devices } from "@playwright/test";
import { writeFileSync } from "node:fs";
const out = "/private/tmp/claude-502/-Users-macbookair-Desktop-Hackathon/7c1fe10c-b6e4-4a9f-8aa0-b9e992840db9/scratchpad/explore";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["Pixel 7"] });
  const p = await ctx.newPage();
  const snap = async (name: string) => writeFileSync(`${out}/v2_${name}.txt`, `URL ${p.url()}\n` + (await p.locator("body").ariaSnapshot()));
  await p.goto("http://localhost:4611" + (process.env.START ?? "/k/kaari/order"), { waitUntil: "networkidle" });
  await snap("order");
  const steps = process.argv.slice(2);
  let i = 0;
  for (const s of steps) {
    i++;
    const [kind, name] = s.split("=");
    try {
      if (kind === "btn") await p.getByRole("button", { name: new RegExp(name) }).first().click({ timeout: 8000 });
      if (kind === "goto") await p.goto("http://localhost:4611" + name, { waitUntil: "networkidle" });
      if (kind === "link") await p.getByRole("link", { name: new RegExp(name) }).first().click({ timeout: 8000 });
      if (kind === "fill") { const [l, v] = name.split("~"); await p.getByLabel(new RegExp(l)).first().fill(v); }
      if (kind === "press") await p.keyboard.press(name);
      if (kind === "wait") await p.waitForTimeout(Number(name));
    } catch (e) { console.log("step", s, String(e).slice(0, 200)); }
    await p.waitForTimeout(2500);
    await snap(`step${i}`);
  }
  await b.close();
})();
