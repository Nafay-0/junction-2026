import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from "playwright-core";
import { isIdentityHost, isPaymentFrame, isPaymentHost, isSensitiveField, judge, refusesAssistedSignIn, type Step, type Target, type Verdict } from "./guard";
import {
  IDLE_STATE,
  VIEWPORT,
  type AgentAction,
  type Box,
  type BrowserEvent,
  type BrowserState,
  type BrowserStepData,
  type ControlRequest,
  type Handover,
  type UserInput,
} from "./protocol";
import { renderPage, type AriaNode } from "./snapshot";

/*
 * One live browser per visitor: a real Chrome on this machine, driven through Playwright.
 *
 * - The agent's steps go through `open`, `act` and `read`. Each one is announced to the people
 *   watching before it happens, checked against the safety rules in `guard.ts`, and answered with
 *   the page as it then stands.
 * - People watching get frames and state through `subscribe`. While the user is in control, their
 *   mouse and keys go straight to the page and the agent waits.
 * - Sign-ins live in a profile folder per visitor until `forget` wipes it.
 *
 * What the user types while in control is passed to Chrome and nothing else: it is not logged,
 * not stored, and the agent does not read the page during that time.
 */

const HEADED = process.env.HOVI_BROWSER_HEADED === "1";
// Sign-ins live outside the project folder: they are the user's, not the app's, and a path under
// the project makes the bundler try to trace the whole folder into the build.
const PROFILE_ROOT = process.env.HOVI_BROWSER_PROFILES || path.join(homedir(), ".hovi", "browser-profiles");
const MAX_BROWSERS = 4;
const IDLE_CLOSE_MS = 20 * 60_000;
/** How long the agent waits for the user to hand the page back before giving up on a step. */
const WAIT_FOR_USER_MS = 90_000;

/*
 * The user's own Chrome: the browser they already use, signed in to their accounts.
 *
 * Chrome (144 and later) lets an app attach to it once the user has turned that on at
 * chrome://inspect/#remote-debugging, and asks them to allow each connection. Chrome then writes
 * where to connect into its profile folder; that file is how we know the setting is on. Nothing is
 * hidden from sites: Chrome shows that it is being controlled. There is simply nothing to sign in
 * to, because the user did that themselves, in their own browser, long before.
 *
 * Baton opens a window of its own there and works only in it. The user's other windows and tabs
 * are never read, touched or closed.
 *
 * Set HOVI_OWN_CHROME=0 on a hosted server, where "the user's Chrome" is not on that machine.
 */
function chromeFolder(): string | null {
  if (process.env.HOVI_OWN_CHROME === "0") return null;
  const folder =
    registry.chromeFolder ??
    process.env.HOVI_CHROME_DIR ??
    (process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support", "Google", "Chrome")
      : process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data")
        : path.join(homedir(), ".config", "google-chrome"));
  return existsSync(folder) ? folder : null;
}

function ownStatus(): BrowserState["own"] {
  const folder = chromeFolder();
  if (!folder) return "unavailable";
  return existsSync(path.join(folder, "DevToolsActivePort")) ? "ready" : "setup";
}

/** Where Chrome says an app may connect: the port and path it wrote into its profile folder. */
function ownEndpoint(): string | null {
  const folder = chromeFolder();
  if (!folder) return null;
  try {
    const [port, wsPath] = readFileSync(path.join(folder, "DevToolsActivePort"), "utf8").trim().split("\n");
    return port && wsPath ? `ws://127.0.0.1:${port.trim()}${wsPath.trim()}` : null;
  } catch {
    return null;
  }
}

const OWN_SETUP = "Your Chrome does not allow an app to connect yet. Open chrome://inspect/#remote-debugging in Chrome and turn on \"Allow remote debugging for this browser instance\".";

type OwnChrome = { browser: Browser; context: BrowserContext; cdp: CDPSession };

/**
 * One connection to the user's Chrome for the whole server, kept open between tasks so Chrome
 * asks the user to allow it once, not every time.
 */
function ownChrome(): Promise<OwnChrome> {
  registry.own ??= (async () => {
    const endpoint = ownEndpoint();
    if (!endpoint) throw new Error(OWN_SETUP);
    // Chrome shows "Allow remote debugging?" and waits for the user: give them time to press Allow.
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 120_000 });
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close().catch(() => {});
      throw new Error("Chrome connected but has no window to work in. Open a Chrome window and try again.");
    }
    const cdp = await browser.newBrowserCDPSession();
    browser.on("disconnected", () => {
      registry.own = undefined;
      for (const session of everySession()) {
        try {
          session.ownChromeGone();
        } catch {
          /* one session failing to tidy up must not take the server down */
        }
      }
    });
    return { browser, context, cdp };
  })();
  registry.own.catch(() => {
    registry.own = undefined;
  });
  return registry.own;
}

async function targetIdOf(page: Page): Promise<string | null> {
  try {
    const session = await page.context().newCDPSession(page);
    const info = (await session.send("Target.getTargetInfo")) as { targetInfo: { targetId: string } };
    await session.detach().catch(() => {});
    return info.targetInfo.targetId;
  } catch {
    return null;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export type ActInput = {
  action: "click" | "type" | "select" | "press" | "scroll" | "hover" | "back" | "wait";
  ref?: string;
  /** "type": the text. "select": the option's label. "press": the key. */
  text?: string;
  /** "type": press Enter afterwards. */
  submit?: boolean;
  direction?: "up" | "down";
  seconds?: number;
  commits?: boolean;
};

/** Runs inside the page: what an element is, for the safety rules and for captions. */
function describeInPage(el: Element) {
  const clean = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const subject = (el.closest("button, [role=button], a, input[type=submit], input[type=button], summary") as HTMLElement | null) ?? (el as HTMLElement);
  const field = el as HTMLInputElement;
  const attr = (node: Element, name: string) => clean(node.getAttribute(name), 200);
  const tag = subject.tagName.toLowerCase();
  const type = attr(subject, "type").toLowerCase();
  const labels = field.labels ? Array.from(field.labels).map((l) => l.textContent ?? "").join(" ") : "";
  const isField = /^(input|textarea|select)$/.test(el.tagName.toLowerCase()) && !/^(submit|button|image|reset)$/.test(attr(el, "type").toLowerCase());
  const text = isField ? "" : clean(subject.innerText || (subject as HTMLInputElement).value || attr(subject, "aria-label") || attr(subject, "title"), 160);
  const name = isField
    ? clean(attr(el, "aria-label") || labels || attr(el, "placeholder") || attr(el, "title") || attr(el, "name"), 80)
    : clean(attr(subject, "aria-label") || text, 80);
  const hint = clean([attr(el, "name"), attr(el, "id"), attr(el, "placeholder"), attr(el, "aria-label"), labels, attr(el, "data-testid")].join(" "), 300);
  const form = el.closest("form");
  const shown = (node: Element) => {
    const r = node.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const cards =
    'input[autocomplete^="cc-"], input[name*="cardnumber" i], input[name*="card_number" i], input[name*="card-number" i], input[id*="cardnumber" i], input[id*="card-number" i], input[id*="card_number" i], input[name*="cvv" i], input[name*="cvc" i], input[data-stripe]';
  const scope: ParentNode = form ?? document;
  const nearPayment =
    Array.from(scope.querySelectorAll(cards)).some(shown) ||
    Array.from(scope.querySelectorAll("iframe")).some((f) => /stripe|adyen|braintree|checkout\.com|klarna|hosted-?fields|securedfields/i.test(`${f.src} ${f.name} ${f.title}`) && shown(f));
  const submits = tag === "input" ? type === "submit" || type === "image" : tag === "button" ? type === "submit" || (type === "" && Boolean(form)) : false;
  const submitEl = form?.querySelector('button[type=submit], input[type=submit], button:not([type])') as HTMLElement | null;
  const formSubmitText = submitEl ? clean(submitEl.innerText || (submitEl as HTMLInputElement).value || submitEl.getAttribute("aria-label"), 160) : "";
  const words = `${attr(el, "placeholder")} ${attr(el, "aria-label")}`;
  const search =
    attr(el, "type").toLowerCase() === "search" ||
    attr(el, "role") === "searchbox" ||
    Boolean(el.closest("[role=search]")) ||
    /^(q|query|search|haku|s|keywords?)$/i.test(attr(el, "name")) ||
    /search|haku|hae |s[öo]k|suche|recherch|buscar|cerca/i.test(words) ||
    (form ? /search|haku/i.test(form.getAttribute("action") ?? "") : false);
  const banner = el.closest(
    '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="onetrust" i], [id*="usercentrics" i], [id*="didomi" i], [aria-label*="cookie" i], [aria-label*="consent" i]',
  );
  // Sites put "has-cookie-banner" on <body>: that is not a banner. A banner floats over the page or is a small part of it.
  const floats = banner ? /fixed|sticky|absolute/.test(getComputedStyle(banner).position) || Boolean(banner.closest("[role=dialog], [role=alertdialog], dialog")) : false;
  const small = banner ? banner.getBoundingClientRect().width * banner.getBoundingClientRect().height < window.innerWidth * window.innerHeight * 0.5 : false;
  const consent = Boolean(banner) && banner !== document.body && banner !== document.documentElement && (floats || small);
  return {
    tag,
    type: isField ? attr(el, "type").toLowerCase() : type,
    role: attr(subject, "role"),
    autocomplete: attr(el, "autocomplete").toLowerCase(),
    text,
    name,
    hint,
    frameHost: location.hostname,
    frameUrl: location.href,
    inFrame: window.top !== window,
    submits,
    formSubmitText,
    nearPayment,
    search,
    consent,
  };
}

/** Runs inside a frame: where the fields are whose values the agent must not read. */
function sensitiveBoxesInPage() {
  const out: Array<{ x: number; y: number; width: number; height: number }> = [];
  const hinted = /card|cvv|cvc|csc|iban|security.?code|one.?time|otp|verification|pass(word|code)|salasana|pin\b/i;
  for (const el of Array.from(document.querySelectorAll("input, textarea"))) {
    const input = el as HTMLInputElement;
    const type = (input.getAttribute("type") ?? "").toLowerCase();
    const ac = (input.getAttribute("autocomplete") ?? "").toLowerCase();
    const hint = `${input.name} ${input.id} ${input.getAttribute("placeholder") ?? ""} ${input.getAttribute("aria-label") ?? ""}`;
    if (type === "password" || ac.startsWith("cc-") || ac.includes("password") || ac === "one-time-code" || hinted.test(hint)) {
      const r = input.getBoundingClientRect();
      out.push({ x: r.x, y: r.y, width: r.width, height: r.height });
    }
  }
  return out;
}

/**
 * Runs inside the page: is there a "verify you are human" check that has not been passed?
 * These widgets sit in frames the agent cannot read, so without this the agent only sees a
 * button that stays disabled and has no idea why.
 */
function humanCheckInPage() {
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 30 && r.height > 20;
  };
  const widgets = Array.from(
    document.querySelectorAll('.cf-turnstile, .h-captcha, .g-recaptcha:not([data-size="invisible"]), .frc-captcha, #px-captcha, [data-sitekey]:not([data-size="invisible"])'),
  ).filter(shown);
  const frames = Array.from(document.querySelectorAll("iframe")).filter(
    (f) =>
      /challenges\.cloudflare\.com|hcaptcha\.com|recaptcha\/(api2|enterprise)\/(anchor|bframe)|arkoselabs|funcaptcha|friendlycaptcha|captcha-delivery|geetest/i.test(f.src) &&
      !/size=invisible/.test(f.src) &&
      !f.closest(".grecaptcha-badge") &&
      shown(f),
  );
  // The widget writes its answer into a hidden field once the check is passed.
  const answers = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="cf-turnstile-response"], textarea[name="h-captcha-response"], textarea[name="g-recaptcha-response"], input[name="frc-captcha-solution"]'),
  );
  const visibleAnswer = answers.some((a) => a.parentElement !== null && shown(a.parentElement));
  if (!widgets.length && !frames.length && !visibleAnswer) return false;
  return answers.length === 0 ? widgets.length + frames.length > 0 : answers.some((a) => !a.value);
}

type Listener = (event: BrowserEvent) => void;

export class BrowserSession {
  readonly id: string;
  lastUsed = Date.now();

  private context?: BrowserContext;
  private page?: Page;
  private pages: Page[] = [];
  private pageIds = new WeakMap<Page, string>();
  private cdp = new WeakMap<Page, CDPSession>();
  private starting?: Promise<void>;
  private listeners = new Set<Listener>();
  private lastFrame?: Extract<BrowserEvent, { type: "frame" }>;
  private state: BrowserState = { ...IDLE_STATE, own: ownStatus() };
  private kind: BrowserState["kind"] = "assisted";
  /** In the user's own Chrome: the connection, and the window that is ours. Everything else there is theirs. */
  private own?: OwnChrome;
  private windowId?: number;
  private ownPageListener?: (page: Page) => void;
  private heartbeat?: ReturnType<typeof setInterval>;
  private frameTimers: Array<ReturnType<typeof setTimeout>> = [];
  private lastFrameAt = 0;
  private snapping = false;
  /** Message boxes the page showed since the model last read it. */
  private dialogs: string[] = [];
  /** Pictures of the page taken for the model, by tool call. Only the last few are kept. */
  private pictures = new Map<string, string>();
  private actionId = 0;
  private tabSeq = 0;
  /** Agent steps run one at a time, in the order they were asked for. */
  private chain: Promise<unknown> = Promise.resolve();
  private inputChain: Promise<unknown> = Promise.resolve();
  private modifiers = new Set<string>();
  private statePending = false;
  /** Approval decisions by tool call, so a step is judged once and the answer holds when it is replayed. */
  private approvals = new Map<string, Verdict>();
  private timeZone?: string;

  constructor(id: string) {
    this.id = id;
  }

  /* ───────────────────────── Watching ───────────────────────── */

  snapshotState(): BrowserState {
    return { ...this.state, kind: this.kind, own: ownStatus(), tabs: this.tabs() };
  }

  /** The idle state with the optional parts spelled out, so closing a browser leaves no stale banner behind. */
  private cleared(): BrowserState {
    return { ...IDLE_STATE, handover: undefined, approval: undefined, error: undefined, kind: this.kind, own: ownStatus() };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.lastUsed = Date.now();
    listener({ type: "state", state: this.snapshotState() });
    if (this.lastFrame && this.state.status === "ready") listener(this.lastFrame);
    this.kick(60);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get watchers(): number {
    return this.listeners.size;
  }

  get running(): boolean {
    return Boolean(this.context);
  }

  private emit(event: BrowserEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a broken stream must not stop the browser */
      }
    }
  }

  private patch(change: Partial<BrowserState>) {
    Object.assign(this.state, change);
    if (this.statePending) return;
    this.statePending = true;
    queueMicrotask(() => {
      this.statePending = false;
      this.emit({ type: "state", state: this.snapshotState() });
    });
  }

  private tabs() {
    return this.pages.map((p) => ({ id: this.pageIds.get(p) ?? "", title: this.titles.get(p) ?? "", url: p.url(), active: p === this.page }));
  }
  private titles = new WeakMap<Page, string>();

  /* ───────────────────────── Starting and stopping ───────────────────────── */

  setTimeZone(timeZone: string | undefined) {
    if (!this.context) this.timeZone = timeZone;
  }

  async ensureStarted(): Promise<Page> {
    this.lastUsed = Date.now();
    if (this.page && this.context) return this.page;
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    await this.starting;
    if (!this.page) throw new Error(this.state.error ?? "The browser could not be started.");
    return this.page;
  }

  private async start() {
    this.patch({ status: "starting", error: undefined });
    try {
      if (this.kind === "own") await this.startInOwnChrome();
      else await this.startAssisted();
      this.patch({ status: "ready", activity: "" });
    } catch (err) {
      this.context = undefined;
      this.page = undefined;
      const message = err instanceof Error ? err.message.split("\n")[0] : "The browser could not be started.";
      const error = /executable doesn't exist|chrome.*not found|ENOENT/i.test(message)
        ? "Google Chrome is not installed on the computer that runs this app."
        : this.kind === "own" && /timeout|ECONNREFUSED|closed|refused|socket/i.test(message)
          ? "Chrome did not let the app connect. Check that Chrome is open, that remote debugging is still turned on at chrome://inspect/#remote-debugging, and press Allow when Chrome asks."
          : clip(message, 260);
      this.patch({ status: "error", error, activity: "" });
    }
  }

  /** A Chrome of the app's own: hidden, with a profile per visitor that keeps their sign-ins. */
  private async startAssisted() {
    await makeRoom(this);
    const userAgent = HEADED ? undefined : await plainUserAgent();
    const context = await chromium.launchPersistentContext(path.join(PROFILE_ROOT, this.id), {
      channel: "chrome",
      headless: !HEADED,
      viewport: { ...VIEWPORT },
      userAgent,
      locale: "en-GB",
      timezoneId: this.timeZone,
      acceptDownloads: false,
      // The agent's own pointer is drawn by the interface, so Chrome's automation banner would only confuse.
      args: ["--disable-infobars", "--no-default-browser-check", "--no-first-run"],
    });
    this.context = context;
    context.on("page", (page) => this.adopt(page, true));
    context.on("close", () => this.onClosed());
    const first = context.pages()[0] ?? (await context.newPage());
    for (const page of context.pages()) this.adopt(page, page === first);
  }

  /** A window of our own in the Chrome the user already uses. */
  private async startInOwnChrome() {
    if (ownStatus() !== "ready") throw new Error(OWN_SETUP);
    this.patch({ activity: "Waiting for you to press Allow in Chrome" });
    const own = await ownChrome();
    this.patch({ activity: "" });
    const created: Page[] = [];
    const collect = (page: Page) => {
      created.push(page);
    };
    own.context.on("page", collect);
    let page: Page | undefined;
    try {
      // In the background: the user is looking at Baton, and the live view shows them the page.
      const { targetId } = (await own.cdp.send("Target.createTarget", { url: "about:blank", newWindow: true, background: true })) as { targetId: string };
      const { windowId } = (await own.cdp.send("Browser.getWindowForTarget", { targetId })) as { windowId: number };
      this.windowId = windowId;
      for (let i = 0; i < 60 && !page; i++) {
        for (const candidate of created) if ((await targetIdOf(candidate)) === targetId) page = candidate;
        if (!page) await delay(100);
      }
      await own.cdp.send("Browser.setWindowBounds", { windowId, bounds: { width: VIEWPORT.width + 24, height: VIEWPORT.height + 150 } }).catch(() => {});
    } finally {
      own.context.off("page", collect);
    }
    if (!page) throw new Error("Chrome did not open a window for the app to work in.");
    await page.setViewportSize({ ...VIEWPORT });
    this.own = own;
    this.context = own.context;
    this.ownPageListener = (candidate) => void this.adoptIfOurs(candidate);
    own.context.on("page", this.ownPageListener);
    // A window behind others stops sending pictures by itself: ask for one now and then.
    this.heartbeat = setInterval(() => void this.snap(), 2500);
    this.adopt(page, true);
  }

  /** In the user's Chrome, only what our own window opens is ours. Their tabs are not adopted. */
  private async adoptIfOurs(page: Page) {
    if (this.kind !== "own" || !this.own) return;
    try {
      const opener = await page.opener().catch(() => null);
      let ours = Boolean(opener && this.pages.includes(opener));
      if (!ours) {
        const targetId = await targetIdOf(page);
        if (targetId) {
          const { windowId } = (await this.own.cdp.send("Browser.getWindowForTarget", { targetId })) as { windowId: number };
          ours = windowId === this.windowId;
        }
      }
      if (!ours) return;
      await page.setViewportSize({ ...VIEWPORT }).catch(() => {});
      this.adopt(page, true);
    } catch {
      /* the page closed before we could tell */
    }
  }

  /** Close our window in the user's Chrome. The connection stays, so Chrome does not ask again next time. */
  private async leaveOwnChrome() {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    for (const timer of this.frameTimers) clearTimeout(timer);
    this.frameTimers = [];
    if (this.own && this.ownPageListener) this.own.context.off("page", this.ownPageListener);
    this.ownPageListener = undefined;
    const pages = [...this.pages];
    this.pages = [];
    this.page = undefined;
    for (const page of pages) await page.close().catch(() => {});
    this.own = undefined;
    this.windowId = undefined;
    this.context = undefined;
  }

  /** The user quit Chrome, or turned remote debugging off. */
  ownChromeGone() {
    if (this.kind !== "own" || !this.context) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.own = undefined;
    this.windowId = undefined;
    this.onClosed();
  }

  /**
   * In the user's own Chrome the window can sit behind others, where Chrome stops sending pictures
   * of it. After anything that may have changed the page, take one ourselves.
   */
  private kick(...delays: number[]) {
    if (this.kind !== "own" || !this.context) return;
    for (const ms of delays.length ? delays : [150, 700, 1800]) this.frameTimers.push(setTimeout(() => void this.snap(), ms));
    if (this.frameTimers.length > 40) this.frameTimers.splice(0, this.frameTimers.length - 40);
  }

  private async snap() {
    const page = this.page;
    if (this.kind !== "own" || !page || page.isClosed() || this.listeners.size === 0 || this.snapping) return;
    if (Date.now() - this.lastFrameAt < 250) return;
    this.snapping = true;
    try {
      const shot = await page.screenshot({ type: "jpeg", quality: 70, scale: "css", caret: "initial", timeout: 4000 });
      if (page === this.page) {
        this.lastFrameAt = Date.now();
        this.lastFrame = { type: "frame", data: shot.toString("base64"), width: VIEWPORT.width, height: VIEWPORT.height };
        this.emit(this.lastFrame);
      }
    } catch {
      /* the page is navigating: the next one will do */
    } finally {
      this.snapping = false;
    }
  }

  private adopt(page: Page, activate: boolean) {
    if (this.pages.includes(page)) return;
    this.pages.push(page);
    this.pageIds.set(page, `t${++this.tabSeq}`);
    page.on("close", () => {
      this.pages = this.pages.filter((p) => p !== page);
      if (this.page === page) {
        this.page = undefined;
        const next = this.pages.at(-1);
        if (next) void this.activate(next);
      }
      // In the user's Chrome, closing our window by hand is closing the browser as far as the app goes.
      if (this.kind === "own" && this.context && this.pages.length === 0) {
        void this.leaveOwnChrome().then(() => this.onClosed());
        return;
      }
      this.patch({});
    });
    // A page's own message boxes are not part of the picture, so nobody would see them. A plain
    // notice is acknowledged. A question is answered "no" while the agent is driving (it must not
    // confirm things by reflex) and "yes" while the user is, who has just pressed the button.
    page.on("dialog", (dialog) => {
      const kind = dialog.type();
      const yes = kind === "alert" || kind === "beforeunload" || this.state.control === "user";
      if (kind !== "beforeunload") {
        this.dialogs.push(`${kind === "alert" ? "The page showed a notice" : "The page asked"}: "${clip(dialog.message(), 240)}"${kind === "alert" ? "" : yes ? " (answered OK)" : " (answered Cancel)"}`);
        if (this.dialogs.length > 5) this.dialogs.shift();
      }
      void (yes ? dialog.accept() : dialog.dismiss()).catch(() => {});
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) void this.refresh(page);
    });
    page.on("domcontentloaded", () => void this.refresh(page));
    page.on("load", () => {
      if (page === this.page) this.patch({ loading: false });
      void this.refresh(page);
    });
    page.on("request", (request) => {
      if (page === this.page && request.isNavigationRequest() && request.frame() === page.mainFrame()) this.patch({ loading: true });
    });
    if (activate || !this.page) void this.activate(page);
    else this.patch({});
  }

  private async activate(page: Page, raise = false) {
    const previous = this.page;
    if (previous === page) return;
    this.page = page;
    try {
      if (previous && !previous.isClosed()) await previous.screencast.stop();
    } catch {
      /* already stopped */
    }
    try {
      // In the user's own Chrome, bringing a tab forward would pull that window over the app they
      // are looking at. Only do it when they picked the tab themselves.
      if (this.kind !== "own" || raise) await page.bringToFront();
      await page.screencast.start({
        size: { ...VIEWPORT },
        quality: 72,
        onFrame: (frame) => {
          if (page !== this.page) return;
          this.lastFrameAt = Date.now();
          this.lastFrame = { type: "frame", data: frame.data.toString("base64"), width: frame.viewportWidth, height: frame.viewportHeight };
          this.emit(this.lastFrame);
        },
      });
    } catch {
      /* the page closed while we were switching to it */
    }
    await this.refresh(page);
    this.kick();
  }

  /** Bring the address, title and history buttons up to date. */
  private async refresh(page: Page) {
    if (page.isClosed()) return;
    try {
      this.titles.set(page, await page.title());
    } catch {
      /* navigating */
    }
    if (page !== this.page) {
      this.patch({});
      return;
    }
    const url = page.url();
    let canGoBack = false;
    let canGoForward = false;
    try {
      let session = this.cdp.get(page);
      if (!session) {
        session = await page.context().newCDPSession(page);
        this.cdp.set(page, session);
      }
      const history = (await session.send("Page.getNavigationHistory")) as { currentIndex: number; entries: unknown[] };
      canGoBack = history.currentIndex > 0;
      canGoForward = history.currentIndex < history.entries.length - 1;
    } catch {
      /* not worth failing over */
    }
    this.patch({ url: url === "about:blank" ? "" : url, title: this.titles.get(page) ?? "", canGoBack, canGoForward, paymentPage: await this.looksLikePayment(page) });
    this.kick(200, 900);
  }

  private onClosed() {
    this.context = undefined;
    this.page = undefined;
    this.pages = [];
    this.lastFrame = undefined;
    this.dialogs = [];
    this.pictures.clear();
    this.approvals.clear();
    this.modifiers.clear();
    this.patch({ ...this.cleared(), status: "closed" });
  }

  async close() {
    if (this.kind === "own") {
      await this.leaveOwnChrome();
      this.onClosed();
      return;
    }
    const context = this.context;
    if (!context) {
      this.patch({ ...this.cleared(), status: "closed" });
      return;
    }
    try {
      await context.close();
    } catch {
      this.onClosed();
    }
  }

  /** Close the browser and wipe every sign-in, cookie and saved form entry of the assisted browser. */
  async forget() {
    await this.close();
    // The user's own Chrome is theirs: nothing of it is ever wiped from here.
    if (this.kind === "assisted") await rm(path.join(PROFILE_ROOT, this.id), { recursive: true, force: true }).catch(() => {});
    this.patch({ ...this.cleared() });
  }

  /** What the interface last chose, applied when no browser is open. A running browser is not swapped behind the agent's back. */
  preferKind(kind: BrowserState["kind"]) {
    if (kind === this.kind || this.running || this.starting) return;
    if (kind === "own" && ownStatus() === "unavailable") return;
    this.kind = kind;
    this.patch({});
  }

  /** Move to the other browser. With `reopen`, the page that is open comes along, and so does a hand-over in progress. */
  private async switchKind(kind: BrowserState["kind"], reopen: boolean) {
    if (kind === this.kind || (kind === "own" && ownStatus() === "unavailable")) {
      this.patch({});
      return;
    }
    const url = this.page && !this.page.isClosed() ? this.page.url() : "";
    const carried = { control: this.state.control, handover: this.state.handover };
    if (this.running) await this.close();
    this.kind = kind;
    this.patch({ ...this.cleared(), ...(reopen ? carried : {}) });
    if (!reopen || !/^https?:/.test(url)) return;
    try {
      const page = await this.ensureStarted();
      this.patch(carried);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => {});
      await this.refresh(page);
    } catch {
      /* the error state says why */
    }
  }

  /* ───────────────────────── The user's side ───────────────────────── */

  /** A new request from the chat: whatever was waiting for approval has been answered. */
  beginTurn() {
    if (this.state.approval) this.patch({ approval: undefined });
  }

  /** The agent has asked the user to step in. */
  requestHandover(handover: Handover) {
    this.patch({ control: "user", handover, busy: false, activity: "", approval: undefined });
  }

  async control(request: ControlRequest): Promise<BrowserState> {
    this.lastUsed = Date.now();
    switch (request.action) {
      case "take":
        this.patch({ control: "user" });
        break;
      case "release":
        this.modifiers.clear();
        this.patch({ control: "agent", handover: undefined });
        break;
      case "kind":
        await this.switchKind(request.kind === "own" ? "own" : "assisted", request.reopen === true);
        break;
      case "close":
        await this.close();
        break;
      case "forget":
        await this.forget();
        break;
      case "tab": {
        const page = this.pages.find((p) => this.pageIds.get(p) === request.tabId);
        if (page) await this.activate(page, true);
        break;
      }
      case "back":
      case "forward":
      case "reload":
      case "navigate": {
        // The address bar and its buttons are the user's: they work only while the user is driving.
        if (this.state.control !== "user") break;
        const page = await this.ensureStarted();
        try {
          if (request.action === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 });
          else if (request.action === "forward") await page.goForward({ waitUntil: "domcontentloaded", timeout: 15_000 });
          else if (request.action === "reload") await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
          else await page.goto(toAddress(request.url), { waitUntil: "domcontentloaded", timeout: 25_000 });
        } catch {
          /* the page shows its own error */
        }
        break;
      }
    }
    return this.snapshotState();
  }

  /** The user's mouse and keys, passed straight to the page. Nothing here is logged or kept. */
  input(events: UserInput[]): boolean {
    if (this.state.control !== "user" || !this.page) return false;
    this.lastUsed = Date.now();
    this.inputChain = this.inputChain.then(async () => {
      const page = this.page;
      if (!page || page.isClosed() || this.state.control !== "user") return;
      for (const event of events) {
        try {
          if (event.type === "mouse") {
            if (event.action === "move") await page.mouse.move(event.x, event.y);
            else if (event.action === "down") {
              await page.mouse.move(event.x, event.y);
              await page.mouse.down({ button: event.button ?? "left", clickCount: event.clickCount ?? 1 });
            } else await page.mouse.up({ button: event.button ?? "left", clickCount: event.clickCount ?? 1 });
          } else if (event.type === "wheel") {
            await page.mouse.move(event.x, event.y);
            await page.mouse.wheel(event.deltaX, event.deltaY);
          } else if (event.type === "text") {
            await page.keyboard.insertText(event.text);
          } else {
            await this.key(page, event.action, event.key);
          }
        } catch {
          /* a key Chrome does not know, or the page went away: skip it */
        }
      }
      this.kick(90, 450, 1200);
    });
    return true;
  }

  private async key(page: Page, action: "down" | "up", key: string) {
    const modifier = key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
    if (modifier) {
      if (action === "down") this.modifiers.add(key);
      else this.modifiers.delete(key);
    }
    const name = key === " " ? "Space" : key;
    const plainChar = [...key].length === 1 && !this.modifiers.has("Control") && !this.modifiers.has("Meta") && !this.modifiers.has("Alt");
    try {
      if (action === "down") await page.keyboard.down(name);
      else await page.keyboard.up(name);
    } catch {
      // A character outside the keyboard layout Playwright knows ("ä", "é"): insert it as text.
      if (plainChar && action === "down") await page.keyboard.insertText(key);
    }
  }

  /* ───────────────────────── The agent's side ───────────────────────── */

  /** Run one agent step at a time, and only while the agent is the one driving. */
  private queue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  private async waitForAgentTurn(signal?: AbortSignal): Promise<string | null> {
    const deadline = Date.now() + WAIT_FOR_USER_MS;
    while (this.state.control === "user") {
      if (signal?.aborted) return "Stopped.";
      if (Date.now() > deadline) {
        return "The user has taken over the browser and has not handed it back. Do nothing more in the browser now: tell the user you are waiting, in one sentence.";
      }
      await delay(400);
    }
    return null;
  }

  private announce(action: Omit<AgentAction, "id">) {
    this.emit({ type: "action", action: { ...action, id: ++this.actionId } });
    this.patch({ busy: true, activity: action.label });
    this.kick(action.leadMs + 250, action.leadMs + 900);
  }

  private done() {
    this.patch({ busy: false, activity: "" });
    this.kick();
  }

  private async locate(page: Page, ref: string | undefined): Promise<Locator | null> {
    if (!ref || !/^(f\d+)?e\d+$/.test(ref)) return null;
    const locator = page.getByRef(ref);
    try {
      return (await locator.count()) > 0 ? locator.first() : null;
    } catch {
      return null;
    }
  }

  private async describe(locator: Locator): Promise<Target | null> {
    try {
      return await locator.evaluate(describeInPage, undefined, { timeout: 3000 });
    } catch {
      return null;
    }
  }

  private async boxOf(locator: Locator): Promise<Box | undefined> {
    try {
      const box = await locator.boundingBox({ timeout: 2000 });
      if (!box) return undefined;
      return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
    } catch {
      return undefined;
    }
  }

  private async looksLikePayment(page: Page): Promise<boolean> {
    try {
      if (isPaymentHost(page.url())) return true;
      if (page.frames().some((f) => f !== page.mainFrame() && isPaymentFrame(f.url()) && /card|elements-inner|securedfields|hosted/i.test(f.url()))) return true;
      return await page.evaluate(() => {
        const cards = 'input[autocomplete^="cc-"], input[name*="cardnumber" i], input[name*="card_number" i], input[name*="card-number" i], input[id*="cardnumber" i], input[id*="card-number" i]';
        return Array.from(document.querySelectorAll(cards)).some((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 2 && r.height > 2;
        });
      });
    } catch {
      return false;
    }
  }

  private async humanCheck(page: Page): Promise<boolean> {
    try {
      if (/just a moment|attention required|verify (that )?you are (a )?human|are you (a )?(human|robot)|pardon our interruption|security check/i.test(await page.title())) return true;
      const results = await Promise.all(page.frames().map((frame) => frame.evaluate(humanCheckInPage).catch(() => false)));
      return results.some(Boolean);
    } catch {
      return false;
    }
  }

  /** The page as the model reads it. */
  private async pageText(page: Page, options: { scope: "view" | "page"; find?: string } = { scope: "view" }): Promise<string> {
    try {
      const tree = (await page.ariaSnapshotJSON({ mode: "ai", boxes: true, timeout: 8000 })) as unknown as AriaNode[];
      const facts = await page.evaluate(() => ({
        scrollY: window.scrollY,
        pageHeight: Math.max(document.documentElement?.scrollHeight ?? 0, document.body?.scrollHeight ?? 0),
      }));
      const boxes = (
        await Promise.all(
          page.frames().map((frame) =>
            frame.evaluate(sensitiveBoxesInPage).catch(() => [] as Box[]),
          ),
        )
      ).flat();
      const sensitive = new Set<string>();
      const near = (a: Box, b: Box) => Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 3 && Math.abs(a.width - b.width) < 3 && Math.abs(a.height - b.height) < 3;
      const mark = (nodes: Array<AriaNode | string>) => {
        for (const node of nodes) {
          if (typeof node === "string") continue;
          if (node.ref && node.box && boxes.some((b) => near(b, node.box!))) sensitive.add(node.ref);
          if (node.children) mark(node.children);
        }
      };
      mark(tree);
      let text = renderPage(tree, { url: page.url(), title: await page.title(), viewport: { ...VIEWPORT }, ...facts }, { ...options, sensitive });
      if (this.dialogs.length) {
        text += `\n\n${this.dialogs.join("\n")}\nIf a question that was answered Cancel needs a yes, that is a commitment: tell the user what the page asked.`;
        this.dialogs = [];
      }
      if (this.pages.length > 1) {
        const others = this.pages.filter((p) => p !== page).map((p) => clip(this.titles.get(p) || hostOf(p.url()) || "a page", 50));
        text += `\n\nOther tabs are open behind this one: ${others.join("; ")}. You are working in the newest. When it closes, you are back in the previous one.`;
      }
      if (await this.humanCheck(page)) {
        text += `\n\nThis page has a "verify you are human" check that has not been passed. You cannot see it or pass it, and buttons may stay disabled until it is. Do not try to get around it: call requestUserAction with kind "captcha" so the user does it in the live browser.`;
      }
      if (isIdentityHost(page.url())) {
        text += `\n\nThis is a sign-in page. Signing in is the user's, start to finish: do not click or type here. Call requestUserAction with kind "login".`;
        if (this.kind === "assisted" && refusesAssistedSignIn(page.url()) && ownStatus() !== "unavailable") {
          text += ` This site does not accept sign-ins typed into this browser. In your reason, tell the user to press "Use my own Chrome" in the live browser: the task then carries on in their own Chrome, where they are already signed in.`;
        }
      }
      if (this.state.paymentPage) {
        text += `\n\nThis page takes payment. You never pay and never enter payment details: hand it to the user with requestUserAction (kind "payment").`;
      }
      return text;
    } catch (err) {
      return `Page: ${await page.title().catch(() => "")}\nURL: ${page.url()}\n\n(The page could not be read: ${err instanceof Error ? clip(err.message, 120) : "unknown error"}. Wait a moment and read it again.)`;
    }
  }

  /** Give the page a moment to react to what was just done. */
  private async settle(page: Page, quietMs = 900) {
    const now = this.page ?? page;
    try {
      await now.waitForLoadState("domcontentloaded", { timeout: 8000 });
    } catch {
      /* slow page: read what there is */
    }
    try {
      await now.waitForLoadState("networkidle", { timeout: quietMs });
    } catch {
      /* still busy, which is normal for many sites */
    }
    await delay(200);
    if (this.page) await this.refresh(this.page);
  }

  private step(label: string, action: BrowserStepData["action"], page: Page | undefined, extra: Partial<BrowserStepData> & { page: string }): BrowserStepData {
    return { kind: "browser", label, action, url: page?.url() ?? "", title: this.state.title, ok: true, sources: [], ...extra };
  }

  /** The agent closes the browser: the task there is finished, or the user asked. Sign-ins are kept. */
  shut(signal?: AbortSignal): Promise<BrowserStepData> {
    return this.queue(async () => {
      const waiting = await this.waitForAgentTurn(signal);
      if (waiting) return this.step("Waiting for you", "close", this.page, { ok: false, problem: waiting, page: waiting });
      const wasOpen = this.running;
      await this.close();
      const page = wasOpen ? "The live browser is closed. Sign-ins are kept. Open a page again with browserOpen when a task needs it." : "The live browser was not open.";
      return { kind: "browser", label: wasOpen ? "Closed the browser" : "The browser was already closed", action: "close", url: "", title: "", ok: true, page, sources: [] };
    });
  }

  /** Open an address in the live browser. `fresh` closes the tabs a previous task left behind. */
  open(rawUrl: string, signal?: AbortSignal, fresh = false): Promise<BrowserStepData> {
    return this.queue(async () => {
      const waiting = await this.waitForAgentTurn(signal);
      if (waiting) return this.step("Waiting for you", "open", this.page, { ok: false, problem: waiting, page: waiting });
      const url = toAddress(rawUrl);
      if (!/^https?:\/\//i.test(url)) {
        return this.step("Could not open that address", "open", this.page, { ok: false, problem: "Only http and https addresses can be opened.", page: "Only http and https addresses can be opened." });
      }
      let page: Page;
      try {
        page = await this.ensureStarted();
      } catch (err) {
        const problem = err instanceof Error ? err.message : "The browser could not be started.";
        return this.step("The browser did not start", "open", undefined, { ok: false, problem, page: `${problem} Carry on without the live browser: give the user links instead.` });
      }
      if (fresh) {
        for (const other of [...this.pages]) if (other !== page) await other.close().catch(() => {});
      }
      const site = hostOf(url);
      this.announce({ kind: "navigate", label: `Opening ${site}`, leadMs: 0 });
      this.patch({ loading: true });
      let problem: string | undefined;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } catch (err) {
        problem = `${site} did not load (${err instanceof Error ? clip(err.message.split("\n")[0], 100) : "unknown error"}).`;
      }
      await this.settle(page, 2000);
      this.patch({ loading: false });
      const text = await this.pageText(this.page ?? page);
      this.done();
      return this.step(problem ? `Could not open ${site}` : `Opened ${site}`, "open", this.page ?? page, { ok: !problem, problem, page: problem ? `${problem}\n\n${text}` : text });
    });
  }

  /** Read the page again, in view or as a whole, optionally looking for a phrase. */
  read(options: { scope: "view" | "page"; find?: string }, signal?: AbortSignal): Promise<BrowserStepData> {
    return this.queue(async () => {
      const waiting = await this.waitForAgentTurn(signal);
      if (waiting) return this.step("Waiting for you", "read", this.page, { ok: false, problem: waiting, page: waiting });
      const page = this.page;
      if (!page) return this.step("No page is open", "read", undefined, { ok: false, problem: "No page is open.", page: "No page is open in the live browser. Open one with browserOpen." });
      this.announce({ kind: "read", label: options.find ? `Looking for "${clip(options.find, 40)}"` : "Reading the page", leadMs: 0 });
      await this.refresh(page);
      const text = await this.pageText(page, options);
      await delay(350);
      this.done();
      return this.step(options.find ? `Looked for "${clip(options.find, 40)}"` : "Read the page", "read", page, { page: text });
    });
  }

  /**
   * A picture of the page for the model, for what the text cannot show: a page drawn as an image
   * or a canvas, or a control that does nothing for no visible reason. Never of a payment or
   * sign-in page, and fields that hold secrets are painted over.
   */
  look(toolCallId: string, signal?: AbortSignal): Promise<BrowserStepData> {
    return this.queue(async () => {
      const waiting = await this.waitForAgentTurn(signal);
      if (waiting) return this.step("Waiting for you", "read", this.page, { ok: false, problem: waiting, page: waiting });
      const page = this.page;
      if (!page) return this.step("No page is open", "read", undefined, { ok: false, problem: "No page is open.", page: "No page is open in the live browser. Open one with browserOpen." });
      await this.refresh(page);
      if (this.state.paymentPage || isPaymentHost(page.url()) || isIdentityHost(page.url())) {
        const problem = "No picture is taken of a payment or sign-in page. Hand it to the user with requestUserAction.";
        this.announce({ kind: "blocked", label: "Stopped by a safety rule", leadMs: 0 });
        this.done();
        return this.step("Stopped by a safety rule", "read", page, { ok: false, blocked: true, problem, page: `NOT DONE. ${problem}` });
      }
      this.announce({ kind: "read", label: "Looking at the page", leadMs: 0 });
      let text = await this.pageText(page);
      try {
        const secrets =
          'input[type="password"], input[autocomplete^="cc-"], input[autocomplete="one-time-code"], input[autocomplete*="password"], input[name*="card" i], input[name*="cvv" i], input[name*="cvc" i], input[name*="iban" i], iframe[src*="stripe"], iframe[src*="adyen"], iframe[src*="braintree"], iframe[src*="checkout.com"], iframe[title*="card" i], iframe[title*="payment" i]';
        const shot = await page.screenshot({ type: "jpeg", quality: 60, mask: [page.locator(secrets)], maskColor: "#1c211d", caret: "hide", scale: "css", timeout: 8000 });
        this.pictures.set(toolCallId, shot.toString("base64"));
        while (this.pictures.size > 3) this.pictures.delete(this.pictures.keys().next().value as string);
        text = `A picture of the page as it looks now is attached. Fields that hold secrets are painted over. You still act through the references below.\n\n${text}`;
      } catch {
        text = `The picture could not be taken. The page as text:\n\n${text}`;
      }
      this.done();
      return this.step("Looked at the page", "read", page, { page: text });
    });
  }

  /** The picture taken for a tool call, while it is still kept. */
  picture(toolCallId: string): string | undefined {
    return this.pictures.get(toolCallId);
  }

  /** What the safety rules say about a step, before it is taken. Cached per tool call. */
  async review(toolCallId: string, input: ActInput): Promise<Verdict> {
    const cached = this.approvals.get(toolCallId);
    if (cached) return cached;
    const verdict = await this.verdictFor(input);
    this.approvals.set(toolCallId, verdict);
    if (this.approvals.size > 200) this.approvals.delete(this.approvals.keys().next().value as string);
    if (verdict.decision === "approve") {
      const page = this.page;
      const locator = page ? await this.locate(page, input.ref) : null;
      const target = locator ? await this.describe(locator) : null;
      const label = target?.name ? `Waiting for your approval: "${clip(target.name, 50)}"` : "Waiting for your approval";
      const box = locator ? await this.boxOf(locator) : undefined;
      this.emit({ type: "action", action: { id: ++this.actionId, kind: "approval", label, box, point: box ? centre(box) : undefined, leadMs: 300 } });
      this.patch({ approval: { label }, busy: false, activity: "" });
    }
    return verdict;
  }

  private async verdictFor(input: ActInput): Promise<Verdict> {
    const page = this.page;
    if (!page) return { decision: "allow" };
    const stepKind = input.action;
    if (stepKind !== "click" && stepKind !== "type" && stepKind !== "select" && stepKind !== "press" && stepKind !== "hover") {
      return (isPaymentHost(page.url()) || isIdentityHost(page.url())) && stepKind !== "back" && stepKind !== "wait" && stepKind !== "scroll"
        ? judge({ action: "click" }, null, page.url())
        : { decision: "allow" };
    }
    const locator = await this.locate(page, input.ref);
    const target = locator ? await this.describe(locator) : null;
    const step: Step = {
      action: stepKind,
      commits: input.commits,
      enter: (stepKind === "type" && input.submit === true) || (stepKind === "press" && /^(Enter|Return)$/i.test(input.text ?? "")),
    };
    return judge(step, target, page.url());
  }

  /** Take one step on the page. */
  act(toolCallId: string, input: ActInput, signal?: AbortSignal): Promise<BrowserStepData> {
    const kind: BrowserStepData["action"] = input.action === "back" ? "navigate" : input.action;
    return this.queue(async () => {
      const waiting = await this.waitForAgentTurn(signal);
      if (waiting) return this.step("Waiting for you", kind, this.page, { ok: false, problem: waiting, page: waiting });
      const page = this.page;
      if (!page) return this.step("No page is open", kind, undefined, { ok: false, problem: "No page is open.", page: "No page is open in the live browser. Open one with browserOpen." });
      this.patch({ approval: undefined });
      this.lastUsed = Date.now();

      const fail = async (label: string, problem: string, blocked = false) => {
        if (blocked) this.announce({ kind: "blocked", label, leadMs: 0 });
        const text = await this.pageText(this.page ?? page);
        this.done();
        return this.step(label, kind, this.page ?? page, { ok: false, blocked: blocked || undefined, problem, page: `NOT DONE. ${problem}\n\n${text}` });
      };

      try {
        // Steps that need no element.
        if (input.action === "back") {
          this.announce({ kind: "navigate", label: "Going back", leadMs: 0 });
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
          await this.settle(page);
          const text = await this.pageText(this.page ?? page);
          this.done();
          return this.step("Went back", "navigate", this.page ?? page, { page: text });
        }
        if (input.action === "wait") {
          const seconds = Math.min(Math.max(input.seconds ?? 2, 1), 10);
          this.announce({ kind: "wait", label: "Waiting for the page", leadMs: 0 });
          await delay(seconds * 1000);
          await this.settle(page, 500);
          const text = await this.pageText(this.page ?? page);
          this.done();
          return this.step(`Waited ${seconds} s`, "wait", this.page ?? page, { page: text });
        }

        const locator = await this.locate(page, input.ref);
        if (input.action === "scroll") {
          const direction = input.direction === "up" ? "up" : "down";
          const box = locator ? await this.boxOf(locator) : undefined;
          const point = box ? centre(box) : { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
          this.announce({ kind: "scroll", label: direction === "down" ? "Scrolling down" : "Scrolling up", direction, point, leadMs: 150 });
          await delay(150);
          await page.mouse.move(point.x, point.y);
          await page.mouse.wheel(0, (direction === "down" ? 1 : -1) * Math.round(VIEWPORT.height * 0.8));
          await delay(450);
          await this.settle(page, 600);
          const text = await this.pageText(page);
          this.done();
          return this.step(direction === "down" ? "Scrolled down" : "Scrolled up", "scroll", page, { page: text });
        }
        if (input.action === "press" && !input.ref) {
          const key = normaliseKey(input.text);
          if (!key) return await fail("Could not press that key", "Name a key such as Enter, Escape, Tab, ArrowDown or PageDown.");
          const verdict = this.approvals.get(toolCallId) ?? (await this.verdictFor(input));
          if (verdict.decision === "block") return await fail("Stopped by a safety rule", verdict.reason, true);
          this.announce({ kind: "press", label: `Pressing ${key}`, text: key, leadMs: 150 });
          await delay(150);
          await page.keyboard.press(key);
          await this.settle(page);
          const text = await this.pageText(this.page ?? page);
          this.done();
          return this.step(`Pressed ${key}`, "press", this.page ?? page, { page: text });
        }

        if (!locator) {
          return await fail("Could not find that element", `There is no element ${input.ref ?? "(no ref given)"} on the page as it is now. References change whenever the page changes: use one from the page below.`);
        }
        await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        const target = await this.describe(locator);

        // The safety rules, in code. A blocked step is never taken, whatever the model says.
        const verdict = this.approvals.get(toolCallId) ?? (await this.verdictFor(input));
        if (verdict.decision === "block") return await fail("Stopped by a safety rule", verdict.reason, true);
        if (target && (input.action === "type" || input.action === "select") && isSensitiveField(target)) {
          return await fail("Stopped by a safety rule", "That field takes a password, a code or payment details. The user enters those themselves: call requestUserAction.", true);
        }

        const box = await this.boxOf(locator);
        const point = box ? centre(box) : undefined;
        const name = target?.name ? clip(target.name, 48) : "";
        const named = name ? ` "${name}"` : "";

        switch (input.action) {
          case "click": {
            this.announce({ kind: "click", label: `Clicking${named || " the element"}`, box, point, leadMs: 320 });
            await delay(320);
            if (point) await page.mouse.move(point.x, point.y, { steps: 4 }).catch(() => {});
            await locator.click({ timeout: 6000 });
            await this.settle(page);
            const text = await this.pageText(this.page ?? page);
            this.done();
            return this.step(`Clicked${named || " an element"}`, "click", this.page ?? page, { page: text });
          }
          case "hover": {
            this.announce({ kind: "hover", label: `Pointing at${named || " the element"}`, box, point, leadMs: 300 });
            await delay(300);
            await locator.hover({ timeout: 6000 });
            await delay(400);
            const text = await this.pageText(page);
            this.done();
            return this.step(`Pointed at${named || " an element"}`, "hover", page, { page: text });
          }
          case "type": {
            const value = input.text ?? "";
            this.announce({ kind: "type", label: `Typing into${named || " the field"}`, box, point, text: clip(value, 120), leadMs: 350 });
            await delay(350);
            const direct = /^(date|time|datetime-local|month|week|number|range|color)$/.test(target?.type ?? "") || value.length > 80;
            try {
              if (direct) await locator.fill(value, { timeout: 5000 });
              else {
                await locator.fill("", { timeout: 4000 });
                await locator.pressSequentially(value, { delay: value.length > 30 ? 12 : 30, timeout: 15_000 });
              }
            } catch {
              await locator.fill(value, { timeout: 4000 });
            }
            if (input.submit) {
              await delay(150);
              await locator.press("Enter", { timeout: 5000 });
            }
            await this.settle(page, input.submit ? 1500 : 700);
            const text = await this.pageText(this.page ?? page);
            this.done();
            return this.step(`Typed "${clip(value, 40)}"${name ? ` into ${name}` : ""}`, "type", this.page ?? page, { page: text });
          }
          case "select": {
            const value = input.text ?? "";
            this.announce({ kind: "select", label: `Choosing "${clip(value, 40)}"${name ? ` in ${name}` : ""}`, box, point, text: clip(value, 80), leadMs: 350 });
            await delay(350);
            try {
              await locator.selectOption({ label: value }, { timeout: 5000 });
            } catch {
              try {
                await locator.selectOption(value, { timeout: 3000 });
              } catch {
                return await fail("Could not choose that option", `"${clip(value, 40)}" is not an option of this list, or this is not a simple list. If it opens a custom menu, click it and then click the option.`);
              }
            }
            await this.settle(page, 700);
            const text = await this.pageText(this.page ?? page);
            this.done();
            return this.step(`Chose "${clip(value, 40)}"${name ? ` in ${name}` : ""}`, "select", this.page ?? page, { page: text });
          }
          case "press": {
            const key = normaliseKey(input.text);
            if (!key) return await fail("Could not press that key", "Name a key such as Enter, Escape, Tab, ArrowDown or PageDown.");
            this.announce({ kind: "press", label: `Pressing ${key}`, box, point, text: key, leadMs: 200 });
            await delay(200);
            await locator.press(key, { timeout: 5000 });
            await this.settle(page);
            const text = await this.pageText(this.page ?? page);
            this.done();
            return this.step(`Pressed ${key}`, "press", this.page ?? page, { page: text });
          }
        }
        return await fail("Could not do that", "Unknown action.");
      } catch (err) {
        const message = err instanceof Error ? err.message.split("\n")[0] : "unknown error";
        const reason = /Timeout|timeout/.test(message)
          ? "The element did not respond in time. It may be covered by a dialog, disabled, or gone."
          : /intercepts pointer events/.test(message)
            ? "Something else is on top of that element (a dialog or banner). Deal with that first."
            : clip(message, 160);
        return await fail("That step did not work", reason);
      }
    });
  }
}

const centre = (box: Box) => ({ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });

const KEYS: Record<string, string> = {
  enter: "Enter", return: "Enter", escape: "Escape", esc: "Escape", tab: "Tab", space: "Space", backspace: "Backspace", delete: "Delete",
  arrowdown: "ArrowDown", arrowup: "ArrowUp", arrowleft: "ArrowLeft", arrowright: "ArrowRight", down: "ArrowDown", up: "ArrowUp", left: "ArrowLeft", right: "ArrowRight",
  pagedown: "PageDown", pageup: "PageUp", home: "Home", end: "End",
};
function normaliseKey(key: string | undefined): string | null {
  return KEYS[(key ?? "").replace(/[\s_-]/g, "").toLowerCase()] ?? null;
}

/** "example.com/x" and "https://example.com/x" both work; a few words become a web search. */
function toAddress(input: string): string {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}

/* ───────────────────────── All browsers on this server ───────────────────────── */

type Registry = {
  sessions: Map<string, BrowserSession>;
  sweeper?: ReturnType<typeof setInterval>;
  userAgent?: Promise<string | undefined>;
  /** The connection to the user's own Chrome, shared by every session on this server. */
  own?: Promise<OwnChrome>;
  /** Development only: use this folder as "the user's Chrome", so tests never touch the real one. */
  chromeFolder?: string;
};

// On globalThis so the chat route and the browser routes share one set of browsers, and so a
// code reload in development does not orphan a running Chrome.
const store = globalThis as unknown as { __hoviBrowsers?: Registry };
const registry: Registry = (store.__hoviBrowsers ??= { sessions: new Map() });

/** Development only: point "the user's own Chrome" at a stand-in, or back at the real one. */
export function devUseChromeFolder(folder: string | undefined) {
  registry.chromeFolder = folder || undefined;
  if (registry.own) void registry.own.then((own) => own.browser.close()).catch(() => {});
  registry.own = undefined;
}

export const validBrowserId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);

/**
 * Sessions outlive the code that made them: they sit on globalThis so that a code reload in
 * development does not orphan a running Chrome. After a reload, such a session is an object of
 * the previous version of this class, without the methods and fields added since, and calling a
 * new method on it fails. Bring it up to date in place: the live browser, its page and the
 * people watching it stay exactly as they are. In production nothing reloads and this does nothing.
 */
function current(session: BrowserSession): BrowserSession {
  if (Object.getPrototypeOf(session) === BrowserSession.prototype) return session;
  Object.setPrototypeOf(session, BrowserSession.prototype);
  const fresh = new BrowserSession(session.id) as unknown as Record<string, unknown>;
  const target = session as unknown as Record<string, unknown>;
  for (const key of Object.keys(fresh)) if (!(key in target)) target[key] = fresh[key];
  return session;
}

function everySession(): BrowserSession[] {
  return [...registry.sessions.values()].map(current);
}

/** The browser for this visitor. Creating the object does not start Chrome. */
export function browserFor(id: string): BrowserSession {
  let session = registry.sessions.get(id);
  if (session) session = current(session);
  else {
    session = new BrowserSession(id);
    registry.sessions.set(id, session);
  }
  registry.sweeper ??= sweep();
  return session;
}

function sweep() {
  const timer = setInterval(() => {
    for (const session of everySession()) {
      const id = session.id;
      const idle = Date.now() - session.lastUsed > IDLE_CLOSE_MS;
      if (idle && session.watchers === 0) {
        if (session.running) void session.close();
        registry.sessions.delete(id);
      }
    }
  }, 60_000);
  timer.unref?.();
  return timer;
}

/** A machine can only run so many Chromes: close the one left alone the longest. */
async function makeRoom(starting: BrowserSession) {
  const running = everySession().filter((s) => s !== starting && s.running);
  if (running.length < MAX_BROWSERS) return;
  const oldest = running.sort((a, b) => a.lastUsed - b.lastUsed)[0];
  await oldest.close();
}

/**
 * Headless Chrome announces itself as "HeadlessChrome", and many sites answer that with an empty
 * page. The browser is the same Chrome either way, so it sends the address a visible window would.
 * Nothing else is disguised: the page can still see that the browser is automated.
 */
function plainUserAgent(): Promise<string | undefined> {
  registry.userAgent ??= (async () => {
    try {
      const probe = await chromium.launch({ channel: "chrome", headless: true });
      const page = await probe.newPage();
      const agent = await page.evaluate(() => navigator.userAgent);
      await probe.close();
      return agent.replace("HeadlessChrome", "Chrome");
    } catch {
      return undefined;
    }
  })();
  return registry.userAgent;
}
