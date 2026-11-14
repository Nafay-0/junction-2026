import "server-only";
import { Marked } from "marked";
import { EMAIL_STYLE } from "./layout";

/*
 * What the agent writes (Markdown) as HTML an email program will show properly. Email ignores
 * stylesheets, so every tag carries its own style. Raw HTML in the text is dropped: what the
 * agent read on the web must not be able to put markup of its own into someone's inbox.
 */

const { INK, MUTED, LINE, BRAND, FONT } = EMAIL_STYLE;

const STYLES: Record<string, string> = {
  h1: `margin:26px 0 10px;font:700 19px/1.35 ${FONT};color:${INK}`,
  h2: `margin:24px 0 8px;font:700 17px/1.35 ${FONT};color:${INK}`,
  h3: `margin:20px 0 6px;font:700 15px/1.4 ${FONT};color:${INK}`,
  h4: `margin:18px 0 6px;font:700 14px/1.4 ${FONT};color:${INK}`,
  p: "margin:0 0 13px",
  ul: "margin:0 0 14px;padding-left:22px",
  ol: "margin:0 0 14px;padding-left:22px",
  li: "margin:0 0 6px",
  a: `color:${BRAND};text-decoration:underline`,
  strong: `color:${INK}`,
  blockquote: `margin:0 0 14px;padding:2px 0 2px 14px;border-left:3px solid ${LINE};color:${MUTED}`,
  hr: `border:0;border-top:1px solid ${LINE};margin:22px 0`,
  code: "font:13px ui-monospace,Menlo,Consolas,monospace;background:#f1f4f2;border-radius:4px;padding:1px 4px",
  pre: "margin:0 0 14px;padding:12px 14px;background:#f1f4f2;border-radius:10px;overflow:auto;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace",
  table: `width:100%;border-collapse:collapse;margin:4px 0 16px;font:400 14px/1.5 ${FONT}`,
  th: `text-align:left;padding:8px 10px;border-bottom:2px solid ${LINE};font-weight:600;color:${INK};vertical-align:bottom`,
  td: `padding:8px 10px;border-bottom:1px solid ${LINE};vertical-align:top`,
  img: "max-width:100%;height:auto;border-radius:10px",
};

const parser = new Marked({ gfm: true, breaks: false, renderer: { html: () => "" } });

export function markdownToEmailHtml(markdown: string): string {
  const html = parser.parse(markdown, { async: false }) as string;
  return (
    html
      // Only ordinary links: nothing that runs.
      .replace(/href="(?!https?:|mailto:)[^"]*"/gi, 'href="#"')
      .replace(/<(h1|h2|h3|h4|p|ul|ol|li|a|strong|blockquote|hr|code|pre|table|th|td|img)(?=[\s>/])/g, (_m, tag: string) => `<${tag} style="${STYLES[tag]}"`)
      // A table's own alignment attributes still apply; the first heading needs no gap above it.
      .replace(/^<(h1|h2|h3|h4) style="margin:\d+px /, (_m, tag: string) => `<${tag} style="margin:0 `)
  );
}

/** The same text without the marks, for the plain-text half of an email and for short previews. */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
