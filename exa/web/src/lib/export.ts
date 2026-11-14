/**
 * Getting content out of the app: to the clipboard, to a file, to the printer.
 * Browser only: call these from event handlers.
 */

/**
 * Copy text. With `html`, a formatted version goes on the clipboard too, so the content pastes
 * with its headings, tables and links into a document or an email, and as plain text elsewhere.
 */
export async function copyText(text: string, html?: string): Promise<boolean> {
  if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    } catch {
      /* fall through to plain text */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission.
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Save text as a file through the browser's download. */
export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before the address is released.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** A file name from a title: "Is a heat pump worth it in Finland?" becomes "is-a-heat-pump-worth-it-in-finland". */
export function fileSlug(title: string, fallback = "report"): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= 60) return slug || fallback;
  // Cut at a word, not in the middle of one.
  const cut = slug.slice(0, 60);
  return cut.slice(0, Math.max(cut.lastIndexOf("-"), 30));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const KEEP = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A", "STRONG", "EM", "B", "I", "CODE", "PRE", "BLOCKQUOTE", "HR", "BR", "DEL", "SUP", "SUB"]);
const DROP = new Set(["BUTTON", "SVG", "IMG", "SCRIPT", "STYLE", "INPUT", "TEXTAREA", "SELECT"]);

/** The markdown renderer draws bold, italic and inline code as styled spans; this names what they mean. */
const MEANING: Record<string, string> = { strong: "STRONG", bold: "STRONG", em: "EM", emphasis: "EM", italic: "EM", "inline-code": "CODE", del: "DEL", strikethrough: "DEL" };

function semanticTag(el: Element): string {
  const tag = el.tagName.toUpperCase();
  if (tag !== "SPAN") return tag;
  const meaning = MEANING[el.getAttribute("data-streamdown") ?? ""];
  if (meaning) return meaning;
  const cls = el.getAttribute("class") ?? "";
  if (/\bfont-(semibold|bold)\b/.test(cls)) return "STRONG";
  if (/(^|\s)italic(\s|$)/.test(cls)) return "EM";
  return tag;
}

function clean(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? "");
  if (!(node instanceof Element)) return null;
  const tag = semanticTag(node);
  if (DROP.has(tag)) return null;
  const children = Array.from(node.childNodes)
    .map((child) => clean(child, doc))
    .filter((child): child is Node => child !== null);
  if (!KEEP.has(tag)) {
    // A wrapper the app added for layout: keep what is inside it.
    const fragment = doc.createDocumentFragment();
    fragment.append(...children);
    return fragment;
  }
  const el = doc.createElement(tag.toLowerCase());
  if (tag === "A") {
    const href = node.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) el.setAttribute("href", href);
  }
  el.append(...children);
  return el;
}

/**
 * Plain, portable HTML from markdown the app has rendered: headings, paragraphs, lists, tables and
 * links only. The app's own styling, icons and buttons are left behind.
 */
export function portableHtml(rendered: HTMLElement): string {
  const doc = document.implementation.createHTMLDocument("");
  const holder = doc.createElement("div");
  const cleaned = clean(rendered, doc);
  if (cleaned) holder.append(cleaned);
  return holder.innerHTML;
}

const DOCUMENT_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #faf8f3; color: #1c211d; font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 3.5rem 1.5rem 4rem; }
  .kicker { margin: 0 0 .6rem; font-size: .78rem; letter-spacing: .08em; text-transform: uppercase; color: #0f6b4f; font-weight: 600; }
  h1 { margin: 0 0 1.6rem; font: 400 2.1rem/1.15 "Instrument Serif", "Iowan Old Style", Georgia, "Times New Roman", serif; letter-spacing: -.01em; text-wrap: balance; }
  h2 { margin: 2.1rem 0 .6rem; font-size: 1.15rem; line-height: 1.3; }
  h3, h4 { margin: 1.6rem 0 .4rem; font-size: 1rem; }
  p { margin: 0 0 1rem; }
  ul, ol { margin: 0 0 1rem; padding-left: 1.3rem; }
  li { margin: .25rem 0; }
  a { color: #0f6b4f; text-decoration: underline; text-decoration-color: rgba(15, 107, 79, .35); text-underline-offset: 3px; overflow-wrap: anywhere; }
  table { width: 100%; margin: 0 0 1.2rem; border-collapse: collapse; font-size: .92rem; }
  th, td { padding: .5rem .65rem; border: 1px solid #e2ded3; text-align: left; vertical-align: top; }
  th { background: #f1eee6; font-weight: 600; }
  blockquote { margin: 0 0 1rem; padding-left: 1rem; border-left: 3px solid #d8d3c5; color: #4d564f; }
  code { font: .9em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1eee6; padding: .1em .3em; border-radius: 4px; }
  hr { margin: 2rem 0; border: 0; border-top: 1px solid #e2ded3; }
  .sources { margin-top: 2.6rem; padding-top: 1.4rem; border-top: 1px solid #e2ded3; font-size: .9rem; }
  .sources h2 { margin-top: 0; }
  .sources li { margin: .35rem 0; }
  .sources span { color: #6a726c; }
  footer { margin-top: 2.4rem; font-size: .8rem; color: #6a726c; }
  @media print {
    body { background: #fff; font-size: 11.5pt; }
    main { max-width: none; padding: 0; }
    a { color: inherit; }
    h2, h3 { break-after: avoid; }
    table, li { break-inside: avoid; }
  }
  @page { margin: 2cm; }
`;

export type DocumentSource = { url: string; title?: string; domain?: string };

/** A self-contained page for a report: opens in any browser, prints cleanly, needs no network. */
export function reportDocument({
  title,
  bodyHtml,
  sources,
  kicker,
  footer,
  print,
}: {
  title: string;
  /** The report itself, as portable HTML. */
  bodyHtml: string;
  sources: DocumentSource[];
  /** Small line above the title, for example "Research report · 14 November 2026". */
  kicker: string;
  footer: string;
  /** Open the print dialog as soon as the page loads. */
  print?: boolean;
}): string {
  const list = sources
    .map((s) => `<li><a href="${esc(s.url)}">${esc(s.title?.trim() || s.domain || s.url)}</a>${s.domain ? ` <span>${esc(s.domain)}</span>` : ""}</li>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${DOCUMENT_STYLE}</style>
</head>
<body>
<main>
<p class="kicker">${esc(kicker)}</p>
<h1>${esc(title)}</h1>
${bodyHtml}
${list ? `<section class="sources"><h2>Sources</h2><ol>\n${list}\n</ol></section>` : ""}
<footer>${esc(footer)}</footer>
</main>
${print ? "<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 150); });</script>" : ""}
</body>
</html>`;
}

/** Open a page built in the browser in a new tab. Returns false when the browser blocked the tab. */
export function openDocument(html: string): boolean {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const opened = window.open(url, "_blank");
  // The new tab has read the page long before this fires.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return opened !== null;
}
