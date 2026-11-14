"use client";

import * as React from "react";
import type { CustomBlock } from "@/lib/widgets/types";

/**
 * Runs a model-written HTML fragment in a sandboxed frame.
 * - `sandbox="allow-scripts"` only: the frame has an opaque origin and cannot reach the app.
 * - A CSP meta tag blocks every network request (images from https and data: excepted).
 * - The app's design tokens are copied in, so a fragment looks native without restyling.
 * - A tiny bridge (`window.hovi`) lets the fragment ask the agent, open a link or copy text,
 *   and reports its height so the frame fits its content.
 */

const TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--muted",
  "--muted-foreground",
  "--border",
  "--primary",
  "--primary-foreground",
  "--brand",
  "--brand-soft",
  "--up",
  "--down",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--radius",
];

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: data:; font-src data:;";
const MIN_H = 60;
const MAX_H = 900;

const clampHeight = (h: number) => Math.min(MAX_H, Math.max(MIN_H, Math.round(h)));

/* Theme: `true` for dark, `false` for light, `null` on the server. */
function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
const themeSnapshot = () => document.documentElement.classList.contains("dark");
const serverThemeSnapshot = () => null;

function readTokens(): string {
  const cs = getComputedStyle(document.documentElement);
  return TOKENS.map((name) => {
    const v = cs.getPropertyValue(name).trim();
    return v ? `${name}: ${v};` : "";
  })
    .filter(Boolean)
    .join(" ");
}

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; padding: 2px; background: transparent; color: var(--foreground); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1, h2, h3 { margin: 0 0 8px; line-height: 1.25; font-weight: 600; letter-spacing: -0.01em; }
h1 { font-size: 20px; } h2 { font-size: 17px; } h3 { font-size: 15px; }
p { margin: 0 0 8px; }
a { color: var(--brand); text-underline-offset: 2px; }
label { display: block; font-size: 12.5px; color: var(--muted-foreground); margin-bottom: 4px; }
button, .btn {
  font: inherit; font-size: 13.5px; font-weight: 500; height: 36px; padding: 0 14px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--card); color: var(--foreground); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: background-color .15s, opacity .15s;
}
button:hover, .btn:hover { background: var(--muted); }
button:disabled { opacity: .5; cursor: default; }
.btn-primary, button.btn-primary { background: var(--primary); color: var(--primary-foreground); border-color: transparent; }
.btn-primary:hover, button.btn-primary:hover { background: var(--primary); opacity: .9; }
input, select, textarea {
  font: inherit; font-size: 14px; color: var(--foreground); background: var(--card); width: 100%;
  border: 1px solid var(--border); border-radius: calc(var(--radius) * 0.8); padding: 0 10px; height: 36px;
}
textarea { height: auto; padding: 8px 10px; }
input[type="range"], input[type="checkbox"], input[type="radio"] { width: auto; height: auto; padding: 0; accent-color: var(--brand); }
input[type="range"] { width: 100%; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--brand-soft); border-color: var(--brand); }
button:focus-visible, .btn:focus-visible, a:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
th { text-align: left; font-weight: 500; font-size: 12px; color: var(--muted-foreground); padding: 6px 8px; border-bottom: 1px solid var(--border); }
td { padding: 7px 8px; border-bottom: 1px solid var(--border); }
tr:last-child td { border-bottom: 0; }
.card { background: color-mix(in oklch, var(--muted) 70%, transparent); border: 1px solid var(--border); border-radius: calc(var(--radius) * 1.4); padding: 12px 14px; }
.muted { color: var(--muted-foreground); }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.nums { font-variant-numeric: tabular-nums; }
`;

const BRIDGE = `
(function () {
  function post(type, value) { try { parent.postMessage({ __hovi: true, type: type, value: value }, "*"); } catch (e) {} }
  window.hovi = {
    ask: function (text) { post("ask", String(text == null ? "" : text)); },
    open: function (url) { post("open", String(url == null ? "" : url)); },
    copy: function (text) { post("copy", String(text == null ? "" : text)); }
  };
  var last = 0;
  function report() {
    var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (h !== last) { last = h; post("height", h); }
  }
  function start() {
    report();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(report).observe(document.documentElement);
    window.addEventListener("load", report);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
`;

function buildDoc(fragment: string, tokens: string, dark: boolean): string {
  // The bridge runs before the fragment, so `hovi` exists when the fragment's own scripts run.
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>:root { color-scheme: ${dark ? "dark" : "light"}; ${tokens} }${BASE_CSS}</style>
<script>${BRIDGE}</script>
</head><body>${fragment}</body></html>`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Focus is inside the frame, so the async clipboard can refuse; fall back to a hidden textarea.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  } catch {
    // Nothing else to try.
  }
}

export function CustomHtml({
  block,
  pending,
  onAsk,
}: {
  block: CustomBlock;
  /** True while the model is still writing this block: the frame is not mounted yet. */
  pending?: boolean;
  onAsk?: (prompt: string) => void;
}) {
  const startHeight = clampHeight(typeof block.height === "number" && Number.isFinite(block.height) ? block.height : 240);
  const fragment = typeof block.html === "string" ? block.html : "";
  const dark = React.useSyncExternalStore(subscribeTheme, themeSnapshot, serverThemeSnapshot);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState<number | null>(null);

  const doc = React.useMemo(() => (dark === null ? null : buildDoc(fragment, readTokens(), dark)), [fragment, dark]);

  const onAskRef = React.useRef(onAsk);
  React.useEffect(() => {
    onAskRef.current = onAsk;
  }, [onAsk]);

  React.useEffect(() => {
    function onMessage(event: MessageEvent) {
      const win = frameRef.current?.contentWindow;
      if (!win || event.source !== win) return;
      const msg = event.data as { __hovi?: boolean; type?: string; value?: unknown } | null;
      if (!msg || typeof msg !== "object" || msg.__hovi !== true) return;
      if (msg.type === "height") {
        const h = Number(msg.value);
        if (Number.isFinite(h)) setHeight(clampHeight(h));
        return;
      }
      const value = typeof msg.value === "string" ? msg.value : "";
      if (msg.type === "ask") {
        const text = value.trim().slice(0, 2000);
        if (text) onAskRef.current?.(text);
      } else if (msg.type === "open") {
        if (/^https?:\/\//i.test(value)) window.open(value, "_blank", "noopener,noreferrer");
      } else if (msg.type === "copy") {
        void copyText(value.slice(0, 20000));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (pending || doc === null || !fragment.trim()) {
    if (!pending && doc !== null) return null;
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface/50"
        style={{ height: Math.min(startHeight, 220) }}
        aria-busy
      >
        <div className="flex w-2/3 max-w-[16rem] flex-col gap-2" aria-hidden>
          <div className="shimmer h-2.5 w-full rounded" />
          <div className="shimmer h-2.5 w-4/5 rounded" />
          <div className="shimmer h-2.5 w-3/5 rounded" />
        </div>
        <span className="text-shimmer text-[0.8rem]">Building a custom view</span>
      </div>
    );
  }

  return (
    <iframe
      ref={frameRef}
      title={block.title || "Custom view"}
      srcDoc={doc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="block w-full border-0 bg-transparent transition-[height] duration-200 ease-out"
      style={{ height: height ?? startHeight, colorScheme: dark ? "dark" : "light" }}
    />
  );
}
