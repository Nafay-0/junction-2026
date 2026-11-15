/** A kitchen conversation on camera: sign in, start clean, say things, wait for the agent (compressed). */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { buyerCount, cardsOf, composer, idle, lastSaid, resetThread, signInKitchen, threadOf } from "./kit";
import { context, passkey, pointerAt, quiet, scrollBy, sleep, type Take, type } from "./rec";
import type { Thread } from "@/server/thread/types";

export class Kitchen {
  ctx!: BrowserContext;
  page!: Page;
  constructor(
    readonly browser: Browser,
    readonly base: string,
    readonly kitchen: string,
  ) {}
  async open(o: { reset?: boolean; path?: string } = {}) {
    this.ctx = await context(this.browser, this.base, "desktop");
    this.page = await this.ctx.newPage();
    await passkey(this.page);
    await signInKitchen(this.ctx, this.base, this.kitchen);
    if (o.reset !== false) await resetThread(this.ctx, this.base, this.kitchen);
    await this.page.goto(o.path ?? `/k/${this.kitchen}`);
    await quiet(this.page);
    await sleep(2000);
    await pointerAt(this.page, 820, 420);
    return this;
  }
  thread() {
    return threadOf(this.ctx, this.base, this.kitchen);
  }
  async bottom() {
    await scrollBy(this.page, 5000, { ms: 1100, at: { x: 640, y: 360 } });
  }
  /** Type words into the composer, send, wait for the reply (compressed in the take), scroll to it. */
  async say(take: Take, words: string, o: { cps?: number; docked?: boolean; label?: string } = {}): Promise<Thread> {
    const before = buyerCount(await this.thread());
    take.event(o.label ?? `typed: ${words}`);
    await type(composer(this.page, o.docked), words, { enter: true, cps: o.cps ?? 20 });
    await sleep(900);
    const t = await take.wait(() => idle(this.ctx, this.base, this.kitchen, before + 1));
    console.log(`  reply to "${words.slice(0, 50)}": ${lastSaid(t)}`);
    await sleep(700);
    if (!o.docked) await this.bottom();
    else await scrollBy(this.page, 5000, { ms: 1100, at: { x: 1100, y: 360 } });
    return t;
  }
  cards(t: Thread) {
    return cardsOf(t);
  }
}
