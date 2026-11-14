/**
 * Turns Chrome's accessibility tree into the short text the model reads as "the page".
 *
 * The raw tree of a large page runs to hundreds of thousands of characters. The model gets what a
 * person would see: what is in view (or the whole page, on request), as a list of things it can
 * act on, each with a reference like [e12], plus the text around them. Values of password, card
 * and code fields are hidden here, before anything reaches the model.
 */

import { isSensitiveName } from "./guard";
import type { Box } from "./protocol";

/** One node of Playwright's `ariaSnapshotJSON({ mode: "ai", boxes: true })`. */
export type AriaNode = {
  role: string;
  name?: string;
  ref?: string;
  box?: Box;
  text?: string;
  children?: Array<AriaNode | string>;
  level?: number;
  checked?: boolean | "mixed";
  selected?: boolean;
  disabled?: boolean;
  pressed?: boolean | "mixed";
  expanded?: boolean;
  cursor?: string;
  url?: string;
};

export type PageFacts = {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scrollY: number;
  pageHeight: number;
};

export type RenderOptions = {
  /** "view": what is on screen now. "page": the whole page. */
  scope: "view" | "page";
  /** Keep only lines containing this phrase (and the headings above them). */
  find?: string;
  /** References of fields whose value must not be shown. */
  sensitive?: Set<string>;
  maxChars?: number;
};

const ACTIONABLE = new Set([
  "link", "button", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio", "switch", "slider", "spinbutton",
  "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "treeitem",
]);
const FIELDS = new Set(["textbox", "searchbox", "spinbutton", "combobox", "slider"]);
/** Containers worth naming, because they tell the model where it is. */
const GROUPS = new Set(["dialog", "alertdialog", "form", "navigation", "search", "table", "tablist", "menu", "menubar", "radiogroup", "listbox", "grid", "toolbar"]);
const NAMED_GROUPS = new Set(["region", "group", "complementary", "main", "article", "list"]);
/** Parts of a page that are mostly links a visitor rarely needs: capped hard. */
const CHROME = new Set(["navigation", "contentinfo", "banner"]);
const CHROME_LINK_CAP = 10;

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Running text: a sentence with links and emphasis inside it reads as one line, not one line per fragment. */
const PROSE = new Set(["paragraph", "listitem", "cell", "blockquote", "caption", "term", "definition"]);
const INLINE = new Set(["link", "strong", "emphasis", "code", "mark", "superscript", "subscript", "insertion", "deletion", "time", "generic"]);

/** The node as one line of text, with links still marked so they can be clicked. Null when it holds more than text. */
function proseLine(node: AriaNode): string | null {
  const children = node.children ?? [];
  if (!children.some((c) => typeof c === "string")) return null;
  const parts: string[] = node.text ? [node.text] : [];
  for (const child of children) {
    if (typeof child === "string") {
      parts.push(child);
      continue;
    }
    if (!INLINE.has(child.role) || child.children?.some((c) => typeof c !== "string")) return null;
    const text = child.name ?? child.text ?? (child.children ?? []).filter((c): c is string => typeof c === "string").join(" ");
    parts.push(child.role === "link" && child.ref ? `${text} [${child.ref}]` : text);
  }
  return parts.join(" ").replace(/\s+([.,;:!?)])/g, "$1");
}

type Line = { indent: number; text: string };

type Walk = {
  options: RenderOptions;
  facts: PageFacts;
  lines: Line[];
  /** Offset of the frame being walked: boxes inside an iframe are relative to it. */
  dx: number;
  dy: number;
  chromeLinks: number;
  chromeSkipped: number;
};

function inView(w: Walk, box: Box | undefined): boolean {
  if (w.options.scope === "page") return true;
  if (!box) return true;
  if (box.width <= 1 && box.height <= 1) return false;
  const top = box.y + w.dy;
  const left = box.x + w.dx;
  // A little beyond the fold, so the model knows what the next scroll brings.
  return top < w.facts.viewport.height * 1.25 && top + box.height > -8 && left < w.facts.viewport.width && left + box.width > 0;
}

function describe(node: AriaNode, w: Walk): string {
  const ref = node.ref ? ` [${node.ref}]` : "";
  const flags = [
    node.disabled ? "disabled" : "",
    node.checked === true ? "checked" : node.checked === "mixed" ? "partly checked" : "",
    node.selected ? "selected" : "",
    node.pressed === true ? "pressed" : "",
    node.expanded === true ? "expanded" : node.expanded === false ? "collapsed" : "",
  ].filter(Boolean);
  const state = flags.length ? ` (${flags.join(", ")})` : "";
  const name = node.name ? ` "${clip(node.name, 110)}"` : "";

  if (FIELDS.has(node.role)) {
    const hidden = (node.ref && w.options.sensitive?.has(node.ref)) || isSensitiveName(node.name ?? "");
    if (node.role === "combobox" && node.children?.length) {
      const options = node.children.filter((c): c is AriaNode => typeof c !== "string" && c.role === "option");
      const chosen = options.find((o) => o.selected)?.name;
      const names = options.map((o) => clip(o.name ?? "", 40)).filter(Boolean);
      const list = names.length ? `; options: ${names.slice(0, 14).join(" | ")}${names.length > 14 ? ` | … ${names.length - 14} more` : ""}` : "";
      return `- ${node.role}${name}${ref}${state}: ${chosen ? `"${clip(chosen, 60)}"` : "nothing chosen"}${list}`;
    }
    const value = hidden ? (node.text ? "(hidden)" : "") : clip(node.text ?? "", 120);
    return `- ${node.role}${name}${ref}${state}${value ? `: ${value}` : ": (empty)"}`;
  }
  return `- ${node.role}${name || (node.text ? ` "${clip(node.text, 110)}"` : "")}${ref}${state}`;
}

function walk(node: AriaNode | string, indent: number, chrome: boolean, w: Walk) {
  if (typeof node === "string") {
    const text = clip(node, w.options.scope === "page" ? 500 : 240);
    if (text) w.lines.push({ indent, text });
    return;
  }
  const role = node.role;

  if (role === "iframe") {
    // Children of a frame carry boxes relative to that frame.
    const saved = { dx: w.dx, dy: w.dy };
    if (!inView(w, node.box)) return;
    w.dx += node.box?.x ?? 0;
    w.dy += node.box?.y ?? 0;
    for (const child of node.children ?? []) walk(child, indent, chrome, w);
    w.dx = saved.dx;
    w.dy = saved.dy;
    return;
  }

  const actionable = ACTIONABLE.has(role) || (node.cursor === "pointer" && Boolean(node.ref) && Boolean(node.name || node.text) && !node.children?.some((c) => typeof c !== "string"));
  if (actionable) {
    if (role === "option") return; // listed with its combobox
    if (!inView(w, node.box)) return;
    if (chrome && role === "link") {
      if (w.chromeLinks >= CHROME_LINK_CAP) {
        w.chromeSkipped += 1;
        return;
      }
      w.chromeLinks += 1;
    }
    w.lines.push({ indent, text: ACTIONABLE.has(role) ? describe(node, w) : describe({ ...node, role: "clickable" }, w) });
    return;
  }

  if (role === "heading") {
    if (!inView(w, node.box) || !node.name) return;
    w.lines.push({ indent, text: `${"#".repeat(Math.min(node.level ?? 2, 4))} ${clip(node.name, 160)}` });
    return;
  }
  if (role === "img") {
    if (node.name && inView(w, node.box) && !chrome) w.lines.push({ indent, text: `(image: ${clip(node.name, 80)})` });
    return;
  }
  if (role === "row") {
    if (!inView(w, node.box)) return;
    const cells = (node.children ?? []).filter((c): c is AriaNode => typeof c !== "string");
    const simple = cells.every((c) => !c.children?.some((cc) => typeof cc !== "string"));
    if (simple && cells.length) {
      w.lines.push({ indent, text: `| ${cells.map((c) => clip(c.name ?? c.text ?? "", 60)).join(" | ")} |` });
      return;
    }
  }

  if (PROSE.has(role)) {
    const line = proseLine(node);
    if (line !== null) {
      if (!inView(w, node.box)) return;
      const text = clip(line, w.options.scope === "page" ? 700 : 320);
      if (text) w.lines.push({ indent, text });
      return;
    }
  }

  const group = GROUPS.has(role) || (NAMED_GROUPS.has(role) && Boolean(node.name));
  let childIndent = indent;
  if (group && inView(w, node.box)) {
    w.lines.push({ indent, text: `[${role}${node.name ? ` "${clip(node.name, 80)}"` : ""}]` });
    childIndent = indent + 1;
  }
  if (node.text && inView(w, node.box)) {
    const text = clip(node.text, w.options.scope === "page" ? 500 : 240);
    if (text) w.lines.push({ indent: childIndent, text });
  }
  const insideChrome = chrome || CHROME.has(role);
  for (const child of node.children ?? []) walk(child, childIndent, insideChrome, w);
}

function findDialogs(nodes: Array<AriaNode | string>, out: AriaNode[] = []): AriaNode[] {
  for (const n of nodes) {
    if (typeof n === "string") continue;
    if (n.role === "dialog" || n.role === "alertdialog") out.push(n);
    else if (n.children) findDialogs(n.children, out);
  }
  return out;
}

/** Card numbers that slipped through as plain text. */
const LONG_NUMBER = /\b(?:\d[ -]?){13,19}\b/g;

export function renderPage(tree: AriaNode[], facts: PageFacts, options: RenderOptions): string {
  const max = options.maxChars ?? (options.scope === "page" ? 16_000 : 9_000);
  const w: Walk = { options, facts, lines: [], dx: 0, dy: 0, chromeLinks: 0, chromeSkipped: 0 };

  // An open dialog (a cookie banner, a date picker, a confirmation) comes first: it is what the
  // page wants dealt with before anything else.
  const dialogs = findDialogs(tree);
  for (const dialog of dialogs) walk(dialog, 0, false, w);
  const dialogLines = w.lines.length;
  if (dialogLines) w.lines.push({ indent: 0, text: "[rest of the page]" });
  const skip = new Set(dialogs);
  const rest = (nodes: Array<AriaNode | string>): Array<AriaNode | string> =>
    nodes.filter((n) => typeof n === "string" || !skip.has(n)).map((n) => (typeof n === "string" || !n.children ? n : { ...n, children: rest(n.children) }));
  for (const node of rest(tree)) walk(node, dialogLines ? 1 : 0, false, w);

  let lines = w.lines;
  // Drop repeats: a paragraph and the generic wrapper around it often say the same thing.
  lines = lines.filter((l, i) => i === 0 || l.text !== lines[i - 1].text);
  // Drop group headings that ended up empty.
  lines = lines.filter((l, i) => !(l.text.startsWith("[") && l.text.endsWith("]") && (lines[i + 1]?.indent ?? -1) <= l.indent && l.text !== "[rest of the page]"));

  if (options.find?.trim()) {
    const needle = options.find.trim().toLowerCase();
    const kept: Line[] = [];
    let heading: Line | null = null;
    for (const line of lines) {
      if (line.text.startsWith("#")) heading = line;
      if (line.text.toLowerCase().includes(needle)) {
        if (heading && heading !== line && !kept.includes(heading)) kept.push(heading);
        kept.push(line);
      }
    }
    lines = kept.length ? kept : [{ indent: 0, text: `Nothing on this page mentions "${clip(options.find, 60)}".` }];
  }

  const { viewport, scrollY, pageHeight } = facts;
  const above = scrollY > 4;
  const below = scrollY + viewport.height < pageHeight - 4;
  const where =
    options.scope === "page"
      ? "The whole page is listed."
      : `In view: ${Math.round(scrollY)} to ${Math.round(scrollY + viewport.height)} of ${Math.round(pageHeight)} px.${above ? " More above." : ""}${below ? " More below: scroll down to see it." : " This is the bottom of the page."}`;
  const head = [`Page: ${clip(facts.title || "(no title)", 120)}`, `URL: ${facts.url}`, where, ""];

  const body: string[] = [];
  let used = head.join("\n").length;
  let cut = 0;
  for (const line of lines) {
    const text = `${"  ".repeat(Math.min(line.indent, 4))}${line.text}`;
    if (used + text.length + 1 > max) {
      cut += 1;
      continue;
    }
    body.push(text.replace(LONG_NUMBER, "(number hidden)"));
    used += text.length + 1;
  }
  if (!body.length) body.push("(Nothing readable in view. The page may still be loading, or it is drawn as an image.)");
  const notes: string[] = [];
  if (w.chromeSkipped) notes.push(`${w.chromeSkipped} more menu and footer links not listed.`);
  if (cut) notes.push(`${cut} more lines did not fit. Use browserRead with find to look for something specific.`);
  return [...head, ...body, ...(notes.length ? ["", ...notes] : [])].join("\n");
}
