/**
 * Drives the call screen in a real Chromium with a phone viewport, against a running server:
 *
 *   pnpm tsx scripts/eval/browser-call.ts <baseUrl> <outDir> <micWav> [scenario...]
 *
 * scenarios: voice (hands-free call, the microphone fed from micWav), denied (microphone refused: typed
 * fallback), lost (the voice connection cut after 9 s), join (the call QR path: passkey join with a virtual
 * authenticator, then the call screen for the visitor's own kitchen). Screenshots go to outDir.
 * The voice scenario spends real money (one short Gemini Live call, about $0.01).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices, type Page } from "@playwright/test";

const [base, out, wav, ...which] = process.argv.slice(2);
const want = (s: string) => !which.length || which.includes(s);
const phone = { ...devices["Pixel 7"] };
fs.mkdirSync(out, { recursive: true });

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
}
async function transcript(page: Page) {
  return page.locator('[aria-label="Live transcript"]').innerText().catch(() => "");
}

async function voice() {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ ...phone, permissions: ["microphone"] });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
  await page.goto(`${base}/call?k=laakso`);
  await page.getByText("Hands-free").click();
  await shot(page, "voice-0-idle");
  await page.getByRole("button", { name: "Call", exact: true }).click();
  const t0 = Date.now();
  for (const at of [3, 9, 16, 24, 32, 40]) {
    await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - t0)));
    await shot(page, `voice-${at}s`);
    console.log(`--- ${at}s`, JSON.stringify(await transcript(page)));
  }
  console.log("cards:", (await page.locator("section h3").allInnerTexts()).join(" | "));
  await page.getByRole("button", { name: "Hang up" }).click();
  await page.waitForTimeout(800);
  await shot(page, "voice-ended");
  console.log("ended:", (await page.locator("main").innerText()).slice(-300));
  await browser.close();
}

async function denied() {
  // A microphone exists, but the page is refused permission (as when the visitor taps "Don't allow").
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream"] });
  const ctx = await browser.newContext({ ...phone, permissions: [] });
  const page = await ctx.newPage();
  await page.goto(`${base}/call?k=laakso`);
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await page.getByPlaceholder(/100 litres/).waitFor({ timeout: 15000 });
  await shot(page, "denied-1-typed");
  console.log("denied notice:", await page.locator("main").innerText().then((t) => t.slice(0, 300)));
  await page.getByPlaceholder(/100 litres/).fill("200 litres of lactose-free milk for Wednesday, cheapest");
  await page.getByRole("button", { name: "Send" }).click();
  await page.locator("section h3").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  await shot(page, "denied-2-cards");
  console.log("denied notice:", await page.locator("main").innerText().then((t) => t.slice(0, 600)));
  await browser.close();
}

async function lost() {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`] });
  const ctx = await browser.newContext({ ...phone, permissions: ["microphone"] });
  const page = await ctx.newPage();
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    const server = ws.connectToServer();
    setTimeout(() => {
      ws.close({ code: 1006 as never, reason: "test cut" }).catch(() => {});
      server.close().catch(() => {});
    }, 9000);
  });
  await page.goto(`${base}/call?k=kaari`);
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await page.getByText(/dropped/).waitFor({ timeout: 30000 });
  await shot(page, "lost-1");
  console.log("lost:", await page.locator("main").innerText().then((t) => t.slice(-400)));
  await browser.close();
}

async function join() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...phone });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(`${base}/call`);
  await page.getByRole("button", { name: /Create passkey and call/ }).waitFor({ timeout: 15000 });
  await shot(page, "join-1");
  await page.getByRole("button", { name: /Create passkey and call/ }).click();
  await page.getByRole("button", { name: "Call", exact: true }).waitFor({ timeout: 20000 });
  await shot(page, "join-2-call-screen");
  console.log("joined:", (await page.locator("main").innerText()).slice(0, 200));
  await browser.close();
}

(async () => {
  if (want("join")) await join();
  if (want("denied")) await denied();
  if (want("lost")) await lost();
  if (want("voice")) await voice();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
