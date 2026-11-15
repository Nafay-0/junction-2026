/** Kitchen and operations helpers for the demo video takes (local server only). */
import type { BrowserContext, Page } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
import type { AgentTurn, Card, Thread } from "@/server/thread/types";
import { sleep } from "./rec";

export const PASSCODE = process.env.DOCK_OPS_PASSCODE || "capture-ops";

export async function signInKitchen(ctx: BrowserContext, base: string, username: string) {
  const account = TEST_ACCOUNTS.find((a) => a.username === username)!;
  const r = await ctx.request.post(`${base}/ui-api/account/signin`, { data: { username: account.username, password: account.password } });
  if (!r.ok()) throw new Error(`sign-in as ${username}: HTTP ${r.status()}`);
}

export async function signInOps(ctx: BrowserContext, base: string, name = "Operations") {
  const r = await ctx.request.post(`${base}/ops-api/session`, { data: { passcode: PASSCODE, name } });
  if (!r.ok()) throw new Error(`operations sign-in: HTTP ${r.status()}`);
}

/** The shared test accounts back to their seed (rules, mandate, history). */
export async function resetTestAccounts(ctx: BrowserContext, base: string) {
  await signInOps(ctx, base);
  const r = await ctx.request.post(`${base}/ops-api/accounts/reset`, { headers: { origin: base } });
  console.log(`  test accounts reset: HTTP ${r.status()}`);
}

export async function resetThread(ctx: BrowserContext, base: string, kitchen: string) {
  await ctx.request.post(`${base}/ui-api/kitchens/${kitchen}/thread/reset`, { data: {} });
}

export async function threadOf(ctx: BrowserContext, base: string, kitchen: string): Promise<Thread> {
  const r = await ctx.request.get(`${base}/ui-api/kitchens/${kitchen}/thread`);
  return ((await r.json()) as { thread: Thread }).thread;
}
export const cardsOf = (t: Thread): Card[] => t.turns.flatMap((x) => (x.role === "agent" ? x.cards : []));
export const lastAgent = (t: Thread) => [...t.turns].reverse().find((x): x is AgentTurn => x.role === "agent");

/** Until the agent has answered the buyer's `buyers`-th turn. */
export async function idle(ctx: BrowserContext, base: string, kitchen: string, buyers: number, ms = 150_000): Promise<Thread> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await threadOf(ctx, base, kitchen);
    const b = t.turns.filter((x) => x.role === "buyer");
    const lastB = b.at(-1);
    const a = lastB && t.turns.find((x): x is AgentTurn => x.role === "agent" && x.replyTo === lastB.turnId);
    if (b.length >= buyers && a && a.status !== "working") return t;
    await sleep(500);
  }
  throw new Error("the agent did not finish its turn");
}

export const buyerCount = (t: Thread) => t.turns.filter((x) => x.role === "buyer").length;

/** The words of the agent's last reply (for the log). */
export function lastSaid(t: Thread): string {
  const a = lastAgent(t);
  if (!a) return "";
  const texts = [...JSON.stringify(a).matchAll(/"(?:text|say|message|sentence)":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  return texts.join(" | ").slice(0, 500);
}

export const composer = (page: Page, docked = false) => (docked ? page.locator("#assistant").getByRole("textbox").last() : page.getByRole("textbox").last());
