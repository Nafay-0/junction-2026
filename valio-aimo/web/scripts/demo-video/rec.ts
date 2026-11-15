/**
 * The demo video's recorder: real Chromium sessions, captured over the DevTools screencast, encoded with ffmpeg into
 * edit-ready 1920x1080 / 30 fps clips with every wait on the agent or the network compressed to about 1.2 s.
 *
 * A take keeps one clock. Each page being recorded writes JPEG frames with the screencast's own timestamps; the
 * script marks waits (`take.wait(...)`) and events (`take.event(...)`) on the same clock. At encode time real time is
 * mapped onto clip time: a wait longer than WAIT_MAX keeps its first 0.55 s and last 0.4 s at real speed and runs the
 * middle fast in 0.25 s, so the viewer sees the agent work without sitting through it. Events are written in clip time.
 *
 * Pages look operated by a person: a drawn pointer follows the real mouse (with a ripple on press), typing goes key
 * by key at a human pace, scrolling is animated.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from "@playwright/test";

export const CLIPS = "/Users/macbookair/dock-shots/demo-video/clips";
export const WORK = process.env.DEMO_WORK || "/Users/macbookair/dock-shots/demo-video/.work";
const FPS = 30;
const WAIT_MAX = 1.2;
const HEAD = 0.55;
const TAIL = 0.4;
const FAST = 0.25;

export const FAKE_NOW = process.env.FAKE_NOW ?? "2026-11-15T10:30:00+02:00";

// ------------------------------------------------------------------ the page side: pointer, clock

const POINTER_SCRIPT = (touch: boolean) => `
(() => {
  const TOUCH = ${touch};
  let x = -100, y = -100;
  const css = \`
  #__ptr{position:fixed;left:0;top:0;width:${touch ? 34 : 22}px;height:${touch ? 34 : 22}px;pointer-events:none;z-index:2147483647;
    transform:translate(-100px,-100px);will-change:transform}
  #__ptr svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
  .__rip{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;pointer-events:none;
    z-index:2147483646;border:2px solid rgba(20,120,255,.85);background:rgba(20,120,255,.18);animation:__rip .55s ease-out forwards}
  @keyframes __rip{from{transform:scale(.35);opacity:1}to{transform:scale(1.6);opacity:0}}\`;
  const svg = TOUCH
    ? '<svg width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="13" fill="rgba(30,30,30,.28)" stroke="rgba(255,255,255,.9)" stroke-width="2"/></svg>'
    : '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.2 14.2 L10 20.5 L12.8 19.3 L10.1 13.2 L15.8 13.2 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  function ensure() {
    if (!document.documentElement) return null;
    let st = document.getElementById('__ptr_css');
    if (!st) { st = document.createElement('style'); st.id = '__ptr_css'; st.textContent = css; document.documentElement.appendChild(st); }
    let p = document.getElementById('__ptr');
    if (!p) { p = document.createElement('div'); p.id = '__ptr'; p.innerHTML = svg; document.documentElement.appendChild(p); place(); }
    return p;
  }
  function place() {
    const p = document.getElementById('__ptr');
    if (p) p.style.transform = TOUCH ? 'translate(' + (x - 17) + 'px,' + (y - 17) + 'px)' : 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)';
  }
  window.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; ensure(); place(); }, true);
  window.addEventListener('mousedown', (e) => {
    ensure();
    const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700);
  }, true);
  setInterval(ensure, 400);
  window.__ptrSet = (nx, ny) => { x = nx; y = ny; ensure(); place(); };
})();`;

const CLOCK_SCRIPT = (iso: string) => `
(() => {
  const target = Date.parse(${JSON.stringify(iso)});
  if (!Number.isFinite(target)) return;
  const RealDate = Date; const offset = target - RealDate.now();
  function FakeDate(...a) { if (!new.target) return new RealDate(RealDate.now() + offset).toString();
    return a.length === 0 ? new RealDate(RealDate.now() + offset) : new RealDate(...a); }
  FakeDate.prototype = RealDate.prototype; FakeDate.now = () => RealDate.now() + offset;
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
  Object.defineProperty(FakeDate, Symbol.hasInstance, { value: (v) => v instanceof RealDate });
  globalThis.Date = FakeDate;
})();`;

export type Kind = "desktop" | "phone";
export const DESK = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 };
export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5 };

export async function launch(): Promise<Browser> {
  return chromium.launch({ channel: process.env.PW_CHANNEL || "chromium", args: [`--force-device-scale-factor=${process.env.FORCE_DSF || "1.5"}`, "--hide-scrollbars", "--font-render-hinting=none", "--force-color-profile=srgb"] });
}

export async function context(browser: Browser, base: string, kind: Kind = "desktop", extra: Record<string, unknown> = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    ...(kind === "phone" ? PHONE : DESK),
    locale: "en-GB",
    timezoneId: "Europe/Helsinki",
    baseURL: base,
    ...extra,
  });
  await ctx.addCookies([{ name: "aimopilot-lang", value: "en", url: base }]);
  // tsx keeps function names with a helper that does not exist in the page
  await ctx.addInitScript({ content: "window.__name = window.__name || ((f) => f);" });
  if (FAKE_NOW && /localhost|127\.0\.0\.1/.test(base)) await ctx.addInitScript({ content: CLOCK_SCRIPT(FAKE_NOW) });
  await ctx.addInitScript({ content: POINTER_SCRIPT(kind === "phone") });
  return ctx;
}

export async function passkey(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

// ------------------------------------------------------------------ the take: one clock, recorders, waits, events

type Frame = { t: number; file: string };

class Recorder {
  frames: Frame[] = [];
  private cdp?: CDPSession;
  private n = 0;
  constructor(
    readonly page: Page,
    readonly dir: string,
    readonly take: Take,
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }
  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    const vp = this.page.viewportSize()!;
    const dpr = (await this.page.evaluate(() => window.devicePixelRatio)) || 1;
    this.cdp.on("Page.screencastFrame", async (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const t = f.metadata.timestamp ? f.metadata.timestamp * 1000 : Date.now();
      const file = path.join(this.dir, `${String(this.n++).padStart(6, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, "base64"));
      this.frames.push({ t: t - this.take.t0, file });
      await this.cdp?.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: Math.round(vp.width * dpr),
      maxHeight: Math.round(vp.height * dpr),
      everyNthFrame: 1,
    });
  }
  async stop() {
    await this.cdp?.send("Page.stopScreencast").catch(() => undefined);
    await this.cdp?.detach().catch(() => undefined);
  }
  /** A fresh frame now, so a still page still has its current look on record (the screencast only sends changes). */
  async still() {
    const file = path.join(this.dir, `${String(this.n++).padStart(6, "0")}.jpg`);
    const t = Date.now() - this.take.t0;
    await this.page.screenshot({ path: file, type: "jpeg", quality: 92, caret: "hide" }).catch(() => undefined);
    if (fs.existsSync(file)) this.frames.push({ t, file });
  }
}

export class Take {
  t0 = Date.now();
  waits: [number, number][] = [];
  events: { t: number; name: string }[] = [];
  recorders: Recorder[] = [];
  cuts: [number, number][] = [];
  dir: string;
  constructor(readonly name: string) {
    this.dir = path.join(WORK, name);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }
  now() {
    return Date.now() - this.t0;
  }
  async record(page: Page, label = "main") {
    const r = new Recorder(page, path.join(this.dir, label), this);
    this.recorders.push(r);
    await r.start();
    return r;
  }
  /** Restart the clock (and drop frames) so a clip begins at this moment. */
  reset() {
    const now = this.now();
    this.cuts.push([0, now]);
  }
  event(name: string) {
    this.events.push({ t: this.now(), name });
    console.log(`    [${(this.now() / 1000).toFixed(1)}s] ${name}`);
  }
  /** Something the viewer would otherwise sit through: compressed at encode time. */
  async wait<T>(fn: () => Promise<T>): Promise<T> {
    const a = this.now();
    try {
      return await fn();
    } finally {
      this.waits.push([a, this.now()]);
    }
  }
  /** A stretch to cut out completely (setting up off camera). */
  async offCamera<T>(fn: () => Promise<T>): Promise<T> {
    const a = this.now();
    try {
      return await fn();
    } finally {
      this.cuts.push([a, this.now()]);
    }
  }
  ended?: number;
  async stop() {
    for (const r of this.recorders) await r.stop();
    this.ended = this.now();
    this.save();
  }

  /** Real ms -> clip seconds, as a list of linear pieces. */
  pieces(end: number) {
    type Piece = { r0: number; r1: number; c0: number; c1: number };
    const spans: { a: number; b: number; kind: "cut" | "wait" }[] = [
      ...this.cuts.map(([a, b]) => ({ a, b, kind: "cut" as const })),
      ...this.waits.filter(([a, b]) => (b - a) / 1000 > WAIT_MAX).map(([a, b]) => ({ a, b, kind: "wait" as const })),
    ].sort((p, q) => p.a - q.a);
    // merge overlaps; a cut wins over a wait
    const merged: typeof spans = [];
    for (const s of spans) {
      const last = merged.at(-1);
      if (last && s.a <= last.b) {
        last.b = Math.max(last.b, s.b);
        if (s.kind === "cut") last.kind = "cut";
      } else merged.push({ ...s });
    }
    const out: Piece[] = [];
    let r = 0;
    let c = 0;
    const lin = (r0: number, r1: number, dur: number) => {
      if (r1 <= r0) return;
      out.push({ r0, r1, c0: c, c1: c + dur });
      c += dur;
    };
    for (const s of merged) {
      lin(r, s.a, (s.a - r) / 1000);
      if (s.kind === "cut") {
        r = s.b;
        continue;
      }
      const H = HEAD * 1000;
      const T = TAIL * 1000;
      lin(s.a, s.a + H, HEAD);
      lin(s.a + H, s.b - T, FAST);
      lin(s.b - T, s.b, TAIL);
      r = s.b;
    }
    lin(r, end, (end - r) / 1000);
    return out;
  }

  /** Encode every recorder to its own mp4 on the take's compressed timeline; returns paths and the clip length. */
  /** Everything needed to encode again later (scripts/demo-video/reencode.ts). */
  save() {
    const state = { end: this.now(), waits: this.waits, events: this.events, cuts: this.cuts, recorders: this.recorders.map((r) => ({ dir: r.dir, frames: r.frames })) };
    fs.writeFileSync(path.join(this.dir, "take.json"), JSON.stringify(state));
  }
  encode(): { files: Record<string, string>; seconds: number; events: { t: number; name: string }[]; map: (realMs: number) => number } {
    const end = this.ended ?? this.now();
    const pieces = this.pieces(end);
    const total = pieces.at(-1)?.c1 ?? 0;
    const toReal = (c: number) => {
      const p = pieces.find((q) => c >= q.c0 && c <= q.c1) ?? pieces.at(-1)!;
      return p.r0 + ((c - p.c0) / (p.c1 - p.c0 || 1)) * (p.r1 - p.r0);
    };
    const toClip = (rMs: number) => {
      const p = pieces.find((q) => rMs >= q.r0 && rMs <= q.r1);
      if (p) return p.c0 + ((rMs - p.r0) / (p.r1 - p.r0 || 1)) * (p.c1 - p.c0);
      const before = pieces.filter((q) => q.r1 <= rMs).at(-1);
      return before ? before.c1 : 0;
    };
    const files: Record<string, string> = {};
    const n = Math.max(1, Math.round(total * FPS));
    for (const rec of this.recorders) {
      const frames = rec.frames.sort((a, b) => a.t - b.t);
      if (!frames.length) continue;
      const list: string[] = [];
      let idx = 0;
      let prev = "";
      let run = 0;
      const flush = () => {
        if (prev && run) list.push(`file '${prev}'`, `duration ${(run / FPS).toFixed(5)}`);
      };
      for (let k = 0; k < n; k++) {
        const r = toReal(k / FPS);
        while (idx + 1 < frames.length && frames[idx + 1].t <= r) idx++;
        const f = frames[idx].file;
        if (f === prev) run++;
        else {
          flush();
          prev = f;
          run = 1;
        }
      }
      flush();
      list.push(`file '${prev}'`);
      const lf = path.join(rec.dir, "list.txt");
      fs.writeFileSync(lf, list.join("\n") + "\n");
      const out = path.join(rec.dir, "out.mp4");
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lf, "-vf", `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-t", total.toFixed(3), out]);
      files[path.basename(rec.dir)] = out;
    }
    const events = this.events.map((e) => ({ t: +toClip(e.t).toFixed(2), name: e.name }));
    return { files, seconds: total, events, map: toClip };
  }
}

/**
 * Deliver a clip: one recorder full frame (desktop, scaled to 1920x1080), or a desktop and a phone side by side, or a
 * phone alone centred on a quiet background.
 */
export function deliver(
  take: Take,
  o: { id: string; chapter: string; what: string; layout?: "desk" | "desk+phone" | "phone"; desk?: string; phone?: string; notes?: string },
) {
  const { files, seconds, events } = take.encode();
  fs.mkdirSync(CLIPS, { recursive: true });
  const out = path.join(CLIPS, `${o.id}.mp4`);
  const layout = o.layout ?? "desk";
  const desk = files[o.desk ?? "main"];
  const phone = files[o.phone ?? "phone"];
  const BG = "color=c=0xE9ECEF:s=1920x1080:r=30";
  let argv: string[];
  if (layout === "desk") {
    argv = ["-i", desk, "-vf", "scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p"];
  } else if (layout === "phone") {
    argv = ["-f", "lavfi", "-i", BG, "-i", phone, "-filter_complex", "[1:v]scale=-2:1000:flags=lanczos[p];[0:v][p]overlay=(W-w)/2:40:shortest=1,setsar=1,format=yuv420p"];
  } else {
    // desktop 1440x810 on the left, the phone 1000 px tall on the right, on a quiet grey
    argv = [
      "-f", "lavfi", "-i", BG, "-i", desk, "-i", phone, "-filter_complex",
      "[1:v]scale=1400:788:flags=lanczos[d];[2:v]scale=-2:1000:flags=lanczos[p];[0:v][d]overlay=24:146:shortest=1[a];[a][p]overlay=W-w-40:40:shortest=1,setsar=1,format=yuv420p",
    ];
  }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...argv, "-t", seconds.toFixed(3), "-r", "30", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-movflags", "+faststart", out]);
  const json = { chapter: o.chapter, what: o.what, seconds: +seconds.toFixed(2), events, ...(o.notes ? { notes: o.notes } : {}) };
  fs.writeFileSync(path.join(CLIPS, `${o.id}.json`), JSON.stringify(json, null, 2) + "\n");
  console.log(`  delivered ${o.id}.mp4 (${seconds.toFixed(1)} s, ${events.length} events)`);
  sheet(out, o.id);
  return { out, seconds };
}

/** A contact sheet of a clip (12 frames, small) for checking by eye. */
export function sheet(mp4: string, id: string) {
  const dir = path.join(CLIPS, "sheets");
  fs.mkdirSync(dir, { recursive: true });
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4]).toString().trim()) || 1;
  const every = Math.max(dur / 12, 0.1);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf", `fps=1/${every.toFixed(3)},scale=480:-2,tile=4x3:padding=4:color=white`, "-frames:v", "1", path.join(dir, `${id}.jpg`)]);
}

// ------------------------------------------------------------------ a person at the controls

const pos = new WeakMap<Page, { x: number; y: number }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { sleep };

export async function pointerAt(page: Page, x: number, y: number) {
  pos.set(page, { x, y });
  await page.mouse.move(x, y);
}

export async function moveTo(page: Page, x: number, y: number) {
  const p = pos.get(page) ?? { x: page.viewportSize()!.width * 0.6, y: page.viewportSize()!.height * 0.6 };
  const d = Math.hypot(x - p.x, y - p.y);
  const steps = Math.max(8, Math.min(40, Math.round(d / 18)));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
    await page.mouse.move(p.x + (x - p.x) * e, p.y + (y - p.y) * e);
    await sleep(12);
  }
  pos.set(page, { x, y });
}

/** Bring an element into view with an animated scroll if it is not comfortably on screen. */
export async function reveal(loc: Locator, o: { block?: "center" | "start" | "end"; offset?: number; ms?: number } = {}) {
  await loc.waitFor({ state: "attached", timeout: 30_000 });
  await loc.evaluate(
    async (el, { block, offset, ms }) => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.top >= 70 && r.bottom <= vh - 40 && block !== "start") return;
      let p: HTMLElement | null = el.parentElement;
      while (p && !(p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
      const box = p ? p.getBoundingClientRect() : { top: 0, height: vh };
      const want =
        block === "start" ? r.top - box.top - (offset ?? 90) : block === "end" ? r.bottom - box.top - box.height + (offset ?? 60) : r.top - box.top - box.height / 2 + r.height / 2;
      const target = p ?? (document.scrollingElement as HTMLElement);
      const from = target.scrollTop;
      const to = Math.max(0, Math.min(target.scrollHeight - target.clientHeight, from + want));
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const step = (now: number) => {
          const k = Math.min(1, (now - t0) / ms);
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          target.scrollTop = from + (to - from) * e;
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    },
    { block: o.block ?? "center", offset: o.offset, ms: o.ms ?? 750 },
  );
  await sleep(250);
}

/** Scroll the page (or the scroll container under a point) by dy, animated. */
export async function scrollBy(page: Page, dy: number, o: { ms?: number; at?: { x: number; y: number } } = {}) {
  const at = o.at ?? pos.get(page) ?? { x: 640, y: 400 };
  await page.evaluate(
    async ({ dy, ms, at }) => {
      let p = document.elementFromPoint(at.x, at.y) as HTMLElement | null;
      while (p && !(p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
      const target = p ?? (document.scrollingElement as HTMLElement);
      const from = target.scrollTop;
      const to = Math.max(0, Math.min(target.scrollHeight - target.clientHeight, from + dy));
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const step = (now: number) => {
          const k = Math.min(1, (now - t0) / ms);
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          target.scrollTop = from + (to - from) * e;
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    },
    { dy, ms: o.ms ?? Math.min(1800, 400 + Math.abs(dy) * 1.1), at },
  );
  await sleep(200);
}

export async function hover(loc: Locator) {
  await reveal(loc);
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box to hover");
  await moveTo(loc.page(), b.x + b.width / 2 + (Math.random() - 0.5) * Math.min(10, b.width / 4), b.y + b.height / 2);
}

export async function click(loc: Locator, o: { pause?: number } = {}) {
  await loc.waitFor({ state: "visible", timeout: 30_000 });
  await hover(loc);
  await sleep(140);
  const page = loc.page();
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(o.pause ?? 350);
}

/** Click a field and type into it key by key, at a human pace. */
export async function type(loc: Locator, text: string, o: { enter?: boolean; cps?: number } = {}) {
  await click(loc, { pause: 200 });
  const page = loc.page();
  const base = 1000 / (o.cps ?? 16);
  for (const ch of text) {
    await page.keyboard.type(ch);
    let d = base * (0.6 + Math.random() * 0.8);
    if (ch === " ") d *= 1.3;
    if (/[,.?]/.test(ch)) d *= 2.2;
    await sleep(d);
  }
  if (o.enter) {
    await sleep(380);
    await page.keyboard.press("Enter");
  }
}

/** Wait until nothing on the page is on its way (no busy region, no skeleton). */
export async function quiet(page: Page, ms = 20_000) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const busy = await page
      .evaluate(() => [...document.querySelectorAll('[aria-busy="true"], .skeleton')].filter((el) => (el as HTMLElement).getBoundingClientRect().width > 0).length)
      .catch(() => 0);
    if (!busy) break;
    await sleep(300);
  }
}

export const args = process.argv.slice(2);
export const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
