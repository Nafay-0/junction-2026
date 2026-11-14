import { expect, test, type Page } from "@playwright/test";

/**
 * The sign-off from the thread: a new restaurant (no signing device, like every sign-up and the shared test accounts)
 * sends an order over its limit through the agent thread, and finishes it alone from the gate card: "Add this device
 * and sign" adds this browser's passkey to the kitchen's signer and signs the exact order with it; the thread then
 * shows the signed order. No model: the request is opened with a structured need and every step is a tap turn.
 */
const stamp = Date.now().toString(36).slice(-6);
const PASSWORD = "e2e-password-123";
const shots = process.env.E2E_SHOTS;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

async function signUp(page: Page, username: string, restaurant: string) {
  await page.goto("/k/signup");
  const form = page.getByRole("form", { name: "Your restaurant" });
  await form.getByLabel("Restaurant or buyer name").fill(restaurant);
  await form.getByLabel("Username", { exact: true }).fill(username);
  await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("The agent may spend alone, per order (€)")).toHaveValue("300");
  await page.getByRole("button", { name: "Sign the mandate and open the shop" }).click();
  await page.getByRole("link", { name: "Open my shop" }).click();
  await page.waitForURL(`**/k/${username}`);
}

function inDays(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Step = { requestId: string; state: string; concerns: { key: string; confirmable: boolean; corrections: { id: string }[] }[]; questions: { id: string; options: { id: string }[] }[]; options: { optionId: string }[] };

test("an order over the limit is signed from the thread's gate card with this device, which is added in the same step", async ({ page }) => {
  test.setTimeout(180_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const user = `e2e-t-${stamp}`;
  await signUp(page, user, `Thread Signer ${stamp}`);
  const t0 = Date.now();

  // The request, as the reader would have read it: 600 L of lactose-free milk, well over the €300 the agent may spend alone.
  const opened = await page.request.post(`/ui-api/kitchens/${user}/call`, {
    data: { method: "POST", path: "/api/v1/intake", body: { need: { text: "600 litres of lactose-free milk", item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"] }, quantity: { amount: 600, unit: "L" }, deliverBy: inDays(6) }, by: "e2e" } },
  });
  expect(opened.status()).toBeLessThan(300);
  let step = ((await opened.json()) as { step: Step }).step;
  const turn = (action: Record<string, unknown>, label: string) => page.request.post(`/ui-api/kitchens/${user}/thread/turns`, { data: { door: "typed", via: "tap", action, label } });
  const read = async () => ((await (await page.request.post(`/ui-api/kitchens/${user}/call`, { data: { method: "GET", path: `/api/v1/intake/${step.requestId}` } })).json()) as { step: Step }).step;

  await page.goto(`/k/${user}/order`);
  const log = page.getByRole("log", { name: "Conversation with the purchasing agent" });
  for (let i = 0; i < 5 && step.state !== "options_ready"; i++) {
    if (step.state === "needs_confirmation") {
      const c = step.concerns[0];
      expect((await turn({ type: "concern", requestId: step.requestId, key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id }, "Yes, as asked")).status()).toBe(202);
    } else if (step.state === "needs_input") {
      const q = step.questions[0];
      expect((await turn({ type: "answer", requestId: step.requestId, questionId: q.id, optionId: q.options[0].id }, "The first")).status()).toBe(202);
    } else break;
    await expect.poll(async () => (step = await read()).state, { timeout: 20_000 }).not.toBe("needs_confirmation");
  }
  test.skip(step.state !== "options_ready", `no options to choose today (${step.state})`);
  expect((await turn({ type: "choose", requestId: step.requestId, optionId: step.options[0].optionId }, "Order the first")).status()).toBe(202);

  // The gate holds it for the kitchen's signer, and there is no signing device yet: the card says so and offers the step.
  await expect(log.getByText(/No signing device yet/)).toBeVisible({ timeout: 30_000 });
  await expect(log.getByText("Asked on their phone, with their passkey.")).toHaveCount(0);
  await expect(log.getByRole("button", { name: "Send to my phone" })).toBeVisible();
  await shot(page, "thread-01-waiting-no-device");
  // "Send to my phone": the one-time code that adds the phone as the signer's device, then opens this order's sign-off.
  await log.getByRole("button", { name: "Send to my phone" }).click();
  const phoneLink = page.getByRole("link", { name: "Or open this address on the phone" });
  await expect(phoneLink).toHaveAttribute("href", /\/join\/device\?t=.+&next=%2Fapprove%2Fapr_/);
  await log.getByRole("button", { name: "Hide the code" }).click();
  await log.getByRole("button", { name: "Add this device and sign" }).click();

  // Signed with this device's passkey, bound to the exact order: the thread turns the gate card into the signed outcome.
  await expect(log.getByText(/^Signed off by /).first()).toBeVisible({ timeout: 30_000 });
  await expect(log.getByText("Placed").first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "thread-02-signed");
  console.log(`from the first tap to the signed order: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const portal = await (await page.request.get(`/ui-api/kitchens/${user}/portal`)).json();
  const signed = (portal.orders as { status: string; authorised: { by: string; method?: string; verified?: boolean } }[]).find((o) => o.status === "committed");
  expect(signed?.authorised).toMatchObject({ by: "person", method: "passkey", verified: true });
});
