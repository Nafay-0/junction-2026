import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from "playwright-core";
import { isIdentityHost, isPaymentFrame, isPaymentHost, isSensitiveField, judge, type Step, type Target, type Verdict } from "./guard";
import { IDLE_STATE, VIEWPORT, type AgentAction, type Box, type BrowserEvent, type BrowserState, type BrowserStepData, type ControlRequest, type Handover } from "./protocol";
import { renderPage, type AriaNode } from "./snapshot";

/*
 * The live browser: a real browser view inside the desktop app's own window, on the user's
 * computer. This file runs in the desktop app (its main process), never on the server: the
 * server only runs the agent, and the agent's browser steps are carried out here.
 *
 * - The agent's steps go through `open`, `act`, `read` and `look`. Each one is announced to the
 *   interface before it happens, checked against the safety rules in `guard.ts`, and answered with
 *   the page as it then stands. A step that commits the user waits here for their yes.
 * - The interface gets state and the agent's steps through `subscribe`. The page itself is on
 *   screen in the app, so the user clicks and types straight into it when it is their turn.
 * - Sign-ins live in the app's own storage on this computer, per account.
 *
 * What the user types while in control goes to the page and nowhere else: it is not logged, not
 * stored, and the agent does not read the page during that time.
 */

/** How long the agent waits for the user to hand the page back before giving up on a step. */
const WAIT_FOR_USER_MS = 90_000;
/** How long the interface has to put the browser view on screen once a browser is asked for. */
const VIEW_WAIT_MS = 20_000;

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
  /** With commits: what will happen, in the model's words, for the user to check. */
  summary?: string;
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

/** Where a "verify you are human" check that has not been passed is: the whole page, on screen, or elsewhere on the page. */
type HumanCheck = "" | "wall" | "view" | "elsewhere";

/**
 * Runs inside the page: is there a "verify you are human" check that has not been passed, and
 * where? These widgets sit in frames the agent cannot read, so without this the agent only sees a
 * button that stays disabled and has no idea why. Where it is matters as much as whether: many
 * sites carry one in a newsletter form at the foot of every page, which blocks nothing else.
 */
function humanCheckInPage(): "" | "wall" | "view" | "elsewhere" {
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 30 && r.height > 20;
  };
  const onScreen = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
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
  const waiting = answers.filter((a) => !a.value && a.parentElement !== null && shown(a.parentElement)).map((a) => a.parentElement as Element);
  const spots: Element[] = answers.length === 0 ? [...widgets, ...frames] : answers.every((a) => a.value) ? [] : [...waiting, ...(waiting.length ? [] : [...widgets, ...frames])];
  if (spots.length === 0) return "";
  // A page that is nothing but the check (an interstitial in front of the site): hardly any words, and nothing else to press.
  const others = Array.from(document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea")).filter((el) => shown(el) && !spots.some((spot) => spot.contains(el)));
  if ((document.body?.innerText ?? "").trim().length < 500 && others.length < 3) return "wall";
  return spots.some(onScreen) ? "view" : "elsewhere";
}

type Listener = (event: BrowserEvent) => void;

export class BrowserSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private pages: Page[] = [];
  private pageIds = new WeakMap<Page, string>();
  private cdp = new WeakMap<Page, CDPSession>();
  private starting?: Promise<void>;
  private listeners = new Set<Listener>();
  private state: BrowserState = { ...IDLE_STATE };
  /** Where the app says its browser view can be reached, and who is waiting to hear it. */
  private viewEndpoint?: string;
  private viewWaiter?: (endpoint: string) => void;
  /** Message boxes the page showed since the model last read it. */
  private dialogs: string[] = [];
  private actionId = 0;
  private tabSeq = 0;
  /** Agent steps run one at a time, in the order they were asked for. */
  private chain: Promise<unknown> = Promise.resolve();
  private statePending = false;
  /** What the safety rules said about a step, by tool call, so a step is judged once. */
  private approvals = new Map<string, Verdict>();
  /** Steps waiting for the user's yes or no, by tool call. */
  private decisions = new Map<string, (approved: boolean) => void>();

  /* ───────────────────────── Watching ───────────────────────── */

  snapshotState(): BrowserState {
    return { ...this.state, tabs: this.tabs() };
  }

  /** The idle state with the optional parts spelled out, so closing a browser leaves no stale banner behind. */
  private cleared(): BrowserState {
    return { ...IDLE_STATE, handover: undefined, approval: undefined, error: undefined };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener({ type: "state", state: this.snapshotState() });
    return () => {
      this.listeners.delete(listener);
    };
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
    const control = this.state.control;
    Object.assign(this.state, change);
    if (this.state.control !== control) this.tellView();
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

  async ensureStarted(): Promise<Page> {
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
      await this.startInView();
      this.patch({ status: "ready", activity: "" });
    } catch (err) {
      this.context = undefined;
      this.page = undefined;
      const message = err instanceof Error ? err.message.split("\n")[0] : "The browser could not be started.";
      this.patch({ status: "error", error: clip(message, 260), activity: "" });
    }
  }

  /**
   * The browser is a view inside the app's own window, an ordinary embedded
   * browser that the user types into directly. Saying "starting" makes the app show that view
   * and tell us where to reach it (a bridge on this computer, see desktop/relay.cjs).
   */
  private async startInView() {
    const endpoint =
      this.viewEndpoint ??
      (await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.viewWaiter = undefined;
          reject(new Error("The app's browser view did not appear. Open the live browser and try again."));
        }, VIEW_WAIT_MS);
        this.viewWaiter = (value) => {
          clearTimeout(timer);
          this.viewWaiter = undefined;
          resolve(value);
        };
      }));
    this.viewEndpoint = undefined;
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
    const context = browser.contexts()[0];
    const page = context?.pages()[0];
    if (!context || !page) {
      await browser.close().catch(() => {});
      throw new Error("The app's browser view could not be reached.");
    }
    this.browser = browser;
    this.context = context;
    browser.on("disconnected", () => {
      if (this.browser !== browser) return;
      this.browser = undefined;
      this.onClosed();
    });
    this.adopt(page, true);
    this.tellView();
    await this.measure(page);
  }

  /**
   * Tell the desktop app's bridge who is driving. While it is the agent, the bridge keeps the
   * user's keyboard out of the page; once the user takes over, everything they do goes straight in.
   */
  private tellView() {
    const page = this.page;
    if (!page || page.isClosed()) return;
    const control = this.state.control;
    void this.cdpFor(page)
      .then((session) => (session as unknown as { send(method: string, params: object): Promise<unknown> }).send("Beryl.setControl", { control }))
      .catch(() => {});
  }

  /** The app's browser view is up: where to reach it. Only an address on this computer is accepted. */
  offerView(endpoint: string) {
    if (!/^ws:\/\/127\.0\.0\.1:\d{2,5}\/[0-9a-f]{36}$/.test(endpoint)) return;
    if (this.viewWaiter) this.viewWaiter(endpoint);
    else this.viewEndpoint = endpoint;
  }

  private async cdpFor(page: Page): Promise<CDPSession> {
    let session = this.cdp.get(page);
    if (!session) {
      session = await page.context().newCDPSession(page);
      this.cdp.set(page, session);
    }
    return session;
  }

  /** In the desktop app the page is as large as the view the user sees, not a fixed size. */
  private async measure(page: Page) {
    if (page.isClosed()) return;
    try {
      const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      if (size.width > 0 && size.height > 0 && (size.width !== this.state.viewport.width || size.height !== this.state.viewport.height)) this.patch({ viewport: size });
    } catch {
      /* navigating: the next refresh measures again */
    }
  }

  /**
   * The desktop app's view has this much room. A narrow view would give most sites their phone
   * layout, so the page is laid out at desktop width and drawn smaller, as a zoomed-out browser does.
   */
  private async fit(width: number, height: number) {
    const page = this.page;
    if (!page || page.isClosed()) return;
    const scale = Math.min(1, Math.max(0.3, width / VIEWPORT.width));
    try {
      const session = await this.cdpFor(page);
      if (scale < 0.995) {
        await session.send("Emulation.setDeviceMetricsOverride", { width: Math.round(width / scale), height: Math.round(height / scale), deviceScaleFactor: 0, mobile: false, scale });
      } else await session.send("Emulation.clearDeviceMetricsOverride");
    } catch {
      /* the page is navigating: the next size change tries again */
    }
    await this.measure(page);
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

  private async activate(page: Page) {
    if (this.page === page) return;
    this.page = page;
    await this.refresh(page);
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
    await this.measure(page);
    try {
      const session = await this.cdpFor(page);
      const history = (await session.send("Page.getNavigationHistory")) as { currentIndex: number; entries: unknown[] };
      canGoBack = history.currentIndex > 0;
      canGoForward = history.currentIndex < history.entries.length - 1;
    } catch {
      /* not worth failing over */
    }
    this.patch({ url: url === "about:blank" ? "" : url, title: this.titles.get(page) ?? "", canGoBack, canGoForward, paymentPage: await this.looksLikePayment(page) });
  }

  private onClosed() {
    this.viewEndpoint = undefined;
    this.context = undefined;
    this.page = undefined;
    this.pages = [];
    this.dialogs = [];
    this.approvals.clear();
    for (const answer of [...this.decisions.values()]) answer(false);
    this.patch({ ...this.cleared(), status: "closed" });
  }

  async close() {
    // Letting go is enough: the app takes its browser view away when it hears "closed".
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close().catch(() => {});
    this.onClosed();
  }

  /* ───────────────────────── The user's side ───────────────────────── */

  /** The agent has asked the user to step in. */
  requestHandover(handover: Handover) {
    this.patch({ control: "user", handover, busy: false, activity: "", approval: undefined });
  }

  async control(request: ControlRequest): Promise<BrowserState> {
    switch (request.action) {
      case "take":
        this.patch({ control: "user" });
        break;
      case "release":
        this.patch({ control: "agent", handover: undefined });
        break;
      case "approval":
        // The user's own yes or no to a step that is waiting for it.
        this.decisions.get(request.toolCallId)?.(request.approved);
        break;
      case "visit":
        // The user opened a link themselves (a source in the chat, a button): the page is theirs to look at.
        this.patch({ control: "user" });
        try {
          const page = await this.ensureStarted();
          await page.goto(toAddress(request.url), { waitUntil: "domcontentloaded", timeout: 25_000 });
        } catch {
          /* the page, or the error state, says why */
        }
        break;
      case "fit":
        await this.fit(request.width, request.height);
        break;
      case "close":
        await this.close();
        break;
      case "tab": {
        const page = this.pages.find((p) => this.pageIds.get(p) === request.tabId);
        if (page) await this.activate(page);
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
  }

  private done() {
    this.patch({ busy: false, activity: "" });
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

  private async humanCheck(page: Page): Promise<HumanCheck> {
    try {
      if (/just a moment|attention required|verify (that )?you are (a )?human|are you (a )?(human|robot)|pardon our interruption|security check|access to this page has been denied/i.test(await page.title())) return "wall";
      const main = page.mainFrame();
      const results = await Promise.all(
        page.frames().map((frame) =>
          frame
            .evaluate(humanCheckInPage)
            // Inside an embedded frame "the whole page" only means the whole frame.
            .then((found): HumanCheck => (found === "wall" && frame !== main ? "view" : found))
            .catch((): HumanCheck => ""),
        ),
      );
      return (["wall", "view", "elsewhere"] as const).find((where) => results.includes(where)) ?? "";
    } catch {
      return "";
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
      let text = renderPage(tree, { url: page.url(), title: await page.title(), viewport: { ...this.state.viewport }, ...facts }, { ...options, sensitive });
      if (this.dialogs.length) {
        text += `\n\n${this.dialogs.join("\n")}\nIf a question that was answered Cancel needs a yes, that is a commitment: tell the user what the page asked.`;
        this.dialogs = [];
      }
      if (this.pages.length > 1) {
        const others = this.pages.filter((p) => p !== page).map((p) => clip(this.titles.get(p) || hostOf(p.url()) || "a page", 50));
        text += `\n\nOther tabs are open behind this one: ${others.join("; ")}. You are working in the newest. When it closes, you are back in the previous one.`;
      }
      const check = await this.humanCheck(page);
      if (check === "wall") {
        text += `\n\nThis page is a "verify you are human" check: the site shows nothing else until it is passed. You cannot see it or pass it. Do not try to get around it: call requestUserAction with kind "captcha" so the user does it in the live browser.`;
      } else if (check === "view") {
        text += `\n\nOne form on screen has a "verify you are human" check that has not been passed. It belongs to that form and only matters if the task needs that form: its button may stay disabled, or it may not go through, until the check is passed. The rest of the page works as usual, links included. You cannot see the check or pass it. If the task needs that form, call requestUserAction with kind "captcha" when you get to it; otherwise ignore it and carry on.`;
      } else if (check === "elsewhere" && options.scope === "page") {
        text += `\n\nA form elsewhere on this page has a "verify you are human" check. It only matters if the task needs that form; nothing else on the page is held back by it.`;
      }
      if (isIdentityHost(page.url())) {
        text += `\n\nThis is a sign-in page. Signing in is the user's, start to finish: do not click or type here. Call requestUserAction with kind "login".`;
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
    // Chrome's own "this site can't be reached" page is not a site the agent worked on.
    const url = page?.url() ?? "";
    return { kind: "browser", label, action, url: url.startsWith("chrome-error:") ? "" : url, title: this.state.title, ok: true, sources: [], ...extra };
  }

  /**
   * A step that was waiting when the app was closed, asked for again now that it is open. It is
   * not taken: what it pointed at belonged to a page that is gone or has changed. The agent gets
   * the state of things and finds its own way back; a step that needs the user's yes asks again.
   */
  missed(action: BrowserStepData["action"]): Promise<BrowserStepData> {
    return this.queue(async () => {
      const why = "This step was still waiting when the app was closed or reloaded, so it was not taken.";
      const page = this.page;
      if (!page) {
        return this.step("Picking up where it stopped", action, undefined, {
          ok: false,
          problem: why,
          page:
            `${why} Nothing was approved and nothing was sent. The live browser closed with it, so the page is gone. ` +
            "Sign-ins and whatever the site itself saved (an account, a basket) are kept; what was only typed into a form is not. " +
            "Open the page again with browserOpen, look at what is already done before repeating anything, and work back to this step. " +
            "Do not ask the user whether to continue: carry on. A step that needs their approval will ask them again by itself.",
        });
      }
      const text = await this.pageText(page);
      return this.step("Picking up where it stopped", action, page, {
        ok: false,
        problem: why,
        page: `${why} Nothing was approved and nothing was sent. The page as it stands now is below: check it is the right one and what is already done, then carry on from there.\n\n${text}`,
      });
    });
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
  look(signal?: AbortSignal): Promise<BrowserStepData> {
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
      let picture: string | undefined;
      try {
        const secrets =
          'input[type="password"], input[autocomplete^="cc-"], input[autocomplete="one-time-code"], input[autocomplete*="password"], input[name*="card" i], input[name*="cvv" i], input[name*="cvc" i], input[name*="iban" i], iframe[src*="stripe"], iframe[src*="adyen"], iframe[src*="braintree"], iframe[src*="checkout.com"], iframe[title*="card" i], iframe[title*="payment" i]';
        const shot = await page.screenshot({ type: "jpeg", quality: 60, mask: [page.locator(secrets)], maskColor: "#1c211d", caret: "hide", scale: "css", timeout: 8000 });
        picture = shot.toString("base64");
        text = `A picture of the page as it looks now is attached. Fields that hold secrets are painted over. You still act through the references below.\n\n${text}`;
      } catch {
        text = `The picture could not be taken. The page as text:\n\n${text}`;
      }
      this.done();
      return this.step("Looked at the page", "read", page, { page: text, picture });
    });
  }

  /** What the safety rules say about a step, before it is taken. Cached per tool call. */
  private async review(toolCallId: string, input: ActInput): Promise<Verdict> {
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
      this.patch({ approval: { label, toolCallId, summary: input.summary?.trim() || verdict.reason || "This step acts on your behalf." }, busy: false, activity: "" });
    }
    return verdict;
  }

  /** Wait for the user's yes or no to a step. Stopping the agent, or closing the browser, counts as no. */
  private decision(toolCallId: string, signal?: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const finish = (approved: boolean) => {
        this.decisions.delete(toolCallId);
        signal?.removeEventListener("abort", stop);
        resolve(approved);
      };
      const stop = () => finish(false);
      if (signal?.aborted) {
        finish(false);
        return;
      }
      signal?.addEventListener("abort", stop);
      this.decisions.set(toolCallId, finish);
    });
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

      // A step that commits the user waits here for their yes. Whether it does is decided in code
      // from what the element is (guard.ts), not left to the model, and only the user's own click
      // in the interface answers it.
      const ruling = await this.review(toolCallId, input);
      if (ruling.decision === "approve") {
        const approved = await this.decision(toolCallId, signal);
        this.patch({ approval: undefined });
        if (!approved) {
          const text = await this.pageText(this.page ?? page);
          return this.step("You declined this step", kind, this.page ?? page, {
            ok: false,
            denied: true,
            problem: "The user declined this step.",
            page: `NOT DONE. The user declined this step. Do not try it again and do not look for another way to do the same thing: ask what they would like changed.\n\n${text}`,
          });
        }
      }

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
          const view = this.state.viewport;
          const point = box ? centre(box) : { x: view.width / 2, y: view.height / 2 };
          this.announce({ kind: "scroll", label: direction === "down" ? "Scrolling down" : "Scrolling up", direction, point, leadMs: 150 });
          await delay(150);
          await page.mouse.move(point.x, point.y);
          await page.mouse.wheel(0, (direction === "down" ? 1 : -1) * Math.round(view.height * 0.8));
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
