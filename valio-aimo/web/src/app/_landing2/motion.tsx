"use client";

import { useEffect } from "react";

/**
 * The landing page's motion, as an enhancement over a page that is complete without it. Nothing here runs when the
 * reader asks for reduced motion, and without this script every section stays as it was rendered: all steps, all
 * figures, every screenshot.
 *
 * What it does:
 *   - marks the page `l2-js` (and `l2-sdt` where the browser has scroll-driven animations), which switches the CSS
 *     from its resting layout to its animated one;
 *   - draws the spine to the middle of the screen and slims the header, in one requestAnimationFrame per scroll;
 *   - where scroll-driven animations are missing, feeds the same keyframes a progress (`--p`) from the scroll, so
 *     every browser plays the same motion;
 *   - plays the hero's frames and the facts as short reels that stop when out of view, on hover, focus or a tap;
 *   - runs the agent's story by the step in the middle of the screen (scrolling back reverses it);
 *   - plays the comparison once when it comes into view, the figures counting up to their exact values;
 *   - feeds the webshop section its track progress where scroll timelines are missing (the CSS does the rest).
 * Only transform and opacity change, and nothing plays twice.
 */
export function Motion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".l2");
    if (!root || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const sdt = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");
    root.classList.add("l2-js");
    if (sdt) root.classList.add("l2-sdt");
    const off: (() => void)[] = [];
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    // ---- count a figure up to its exact value
    const count = (el: Element, to: number, ms = 560) => {
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        el.textContent = String(Math.round(to * e));
        if (k < 1) requestAnimationFrame(step);
        else el.textContent = String(to);
      };
      requestAnimationFrame(step);
    };

    // ---- reveal once
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          reveal.unobserve(e.target);
          e.target.classList.add("is-in");
          if (e.target.matches("[data-race]")) race(e.target as HTMLElement);
        }
      },
      { threshold: 0.35 },
    );
    root.querySelectorAll("[data-reveal], [data-race], [data-crash], [data-node]").forEach((el) => reveal.observe(el));
    off.push(() => reveal.disconnect());

    // ---- the comparison: theirs grow and stop, then ours passes them, then the counters flip in
    const race = (el: HTMLElement) => {
      el.querySelectorAll("[data-count-to]").forEach((c) => (c.textContent = "0"));
      el.classList.add("go-theirs");
      el.querySelectorAll(".l2-bar:not(.l2-bar-ours) [data-count-to]").forEach((c, i) => later(() => count(c, Number(c.getAttribute("data-count-to"))), i * 110));
      later(() => {
        el.classList.add("go-ours");
        const c = el.querySelector(".l2-bar-ours [data-count-to]");
        if (c) count(c, Number(c.getAttribute("data-count-to")), 600);
      }, 820);
      later(() => el.classList.add("go-flips"), 1480);
    };
    root.querySelectorAll("[data-race] [data-count-to]").forEach((c) => (c.textContent = "0"));

    // ---- the hero reel and the facts reel: auto-advancing, paused out of view, on hover, focus or a tap
    type Reel = { el: HTMLElement; items: HTMLElement[]; segs: HTMLElement[]; ms: number; i: number; userPaused: boolean; hover: boolean; seen: boolean; timer?: number; onShow?: (i: number) => void; toggle?: HTMLButtonElement | null; hold?: number };
    const reels: Reel[] = [];
    const show = (r: Reel, i: number) => {
      r.i = i;
      r.items.forEach((x, k) => x.classList.toggle("is-on", k === i));
      r.segs.forEach((s, k) => {
        s.classList.toggle("is-done", k < i);
        s.classList.toggle("is-now", k === i);
      });
      r.onShow?.(i);
    };
    const tick = (r: Reel) => {
      window.clearTimeout(r.timer);
      if (r.userPaused || r.hover || !r.seen || document.hidden) return;
      const last = r.i === r.items.length - 1;
      r.timer = window.setTimeout(() => {
        show(r, last ? 0 : r.i + 1);
        tick(r);
      }, last ? (r.hold ?? r.ms) : r.ms);
    };
    const setPaused = (r: Reel, p: boolean) => {
      r.userPaused = p;
      r.el.classList.toggle("is-paused", p);
      if (r.toggle) r.toggle.setAttribute("aria-label", r.toggle.getAttribute(p ? "data-label-play" : "data-label-pause") ?? "");
      tick(r);
    };
    const makeReel = (el: HTMLElement, items: HTMLElement[], segs: HTMLElement[], ms: number, toggle: HTMLButtonElement | null, onShow?: (i: number) => void, hold?: number) => {
      const r: Reel = { el, items, segs, ms, i: 0, userPaused: false, hover: false, seen: false, toggle, onShow, hold };
      reels.push(r);
      el.classList.add("l2-live");
      show(r, 0);
      const seen = new IntersectionObserver(([e]) => {
        r.seen = e.isIntersecting;
        tick(r);
      }, { threshold: 0.4 });
      seen.observe(el);
      const enter = () => ((r.hover = true), tick(r));
      const leave = () => ((r.hover = false), tick(r));
      el.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && enter());
      el.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && leave());
      el.addEventListener("focusin", enter);
      el.addEventListener("focusout", leave);
      toggle?.addEventListener("click", () => setPaused(r, !r.userPaused));
      off.push(() => (seen.disconnect(), window.clearTimeout(r.timer)));
      return r;
    };

    const reelEl = root.querySelector<HTMLElement>("[data-reel]");
    if (reelEl) {
      const frames = [...reelEl.querySelectorAll<HTMLElement>("[data-frame]")];
      const caption = reelEl.querySelector("[data-reel-caption]");
      const r = makeReel(reelEl, frames, [...reelEl.querySelectorAll<HTMLElement>(".l2-reel-progress i")], 1150, reelEl.querySelector("[data-reel-toggle]"), (i) => {
        if (caption) caption.textContent = frames[i]?.getAttribute("data-caption") ?? "";
      }, 2200);
      // A tap on the phone pauses and plays, like a story on a phone.
      reelEl.querySelector(".l2-reel-phone")?.addEventListener("click", () => setPaused(r, !r.userPaused));
      reelEl.querySelector("[data-reel-replay]")?.addEventListener("click", () => {
        show(r, 0);
        setPaused(r, false);
      });
    }
    const factsEl = root.querySelector<HTMLElement>("[data-facts]");
    if (factsEl) makeReel(factsEl, [...factsEl.querySelectorAll<HTMLElement>("[data-fact]")], [...factsEl.querySelectorAll<HTMLElement>(".l2-facts-bar i")], 3600, factsEl.querySelector("[data-facts-toggle]"));
    const vis = () => reels.forEach(tick);
    document.addEventListener("visibilitychange", vis);
    off.push(() => document.removeEventListener("visibilitychange", vis));

    // ---- the story: the step in the middle of the screen is "now"; scrolling back reverses it
    const story = root.querySelector<HTMLElement>("[data-story]");
    if (story) {
      const steps = [...story.querySelectorAll<HTMLElement>("[data-step]")];
      const frames = [...story.querySelectorAll<HTMLElement>("[data-stage-frame]")];
      const counters = [...story.querySelectorAll<HTMLElement>("[data-counter]")];
      counters.forEach((c) => (c.textContent = "0"));
      const shown = new Map<HTMLElement, number>(counters.map((c) => [c, 0]));
      let now = -1;
      const go = (a: number) => {
        if (a === now) return;
        now = a;
        steps.forEach((s, k) => {
          s.classList.toggle("is-now", k === a);
          s.classList.toggle("is-past", k < a);
        });
        frames.forEach((f, k) => f.classList.toggle("is-on", k === a));
        for (const c of counters) {
          const want = a >= Number(c.getAttribute("data-at")) ? Number(c.getAttribute("data-to")) : 0;
          if (shown.get(c) !== want) {
            shown.set(c, want);
            if (want) count(c, want, 520);
            else c.textContent = "0";
          }
        }
      };
      go(0);
      const mid = new IntersectionObserver(
        (entries) => {
          for (const e of entries) if (e.isIntersecting) go(steps.indexOf(e.target as HTMLElement));
        },
        { rootMargin: "-48% 0px -48% 0px" },
      );
      steps.forEach((s) => mid.observe(s));
      off.push(() => mid.disconnect());
    }

    // ---- one frame per scroll: the spine, the header, and the progress the CSS needs where it has no scroll timelines
    const spine = root.querySelector<HTMLElement>(".l2-spine");
    const fill = root.querySelector<HTMLElement>("[data-spine]");
    const header = root.querySelector<HTMLElement>("[data-header]");
    const linked = sdt ? [] : [...root.querySelectorAll<HTMLElement>("[data-run], [data-morph], [data-track], [data-map], [data-shop-track]")];
    let queued = false;
    const frame = () => {
      queued = false;
      const vh = window.innerHeight;
      if (spine && fill) {
        const r = spine.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (vh * 0.52 - r.top) / Math.max(1, r.height)));
        fill.style.transform = `scaleY(${f.toFixed(4)})`;
      }
      header?.classList.toggle("l2-slim", window.scrollY > 24);
      for (const el of linked) {
        const r = el.getBoundingClientRect();
        // "contain" for the tall tracks (progress while they fill the screen); "cover" for the rest.
        const p = el.hasAttribute("data-track") || el.hasAttribute("data-shop-track") ? -r.top / Math.max(1, r.height - vh) : (vh - r.top) / (vh + r.height);
        el.style.setProperty("--p", Math.max(0, Math.min(1, p)).toFixed(4));
      }
    };
    const onScroll = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(frame);
      }
    };
    frame();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    off.push(() => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    });

    return () => {
      off.forEach((f) => f());
      timers.forEach((id) => window.clearTimeout(id));
      root.classList.remove("l2-js", "l2-sdt");
    };
  }, []);
  return null;
}
