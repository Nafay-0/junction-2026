import { beforeEach, describe, expect, it } from "vitest";
import { resolveKitchen } from "@/server/console-kitchens";
import type { Kitchen } from "@/server/kitchen-portal";
import { resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { finishInterview } from "@/server/accounts/interview-run";
import { chooseStart } from "@/server/demo/service";
import { submitTurn, threadStore } from "./engine";

/**
 * The "Try everything" guide in the conversation (server/demo/thread.ts): "what can I try?" says the next thing with
 * the words to say; "show me a stock-out" stages it for this kitchen and says it is staged; both by plain code, for a
 * demo account's own signed-in person only. Anyone else's words go to the agent as before.
 */

async function say(k: Kitchen, text: string, lang = "en"): Promise<string> {
  const store = await threadStore();
  let id = "";
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe(k.info.slug, (e) => {
      if (e.type === "status" && e.turnId === id && e.status !== "working") {
        off();
        resolve();
      }
    });
  });
  id = (await submitTurn(k, { door: "typed", via: "typed", text, lang })).agentTurnId;
  await done;
  return store.agentTurn(store.peek(k.info.slug)!, id)!.line ?? "";
}

async function demoKitchen(username: string, person = true): Promise<Kitchen> {
  const rt = await getRuntime();
  await rt.accounts.signUp({ restaurant: `Ravintola ${username}`, username, password: `a long enough passphrase ${username}` }, "198.51.100.78");
  await finishInterview(rt, (await rt.accounts.get(username))!, { diet: [], skipRest: true });
  await chooseStart(rt, (await rt.accounts.get(username))!, "sample");
  const k = (await resolveKitchen(username))!;
  return { ...k, console: { kitchen: username, session: `s_${username}`, ...(person ? { person: { channel: "portal_session" as const, name: "Chef Ville", account: username } } : {}) } } as Kitchen;
}

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_CATALOG = "seed";
  process.env.DOCK_MEMORY = "off";
  process.env.DOCK_MEMORY_LLM = "off";
  process.env.DOCK_RATE_LIMITS = "off";
  delete process.env.DOCK_DEMO_ACCOUNTS;
});

describe("the demo guide in the conversation", () => {
  it("'what can I try?' says the next thing and the words to say; Finnish too", async () => {
    const k = await demoKitchen("opas");
    expect(await say(k, "what can I try?")).toMatch(/1,000 litres of lactose-free milk/);
    expect(await say(k, "mitä voin kokeilla?", "fi")).toMatch(/laktoositonta/);
  });

  it("'show me a stock-out' is staged for this kitchen and said as staged", async () => {
    const k = await demoKitchen("lavastus");
    const line = await say(k, "show me a stock-out");
    expect(line).toMatch(/staged for the demo/i);
    const rt = await getRuntime();
    expect(rt.dock.ledger.entries().some((e) => (e.data as { event?: string }).event === "demo_staged")).toBe(true);
  });

  it("without the kitchen's signed-in person nothing is staged", async () => {
    const k = await demoKitchen("vieras", false);
    const line = await say(k, "show me a stock-out");
    expect(line).not.toMatch(/staged for the demo/i);
  });
});
