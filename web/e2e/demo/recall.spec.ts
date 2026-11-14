import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { addPasskey, enterOps, joinAsApprover, watchErrors } from "../support/dock";
import { acquireLock } from "../support/recall-lock";

/**
 * The recall drill (README "Recall radar"; src/server/radar/, /ops/radar, /ui-api/radar/drill).
 *
 * Operations staff publish a drill notice on AimoPilot's own drill page; the radar reads it on demand (RADAR_POLL is
 * off on the test server: publishing schedules one read of the drill page 0.8 s later), matches the product in code
 * and holds it. A kitchen that already has a fixed price for that product is refused at the order with the rule
 * `recall_hold`, the refusal names the notice, the kitchen's shop shows the drill notice, and ending the drill
 * lifts the hold so the same order then goes through.
 *
 * Everything here is the real server (seed catalogue, no model, no Context.dev: the drill page is read directly).
 *
 * Shared state: a drill holds a product for every kitchen on the server, and the ops screen allows one drill at a
 * time. So drills use only VA-1035 (lactose-free WHOLE milk 3.5 %, 1 L) and VA-1002 (lactose-free FAT-FREE milk
 * 0.1 %, 1 L), which no headline path asks for (the 1,000 L example is 1.5 % milk: VA-1010 + AR-2010), every drill
 * is serialised across the six projects with a cross-process lock (support/recall-lock.ts), the fixed price is taken
 * under that lock, and the drill is always ended in `finally`.
 * Note for the shared suite: the ops screen's default drill product (first candidate) is VA-1010, the headline milk.
 *
 * The core caches live status per product and delivery date for 120 s, for every kitchen (src/core/orders.ts:428,
 * DOCK_LIVE_CACHE_SECONDS), above the recall layer. A hold's "blocked" status therefore outlives the drill by up to
 * 2 minutes, so every project and each defect test uses its own (product, delivery date) pair: nobody reads a status
 * another test's drill left in the cache.
 */

type Drilled = { id: string; name: RegExp; need: { item: Record<string, unknown>; quantity: { amount: number; unit: string }; deliverBy?: string } };
/** Helsinki calendar day `days` from now (YYYY-MM-DD). */
const helsinkiDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(new Date(Date.now() + days * 86_400_000));
const WHOLE = { id: "VA-1035", name: /lactose-free whole milk drink 3\.5 %, 1 L/, attributes: ["lactose_free", "fat_3_5"], text: "lactose-free whole milk" };
const FAT_FREE = { id: "VA-1002", name: /lactose-free fat-free milk drink 0\.1 %, 1 L/, attributes: ["lactose_free", "fat_free"], text: "lactose-free fat-free milk" };
const OURS = [WHOLE.id, FAT_FREE.id];
function drilled(p: typeof WHOLE, days?: number): Drilled {
  return { id: p.id, name: p.name, need: { item: { text: p.text, category: "milk", attributes: p.attributes, productId: p.id }, quantity: { amount: 20, unit: "L" }, ...(days ? { deliverBy: helsinkiDay(days) } : {}) } };
}
/** One (product, delivery date) per project; the two chromium-desktop defect tests have their own. */
const BY_PROJECT: Record<string, Drilled> = {
  "chromium-phone": drilled(WHOLE),
  "webkit-phone": drilled(WHOLE, 5),
  "firefox-phone": drilled(FAT_FREE),
  "chromium-desktop": drilled(FAT_FREE, 3),
  "webkit-desktop": drilled(FAT_FREE, 4),
  "firefox-desktop": drilled(FAT_FREE, 5),
};
const AFTER_END = drilled(WHOLE, 3);
const STALE_CARD = drilled(WHOLE, 4);

type Reply = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The kitchen's own agent, as the console's server side plays it: one v1 call with the kitchen's mandate. */
function consoleAgent(request: APIRequestContext, slug: string) {
  return async (method: "GET" | "POST", path: string, body?: unknown): Promise<Reply> => {
    const res = await request.post(`/ui-api/kitchens/${slug}/call`, { data: { method, path, body } });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  };
}

/** Drive an intake for `need` to a fixed-price quote for `productId` (confirm what can be confirmed, first answers). */
async function quoteFor(call: ReturnType<typeof consoleAgent>, need: unknown, productId: string) {
  const by = "E2E recall drill";
  let r = await call("POST", "/api/v1/intake", { need, by });
  for (let i = 0; i < 6; i++) {
    const step = r.body?.step;
    expect(step, `intake reply ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`).toBeTruthy();
    const base = `/api/v1/intake/${step.requestId}`;
    if (step.state === "quoted") return step;
    if (step.state === "needs_confirmation") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responses = step.concerns.map((c: any) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections?.find((x: any) => !x.cancel)?.id ?? "confirm" }));
      r = await call("POST", `${base}/concerns`, { by, responses });
    } else if (step.state === "needs_input") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r = await call("POST", `${base}/answers`, { by, answers: step.questions.map((q: any) => ({ questionId: q.id, optionId: q.options[0].id })) });
    } else if (step.state === "options_ready") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const card = step.options.find((o: any) => o.lines.every((l: any) => l.productId === productId));
      expect(card, `a card with only ${productId}: ${JSON.stringify(step.options.map((o: { lines: unknown }) => o.lines))}`).toBeTruthy();
      r = await call("POST", `${base}/choice`, { by, optionId: card.optionId });
      if (r.status >= 400) return { refused: r };
    } else {
      throw new Error(`intake stopped at ${step.state}: ${JSON.stringify(step.notes ?? step).slice(0, 400)}`);
    }
  }
  throw new Error("intake did not reach a quote in 6 steps");
}

/** A visitor's phone: scan the wall's code, passkey, the visitor's own kitchen slug. */
async function visitorKitchen(page: Page): Promise<string> {
  await addPasskey(page);
  await joinAsApprover(page);
  await page.goto("/k/mine");
  await page.waitForURL(/\/k\/sbx_[a-z0-9]+/i, { timeout: 20_000 });
  return new URL(page.url()).pathname.split("/")[2];
}

/** The operations desk on a laptop, in its own context (staff are not the kitchen). */
async function opsDesk(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const ops = await context.newPage();
  await enterOps(ops, "E2E recall drill");
  return { context, ops };
}

type RadarView = {
  holds: { holdId: string; productId: string; drill: boolean; drillId?: string; noticeUrl: string; noticeTitle: string; refusals: number }[];
  lifted: { productId: string; drillId?: string; liftReason?: string }[];
  drill: { active: { drillId: string; productId: string; heldAt?: string; firstRefusalAt?: string; secondsToRefusal?: number }[] };
};
const radarView = async (ops: Page) => (await (await ops.request.get("/ops-api/radar")).json()) as RadarView;

/** End any drill still running for our products (a crashed earlier attempt), through the API. */
async function endOurDrills(ops: Page) {
  const v = await radarView(ops);
  for (const d of v.drill.active.filter((x) => OURS.includes(x.productId))) await ops.request.post("/ops-api/radar", { data: { action: "end_drill", drillId: d.drillId } });
}

test("recall drill: publish, product held, order refused with recall_hold naming the notice, end drill, order goes through", async ({ page, browser, baseURL }, info) => {
  test.setTimeout(300_000); // includes waiting for the other projects' drills (one at a time on a server)
  const d = BY_PROJECT[info.project.name] ?? drilled(WHOLE, 2);
  const DRILL_PRODUCT = d.id;
  const DRILL_NAME = d.name;
  const errors = watchErrors(page);
  const slug = await visitorKitchen(page);
  const agent = consoleAgent(page.request, slug);

  const release = await acquireLock(`recall-${baseURL}`, { timeoutMs: 240_000 });
  const { context: opsContext, ops } = await opsDesk(browser, baseURL);
  try {
    await endOurDrills(ops);

    // Before the drill: the visitor's agent gets a fixed price for 20 L of the drill product (about €30: under the
    // visitor's €500 limit, so it would go through alone).
    const before = await quoteFor(agent, d.need, DRILL_PRODUCT);
    expect(before.state, JSON.stringify(before).slice(0, 300)).toBe("quoted");
    const orderBody = before.next.example;
    expect(JSON.stringify(orderBody)).toContain(before.quote.quoteToken);

    // ---- publish the drill from the operations screen ----
    await ops.goto("/ops/radar");
    await expect(ops.getByRole("heading", { name: "Recall radar" })).toBeVisible();
    const select = ops.getByLabel("Product to recall in the drill");
    await expect(select).toBeVisible({ timeout: 30_000 }); // only while no drill runs (another project's drill may still be ending)
    // The visitor's open quote makes the product a candidate ("in an open quote: about to be ordered").
    await expect(select.locator(`option[value="${DRILL_PRODUCT}"]`)).toHaveCount(1, { timeout: 15_000 });
    await select.selectOption(DRILL_PRODUCT);
    await ops.getByRole("button", { name: "Publish drill notice" }).click();
    await expect(ops.getByText(/Drill notice published/)).toBeVisible();
    await expect(ops.getByText("Drill recall of")).toBeVisible();
    await expect(ops.locator("b").filter({ hasText: DRILL_NAME }).first()).toBeVisible();

    // The radar reads the drill page and holds the product: "3. Product held" done, a "Held for a drill" row.
    await expect(ops.getByText("Held for a drill")).toBeVisible({ timeout: 20_000 });
    const holdRow = ops.locator("li").filter({ hasText: "Held for a drill" });
    await expect(holdRow.getByText(DRILL_NAME).first()).toBeVisible();
    await expect(holdRow.getByText(/DRILL notice "HARJOITUS/)).toBeVisible();
    await expect(ops.getByText(/^\+\d/).first()).toBeVisible(); // picked up / held stopwatch steps filled in

    // The server state behind it.
    let v = await radarView(ops);
    const hold = v.holds.find((h) => h.productId === DRILL_PRODUCT);
    expect(hold, JSON.stringify(v.holds)).toMatchObject({ drill: true, noticeTitle: expect.stringMatching(/^HARJOITUS: /) });
    const drill = v.drill.active.find((d) => d.productId === DRILL_PRODUCT)!;
    expect(drill.heldAt).toBeTruthy();
    // The notice page itself is public and says DRILL in the authority's layout.
    const notice = await page.request.get(hold!.noticeUrl.replace(/^https?:\/\/[^/]+/, ""));
    expect(notice.status()).toBe(200);
    expect(await notice.text()).toMatch(/HARJOITUS \/ DRILL \/ ÖVNING/);

    // ---- the kitchen side: the shop shows the drill notice ----
    await page.goto(`/k/${slug}`);
    const kitchenNotice = page.getByRole("region", { name: "Recall notices" });
    await expect(kitchenNotice.getByText("Drill: not a real recall")).toBeVisible({ timeout: 20_000 });
    await expect(kitchenNotice.getByText(/You are about to order it: the order will not go through/)).toBeVisible();
    const notices = (await (await page.request.get(`/ui-api/radar/kitchens/${slug}`)).json()) as { notices: { productId: string; held: boolean; drill: boolean; relation: string }[] };
    expect(notices.notices).toContainEqual(expect.objectContaining({ productId: DRILL_PRODUCT, held: true, drill: true, relation: "ordering" }));

    // ---- the order with the price fixed before the hold is refused, by name, with the notice ----
    const refused = await agent("POST", "/api/v1/orders", orderBody);
    expect(refused.status, JSON.stringify(refused.body).slice(0, 400)).toBe(409);
    expect(refused.body.error).toMatchObject({ code: "product_on_recall_hold", rule: "recall_hold", details: { productId: DRILL_PRODUCT, drill: true, noticeUrl: hold!.noticeUrl } });
    expect(refused.body.error.message).toMatch(/^DRILL, not a real recall: .*is on a recall hold: .*Notice: http/);
    expect(refused.body.error.message).toContain(hold!.noticeUrl);

    // ---- a fresh attempt from scratch gets no quote either ----
    // The card is either left out ("blocked") or, when the product's live status was cached before the hold, still
    // shown; choosing it is then refused. Today that refusal is `quote_availability`, not `recall_hold` (see the
    // test.fail test below), so both are accepted here and the rule is recorded.
    const again = await quoteFor(agent, d.need, DRILL_PRODUCT).catch((e: Error) => ({ error: e.message }));
    if ("refused" in again && again.refused) {
      expect(again.refused.status).toBe(409);
      expect(["recall_hold", "quote_availability"]).toContain(again.refused.body.error?.rule);
      test.info().annotations.push({ type: "fresh attempt", description: `stale card chosen, refused with ${again.refused.body.error?.rule}: ${again.refused.body.error?.message}` });
    } else if ("error" in again) {
      test.info().annotations.push({ type: "fresh attempt", description: `card left out: ${again.error.slice(0, 200)}` });
      expect(again.error).toMatch(/no_options|blocked/); // the card left it out
    } else {
      throw new Error(`a quote for a held product was issued: ${JSON.stringify(again).slice(0, 300)}`);
    }

    // The refusal is in the ledger and on the ops screen ("4. An order stopped", calls refused on the hold).
    const ledger = await agent("GET", `/api/v1/ledger?requestId=${before.requestId}`);
    expect(JSON.stringify(ledger.body)).toMatch(/recall_hold/);
    await expect(holdRow.getByText(/[1-9]\d* calls? refused/)).toBeVisible({ timeout: 10_000 });
    await expect(ops.getByText("Notice to stopped order")).toBeVisible({ timeout: 10_000 });
    v = await radarView(ops);
    expect(v.holds.find((h) => h.productId === DRILL_PRODUCT)!.refusals).toBeGreaterThanOrEqual(1);

    // ---- end the drill from the screen: the hold lifts ----
    await ops.getByRole("button", { name: "End drill and lift its hold" }).click();
    await expect(ops.getByText("Held for a drill")).toHaveCount(0, { timeout: 15_000 });
    await expect(ops.getByLabel("Product to recall in the drill")).toBeVisible({ timeout: 15_000 });
    v = await radarView(ops);
    expect(v.holds.filter((h) => h.productId === DRILL_PRODUCT)).toEqual([]);
    expect(v.lifted).toContainEqual(expect.objectContaining({ productId: DRILL_PRODUCT, drillId: drill.drillId, liftReason: "Drill ended" }));

    // The same order now goes through (it is under the visitor's limit: committed alone).
    const placed = await agent("POST", "/api/v1/orders", orderBody);
    expect(placed.status, JSON.stringify(placed.body).slice(0, 400)).toBeLessThan(300);
    expect(placed.body.order).toMatchObject({ status: "committed" });
    expect(placed.body.order.lines.map((l: { productId: string }) => l.productId)).toEqual([DRILL_PRODUCT]);
  } finally {
    await endOurDrills(ops).catch(() => undefined);
    await opsContext.close();
    release();
  }
  expect(errors).toEqual([]);
});

test("after a drill ends, a new request offers the product again at once", async ({ page, browser, baseURL }, info) => {
  // Server behaviour, not the browser's: one project is enough.
  test.skip(info.project.name !== "chromium-desktop", "server-side cache behaviour; checked once, on chromium-desktop");
  // Known defect: the core caches live status for DOCK_LIVE_CACHE_SECONDS (120 s, src/core/orders.ts:428-437,
  // src/server/runtime.ts:106) ABOVE the recall-aware catalogue (src/server/radar/gate.ts recallAwareCatalog), so the
  // "sales_block" a hold produced keeps the product out of option cards for up to 2 minutes after the drill ends
  // (and, the other way round, a product looked up just before a hold still gets a card, whose quote is then refused).
  // E2E_EXPECT_FIXED=1 runs it as an ordinary test, to see where it fails or to confirm a fix.
  test.fail(!process.env.E2E_EXPECT_FIXED, "held status is cached for up to 120 s after the hold lifts (core live cache above the recall layer)");
  test.setTimeout(300_000);
  const slug = await visitorKitchen(page);
  const agent = consoleAgent(page.request, slug);
  const release = await acquireLock(`recall-${baseURL}`, { timeoutMs: 240_000 });
  const { context: opsContext, ops } = await opsDesk(browser, baseURL);
  try {
    await endOurDrills(ops);
    const pub = await ops.request.post("/ops-api/radar", { data: { action: "drill", productId: AFTER_END.id } });
    expect(pub.status()).toBe(201);
    const { drill } = (await pub.json()) as { drill: { drillId: string } };
    await expect.poll(async () => (await radarView(ops)).holds.some((h) => h.productId === AFTER_END.id), { timeout: 20_000 }).toBe(true);
    // The kitchen asks while the hold is on: the card leaves the product out ("blocked"); this fills the live cache.
    const during = await agent("POST", "/api/v1/intake", { need: AFTER_END.need, by: "E2E recall drill" });
    expect(JSON.stringify(during.body.step?.excluded ?? [])).toContain(AFTER_END.id);
    await ops.request.post("/ops-api/radar", { data: { action: "end_drill", drillId: drill.drillId } });
    expect((await radarView(ops)).holds.some((h) => h.productId === AFTER_END.id)).toBe(false);
    // Asked again right after the drill ended: the product should be offered.
    const after = await agent("POST", "/api/v1/intake", { need: AFTER_END.need, by: "E2E recall drill" });
    expect(after.body.step?.state, JSON.stringify(after.body.step?.notes)).not.toBe("no_options");
    expect(JSON.stringify(after.body.step?.excluded ?? [])).not.toContain(AFTER_END.id);
  } finally {
    await endOurDrills(ops).catch(() => undefined);
    await opsContext.close();
    release();
  }
});

test("a quote chosen from the kitchen's option cards for a held product is refused with recall_hold and the notice", async ({ page, browser, baseURL }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "server-side behaviour; checked once, on chromium-desktop");
  // Known defect: the intake gets `requestQuote: dock.requestQuote` when createDock builds it (src/core/orders.ts:1097),
  // before recallLayer.attach replaces dock.requestQuote with the recall check (src/server/radar/gate.ts attach), so
  // a quote made from an option card (the kitchen console, the voice and photo doors, MCP's intake) bypasses the
  // `recall_hold` rule. It is still refused (the recall-aware catalogue leaves the offer out, and the message quotes
  // the notice), but as `quote_no_offer` / rule `quote_availability`: the hold's refusal count stays 0, no
  // recall_hold refusal reaches the ledger or the safeguard counts, and the drill's "An order stopped" step never
  // fills in from the kitchen's own screen.
  test.fail(!process.env.E2E_EXPECT_FIXED, "intake quotes bypass the recall_hold wrapper (refused as quote_availability)");
  test.setTimeout(300_000);
  const slug = await visitorKitchen(page);
  const agent = consoleAgent(page.request, slug);
  const release = await acquireLock(`recall-${baseURL}`, { timeoutMs: 240_000 });
  const { context: opsContext, ops } = await opsDesk(browser, baseURL);
  try {
    await endOurDrills(ops);
    // Options before the hold: the live status (orderable) is now cached for 120 s.
    const first = await agent("POST", "/api/v1/intake", { need: STALE_CARD.need, by: "E2E recall drill" });
    expect(first.body.step?.requestId).toBeTruthy();
    const pub = await ops.request.post("/ops-api/radar", { data: { action: "drill", productId: STALE_CARD.id } });
    expect(pub.status()).toBe(201);
    await expect.poll(async () => (await radarView(ops)).holds.some((h) => h.productId === STALE_CARD.id), { timeout: 20_000 }).toBe(true);
    const r = await quoteFor(agent, STALE_CARD.need, STALE_CARD.id);
    expect(r.refused, `expected the chosen card to be refused: ${JSON.stringify(r).slice(0, 300)}`).toBeTruthy();
    expect(r.refused.body.error, JSON.stringify(r.refused.body.error).slice(0, 500)).toMatchObject({ rule: "recall_hold", code: "product_on_recall_hold" });
  } finally {
    await endOurDrills(ops).catch(() => undefined);
    await opsContext.close();
    release();
  }
});
