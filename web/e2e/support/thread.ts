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

/**
 * The newest options card (main f49eea8): the agent's pick first, with one button that says what a tap does ("Order
 * this, 129,00 €" inside the mandate, "Send to <name> to sign, 1 322,00 €" beyond it); the other options folded
 * under "Other options", each with the same kind of button once opened; options the gate would refuse are shown as
 * "Cannot be ordered: <rule>" with no button.
 */
export const CHOICE = /^(Order this|Send to .+ to sign), /;
/** Every choice button of the newest options card (the others' only once their fold is open). */
export const choices = (scope: Page | Locator) => card(scope, "options").getByRole("button", { name: CHOICE });
/** The agent's pick: the first choice button of the newest options card. */
export const pick = (scope: Page | Locator) => choices(scope).first();
/** The folds of the other options (summary + details), not the "not offered: why" note. */
export const otherOptions = (scope: Page | Locator) => card(scope, "options").getByRole("group").filter({ hasNotText: /not offered: why/ });
/** The total a choice button names ("…, 1 322,00 €"). */
export const totalOf = async (button: Locator) => /, ([\d\s\u00a0\u202f.,]+\s?€)$/.exec(((await button.getAttribute("aria-label")) ?? (await button.innerText())).trim())?.[1]?.trim() ?? "";

/** The composer's field (its label changes with what it is set to: asking, changing a request, a product). */
export const composer = (scope: Page | Locator) => scope.getByRole("textbox", { name: /^(Ask, or say what the kitchen needs|What changes\?|How much, and for when\?)$/ }).filter({ visible: true }).first();

/**
 * Type words into the composer and send them (Enter, as a person does), until they are the buyer's turn in the log.
 * A fill that lands before the page has hydrated is wiped by React (seen on WebKit): then it is typed again.
 */
export async function say(scope: Page | Locator, words: string): Promise<void> {
  const field = composer(scope);
  const sent = threadLog(scope).getByText(words.split("\n")[0].slice(0, 60)).first();
  for (let i = 0; i < 3; i++) {
    await field.fill(words);
    await field.press("Enter");
    try {
      await expect(sent).toBeVisible({ timeout: 8_000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
      if ((await field.inputValue().catch(() => "")) === words) continue; // still in the field: send again
    }
  }
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
