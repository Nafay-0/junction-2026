import { expect, type Locator, type Page } from "@playwright/test";
import { joinAsApprover, signInStage } from "./dock";
import { acquireLock } from "./recall-lock";

/**
 * The kitchen's conversation with its agent (docs/agent-thread.md): the Order page's full-width thread and the dock
 * ("Purchasing agent") on every other store page show the same thread. Locators here use what a person reads and
 * the roles the page exposes (the log, its turns, the cards as articles with their kind label), not layout or
 * classes, so they hold while the cards' look is polished.
 *
 * Models on the test server are the scripted provider (e2e/fixtures/recordings.json): the reader answers the
 * recorded requests, and the store agent sends words that look like a request to its `order` tool.
 */

export const LOG = "Conversation with the purchasing agent";

/** The conversation log inside `scope` (the page, the dock, a region). */
export const threadLog = (scope: Page | Locator) => scope.getByRole("log", { name: LOG }).filter({ visible: true }).first();

/** The thread's turns, oldest first (the log's own list items, not the lists inside cards). */
export const turns = (scope: Page | Locator) => threadLog(scope).locator(":scope > li:not([aria-hidden])");

/** Cards are articles headed by their kind ("What I understood", "Options with live prices", "The gate", ...). */
export const KIND = {
  understood: "What I understood",
  anomaly: "Check before I go on",
  question: "One question",
  options: "Options with live prices",
  price: "Fixed price",
  gate: "The gate",
  order: "Order",
  memory: "Memory",
  records: "From your records",
  notice: "Not done",
} as const;

/** The page a scope belongs to (inner `has` locators must start from the page, not from the scope). */
const pg = (scope: Page | Locator): Page => ("page" in scope && typeof (scope as Locator).page === "function" && !("goto" in scope) ? (scope as Locator).page() : (scope as Page));

export const cards = (scope: Page | Locator, kind: keyof typeof KIND) => threadLog(scope).getByRole("article").filter({ has: pg(scope).getByText(KIND[kind], { exact: true }) });
/** The newest card of a kind. */
export const card = (scope: Page | Locator, kind: keyof typeof KIND) => cards(scope, kind).last();

/** The options of the newest options card: one list item per option, ranked Best / Better / Good. */
export const options = (scope: Page | Locator) => card(scope, "options").getByRole("listitem").filter({ has: pg(scope).getByRole("button", { name: "Choose" }) });
export const option = (scope: Page | Locator, rank: "Best" | "Better" | "Good") => options(scope).filter({ hasText: new RegExp(`^\\s*${rank}(?![a-z])`) });

/** The composer's field (its label changes with what it is set to: asking, changing a request, a product). */
export const composer = (scope: Page | Locator) => scope.getByRole("textbox", { name: /^(Ask, or say what the kitchen needs|What changes\?|How much, and for when\?)$/ }).filter({ visible: true }).first();

/** Type words into the composer and send them (Enter, as a person does). */
export async function say(scope: Page | Locator, words: string): Promise<void> {
  const field = composer(scope);
  await field.fill(words);
  await field.press("Enter");
  await expect(field).toHaveValue("", { timeout: 15_000 });
}

/** The agent turn that answers the newest buyer turn with these words. */
export const answerTo = (scope: Page | Locator, words: string | RegExp) =>
  turns(scope).filter({ has: pg(scope).getByText(words, { exact: typeof words === "string" }) }).last().locator("xpath=following-sibling::li[1]");

/** A visitor kitchen of this phone (join, passkey); returns its slug. The page stays on /approver. */
export async function visitorKitchen(page: Page): Promise<string> {
  await joinAsApprover(page);
  const res = await page.request.get("/k/mine", { maxRedirects: 0 });
  const slug = (res.headers()["location"] ?? "").split("/k/")[1]?.split(/[/?#]/)[0];
  expect(slug, "the /k/mine redirect names the visitor's kitchen").toMatch(/^sbx_/);
  return slug;
}

/**
 * A stage kitchen's thread to itself: the stage kitchens (kaari, laakso) have one thread each, shared by every test
 * and project on the server, so a test that talks to one takes a cross-process lock, signs in and starts the thread
 * over. Returns the release; call it in `finally`.
 */
export async function stageThread(page: Page, kitchen: "kaari" | "laakso", baseURL: string | undefined): Promise<() => void> {
  const release = await acquireLock(`thread-${kitchen}-${baseURL}`, { timeoutMs: 300_000 });
  try {
    await signInStage(page, kitchen);
    const r = await page.request.post(`/ui-api/kitchens/${kitchen}/thread/reset`);
    expect(r.ok(), `reset ${kitchen}'s thread: ${r.status()}`).toBe(true);
    return release;
  } catch (e) {
    release();
    throw e;
  }
}

/** Minutes from now (the page's clock, Helsinki) to an "HH.MM" or "HH:MM" time later today. */
export function minutesUntil(hhmm: string, now = new Date()): number {
  const [h, m] = hhmm.split(/[.:]/).map(Number);
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Helsinki" }));
  let d = h * 60 + m - (local.getHours() * 60 + local.getMinutes());
  if (d < -720) d += 1440;
  return d;
}
