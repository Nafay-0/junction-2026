import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { addPasskey, askForMilkAndWaitForSignOff, enterOps, joinAsApprover, signInStage } from "./dock";

/**
 * Shared pieces for e2e/a11y (accessibility, legibility) and e2e/visual (screenshot comparison):
 * the pages that matter with the size each is used at, the axe audit, a text steadier for screenshots,
 * and in-page measurements (font sizes, tap targets, focus styles, running animations).
 */

export const PHONE = { width: 390, height: 844 };
export const LAPTOP = { width: 1440, height: 900 };
export const WALL = { width: 1920, height: 1080 };

export type Size = "phone" | "laptop" | "wall";
export const VIEWPORT: Record<Size, { width: number; height: number }> = { phone: PHONE, laptop: LAPTOP, wall: WALL };

/** Wait until the page has fonts, has hydrated, and has had a moment for its first live fetch. */
export async function settle(page: Page, ms = 800): Promise<void> {
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(ms);
}

export type Target = {
  id: string;
  path: string;
  size: Size;
  /** Navigate there (with whatever setup the page needs) and wait for it to be ready. */
  open: (page: Page) => Promise<void>;
};

/** The stage kitchens are private: sign in as kaari before any /k/kaari page. */
export async function openStage(page: Page, path: string): Promise<void> {
  if (path.startsWith("/k/kaari")) await signInStage(page, "kaari");
  await page.goto(path);
}

const go = (path: string, ready?: (page: Page) => Promise<unknown>) => async (page: Page) => {
  await openStage(page, path);
  if (ready) await ready(page);
  await settle(page);
};
const heading = (name: string | RegExp) => (page: Page) => expect(page.getByRole("heading", { name }).first()).toBeVisible();

/** A phone that has joined as an approver (passkey) and has a 1,000 L milk order waiting for its sign-off. */
export async function openApproval(page: Page): Promise<string> {
  await addPasskey(page);
  await joinAsApprover(page);
  const id = await askForMilkAndWaitForSignOff(page);
  await expect(page.getByRole("button", { name: /^Approve \d/ })).toBeEnabled();
  await settle(page);
  return id;
}

export const TARGETS: Target[] = [
  { id: "landing", path: "/", size: "phone", open: go("/", heading(/Your AI buyer orders/)) },
  { id: "landing-laptop", path: "/", size: "laptop", open: go("/", heading(/Your AI buyer orders/)) },
  { id: "landing-classic", path: "/landing/classic", size: "laptop", open: go("/landing/classic", heading(/An AI buyer for every kitchen/)) },
  { id: "wall", path: "/wall", size: "wall", open: go("/wall", heading("Scan to become the approver")) },
  { id: "join", path: "/join", size: "phone", open: go("/join", heading(/Become the purchasing manager/)) },
  {
    id: "approver",
    path: "/approver",
    size: "phone",
    open: async (page) => {
      await addPasskey(page);
      await joinAsApprover(page);
      await settle(page);
    },
  },
  { id: "approve", path: "/approve/<id>", size: "phone", open: async (page) => void (await openApproval(page)) },
  { id: "presenter", path: "/join/presenter", size: "phone", open: go("/join/presenter") },
  { id: "call", path: "/call", size: "phone", open: go("/call") },
  { id: "k", path: "/k", size: "phone", open: go("/k", heading(/Your kitchen's shop|Enter a kitchen/)) },
  { id: "kaari", path: "/k/kaari", size: "phone", open: go("/k/kaari", heading("Ravintola Kaari")) },
  { id: "order", path: "/k/kaari/order", size: "phone", open: go("/k/kaari/order", heading("Order with your agent")) },
  { id: "catalogue", path: "/k/kaari/catalogue", size: "phone", open: go("/k/kaari/catalogue") },
  { id: "product", path: "/k/kaari/catalogue/VA-1010", size: "phone", open: go("/k/kaari/catalogue/VA-1010") },
  { id: "basket", path: "/k/kaari/basket", size: "phone", open: go("/k/kaari/basket") },
  { id: "orders", path: "/k/kaari/orders", size: "phone", open: go("/k/kaari/orders", heading("Orders")) },
  { id: "agent", path: "/k/kaari/agent", size: "phone", open: go("/k/kaari/agent") },
  ...["/ops", "/ops/trace", "/ops/safeguards", "/ops/agents", "/ops/radar"].map(
    (path): Target => ({
      id: path.slice(1).replace("/", "-"),
      path,
      size: "laptop",
      open: async (page) => {
        await enterOps(page);
        await page.goto(path);
        await settle(page, 1200);
      },
    }),
  ),
];

export const target = (id: string): Target => {
  const t = TARGETS.find((x) => x.id === id);
  if (!t) throw new Error(`no target ${id}`);
  return t;
};

/**
 * Answer the thread's mistake check ("Yes, that is right") until an options card shows. Kaari's thread is shared by
 * every test on the server, so callers hold its lock (support/thread.ts stageThread); a second concern can still
 * follow the first ("you already asked ... Order again?").
 */
export async function confirmConcerns(page: Page, timeout = 20_000): Promise<void> {
  const options = page.getByRole("button", { name: /^(Order this|Send to .+ for an OK), / }).filter({ visible: true });
  const yes = page.getByRole("button", { name: "Yes, that is right" }).filter({ visible: true });
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await options.count()) return;
    if (await yes.count()) await yes.last().click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
  await expect(options.first()).toBeVisible();
}

// ---------------------------------------------------------------- axe

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export type Finding = { page: string; rule: string; impact: string; count: number; help: string; examples: { target: string; html: string; summary: string }[] };

export async function audit(page: Page, pageId: string): Promise<Finding[]> {
  const r = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return r.violations.map((v) => ({
    page: pageId,
    rule: v.id,
    impact: v.impact ?? "unknown",
    count: v.nodes.length,
    help: v.help,
    examples: v.nodes.slice(0, 3).map((n) => ({
      target: n.target.join(" "),
      html: n.html.replace(/\s+/g, " ").slice(0, 180),
      summary: (n.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 220),
    })),
  }));
}

export type Known = {
  /** Target ids (see TARGETS, plus the mid-flow states in a11y/axe.spec.ts), or "*". */
  pages: string[] | "*";
  rule: string;
  /** Every offending node's HTML must contain this, so a new offender of the same rule still fails. */
  match?: string | string[];
  /** No more offending nodes than this on one page. */
  maxCount?: number;
  reason: string;
  severity: "would lose the demo" | "would lose points" | "cosmetic";
  where: string;
};

export const knownFor = (f: Finding, known: Known[]) =>
  known.find(
    (k) =>
      k.rule === f.rule &&
      (k.pages === "*" || k.pages.includes(f.page)) &&
      (k.maxCount === undefined || f.count <= k.maxCount) &&
      (!k.match || f.examples.every((e) => [k.match!].flat().some((m) => e.html.includes(m)))),
  );

export const isBlocking = (f: Finding) => f.impact === "serious" || f.impact === "critical";

export function splitKnown(findings: Finding[], known: Known[]) {
  const allowed = findings.filter((f) => knownFor(f, known));
  const fresh = findings.filter((f) => isBlocking(f) && !allowed.includes(f));
  return { allowed, fresh };
}

export function note(info: TestInfo, type: string, description: string) {
  info.annotations.push({ type, description });
}

/** Wait until no finite CSS animation is still running (an entrance animation mid-fade fails contrast falsely). */
export async function animationsDone(page: Page, timeout = 5000): Promise<void> {
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity), undefined, { timeout })
    .catch(() => undefined);
}

// ---------------------------------------------------------------- accessible names (Chromium accessibility tree)

const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "tab", "menuitem", "switch", "slider", "spinbutton", "listbox"]);

/** Interactive controls with an empty accessible name, from Chromium's own accessibility tree. */
export async function unnamedControls(page: Page): Promise<{ role: string; html: string }[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("Accessibility.enable");
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: { ignored: boolean; role?: { value: string }; name?: { value: string }; backendDOMNodeId?: number }[] };
  const out: { role: string; html: string }[] = [];
  for (const n of nodes) {
    const role = n.role?.value ?? "";
    if (n.ignored || !INTERACTIVE.has(role) || (n.name?.value ?? "").trim()) continue;
    let html = "";
    if (n.backendDOMNodeId) {
      try {
        const { outerHTML } = (await cdp.send("DOM.getOuterHTML", { backendNodeId: n.backendDOMNodeId })) as { outerHTML: string };
        html = outerHTML.replace(/\s+/g, " ").slice(0, 160);
      } catch {
        // node went away
      }
    }
    out.push({ role, html });
  }
  await cdp.detach();
  return out;
}

// ---------------------------------------------------------------- tab order and focus visibility

export type Stop = { i: number; tag: string; name: string; top: number; left: number; width: number; height: number; fixed: boolean; indicator: string };

/**
 * Press Tab until focus leaves the page or `max` stops, recording each stop: where it is on the page, whether it sits
 * in a fixed/sticky layer, and what changes visibly when it has focus (outline, ring, border, background, underline).
 */
export async function tabThrough(page: Page, max = 80, stopWhen?: RegExp): Promise<Stop[]> {
  // From the top of the page. A page that focuses a field on load (the Order page's composer) keeps Chromium's
  // sequential-focus starting point there even after blur(); focusing the body itself moves it to the top.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const b = document.body;
    const had = b.getAttribute("tabindex");
    b.setAttribute("tabindex", "-1");
    b.focus();
    if (had === null) b.removeAttribute("tabindex");
    else b.setAttribute("tabindex", had);
  });
  const stops: Stop[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate((i) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const name = (el.getAttribute("aria-label") || el.innerText || (el as HTMLInputElement).placeholder || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const r = el.getBoundingClientRect();
      let fixed = false;
      for (let p: HTMLElement | null = el; p; p = p.parentElement) {
        const pos = getComputedStyle(p).position;
        if (pos === "fixed" || pos === "sticky") fixed = true;
      }
      const pick = (c: CSSStyleDeclaration) => ({
        outline: c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0 ? `${c.outlineWidth} ${c.outlineStyle}` : "",
        shadow: c.boxShadow === "none" ? "" : c.boxShadow,
        border: c.borderColor + c.borderWidth,
        bg: c.backgroundColor,
        color: c.color,
        deco: c.textDecorationLine,
      });
      const on = pick(getComputedStyle(el));
      el.blur();
      const off = pick(getComputedStyle(el));
      el.focus();
      const indicator = on.outline
        ? `outline ${on.outline}`
        : on.shadow && on.shadow !== off.shadow
          ? "ring (box-shadow)"
          : on.border !== off.border
            ? "border change"
            : on.bg !== off.bg
              ? "background change"
              : on.deco !== off.deco || on.color !== off.color
                ? "text style change"
                : "";
      const key = `${el.tagName}|${name}|${Math.round(r.top + scrollY)}|${Math.round(r.left)}`;
      return { i, tag: el.tagName.toLowerCase(), name, top: Math.round(r.top + scrollY), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height), fixed, indicator, key };
    }, i);
    if (!s) {
      if (stops.length === 0 && i < 2) continue; // the first Tab can land on the document itself after a client-side navigation
      break;
    }
    if (seen.has(s.key)) break; // wrapped around
    seen.add(s.key);
    const stop: Stop = { i: s.i, tag: s.tag, name: s.name, top: s.top, left: s.left, width: s.width, height: s.height, fixed: s.fixed, indicator: s.indicator };
    stops.push(stop);
    if (stopWhen && stopWhen.test(stop.name)) break;
  }
  return stops;
}

/** Stops where Tab moves focus clearly up the page (more than `slack` px) outside fixed/sticky layers. */
export function upwardJumps(stops: Stop[], slack = 24): { from: Stop; to: Stop }[] {
  const flow = stops.filter((s) => !s.fixed && s.width > 0 && s.height > 0);
  const out: { from: Stop; to: Stop }[] = [];
  for (let k = 1; k < flow.length; k++) if (flow[k].top < flow[k - 1].top - slack) out.push({ from: flow[k - 1], to: flow[k] });
  return out;
}

// ---------------------------------------------------------------- legibility

export type TextSample = { text: string; px: number; weight: number };
export type TapSample = { name: string; tag: string; w: number; h: number; inline: boolean };

/** Visible text runs with their rendered font size, smallest first. */
export async function textSizes(page: Page): Promise<TextSample[]> {
  return page.evaluate(() => {
    const out: { text: string; px: number; weight: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
      const el = n.parentElement;
      if (!text || !el || seen.has(el)) continue;
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (c.visibility === "hidden" || c.display === "none" || r.width === 0 || r.height === 0 || parseFloat(c.opacity) === 0) continue;
      if (el.closest("[aria-hidden=true], .sr-only, script, style, noscript, svg")) continue;
      seen.add(el);
      out.push({ text: text.slice(0, 70), px: Math.round(parseFloat(c.fontSize) * 10) / 10, weight: Number(c.fontWeight) || 400 });
    }
    return out.sort((a, b) => a.px - b.px);
  });
}

/** Visible interactive controls and their box size. `inline` marks links inside running text (exempt under WCAG 2.5.8). */
export async function tapTargets(page: Page): Promise<TapSample[]> {
  return page.evaluate(() => {
    const sel = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [tabindex]:not([tabindex='-1'])";
    const out: { name: string; tag: string; w: number; h: number; inline: boolean }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || c.visibility === "hidden") continue;
      if (el.closest(".sr-only") || (el.className.toString().includes("sr-only") && !el.matches(":focus"))) continue;
      const parentText = (el.parentElement?.innerText ?? "").length;
      const inline = el.tagName === "A" && c.display === "inline" && parentText > (el.innerText ?? "").length + 20;
      const name = (el.getAttribute("aria-label") || el.innerText || (el as HTMLInputElement).placeholder || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 50);
      out.push({ name, tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), inline });
    }
    return out;
  });
}

// ---------------------------------------------------------------- motion

export type Running = { kind: string; name: string; duration: number | string; iterations: number | string; target: string };

/** Animations and transitions that are running now and last longer than `minMs` (or forever). */
export async function runningMotion(page: Page, minMs = 100): Promise<Running[]> {
  return page.evaluate((minMs) => {
    return document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => {
        const t = a.effect?.getComputedTiming();
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const name = (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id ?? "";
        const cls = target ? `${target.tagName.toLowerCase()}.${(target.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".")}` : "";
        return { kind: a.constructor.name, name, duration: (t?.duration as number) ?? 0, iterations: t?.iterations ?? 1, target: cls };
      })
      .filter((a) => a.iterations === Infinity || Number(a.duration) * Number(a.iterations) > minMs)
      .map((a) => ({ ...a, iterations: a.iterations === Infinity ? "infinite" : a.iterations }));
  }, minMs);
}

// ---------------------------------------------------------------- steady text for screenshots

export type Rewrite = [pattern: string, flags: string, replacement: string];

/** Dates, times, countdowns, relative times, ids and the port: the text that changes from run to run. */
export const TIME_REWRITES: Rewrite[] = [
  ["\\b\\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)\\b", "g", "16 November"],
  ["\\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\b", "g", "Monday"],
  ["\\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\b", "g", "Mon"],
  ["\\b\\d{1,2}\\.\\d{1,2}\\.(\\d{4})?(?!\\d)", "g", "1.1."],
  ["\\b\\d{1,2}[.:]\\d{2}([.:]\\d{2})?\\b", "g", "12.00"],
  ["\\b\\d+ ?(s|sec|seconds?|min|minutes?|h|hours?|days?|weeks?)\\b", "g", "5 min"],
  ["localhost:\\d+", "g", "localhost:4601"],
  ["\\b(req|ord|apr|sbx|org|agent|agt|quote|q|r)_[A-Za-z0-9_-]{4,}", "g", "$1_000000"],
  ["\\b[0-9a-f]{12,}\\b", "g", "0000000000"],
];

/** Every number, for screens whose counts move with whatever else ran on the server (ops, the order list). */
export const DIGIT_REWRITES: Rewrite[] = [["\\d+", "g", "0"]];

/**
 * Rewrite the text that changes between runs, now and whenever React re-renders it (a MutationObserver re-applies the
 * rewrites). Replacements are fixed strings, so the layout they produce is the same every run.
 */
export async function steadyText(page: Page, rewrites: Rewrite[]): Promise<void> {
  await page.evaluate((rules) => {
    const w = window as unknown as { __steady?: MutationObserver };
    w.__steady?.disconnect();
    const res = rules.map(([p, f, r]) => [new RegExp(p, f), r] as const);
    const fix = (t: Text) => {
      const v = t.nodeValue ?? "";
      let nv = v;
      for (const [re, r] of res) nv = nv.replace(re, r);
      if (nv !== v) t.nodeValue = nv;
    };
    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) return fix(root as Text);
      const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = it.nextNode(); n; n = it.nextNode()) fix(n as Text);
    };
    walk(document.body);
    const mo = new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === "characterData") fix(m.target as Text);
        else m.addedNodes.forEach(walk);
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    w.__steady = mo;
  }, rewrites);
}

/** Literal-string rewrites, e.g. the random demo kitchen and person names. */
export const literal = (from: string, to: string): Rewrite => [from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g", to];
