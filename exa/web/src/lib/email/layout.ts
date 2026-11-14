import "server-only";
import { APP_NAME } from "@/lib/brand";
import { siteUrl } from "@/lib/site";

/*
 * How every email from Beryl looks: one column, the name at the top, the content, one button,
 * a quiet footer. Email programs ignore stylesheets and most modern CSS, so the page is tables
 * and inline styles, and it reads well in a light and a dark inbox alike.
 */

const INK = "#16201c";
const MUTED = "#5d6b65";
const LINE = "#e3e9e5";
const BRAND = "#1f7a57";
const PAPER = "#f4f7f5";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type EmailPage = {
  /** The line an inbox shows next to the subject. */
  preview: string;
  /** A small label above the heading: "Job result", "Waiting for you". */
  label?: string;
  heading: string;
  /** One or two lines under the heading: when, what. Plain text. */
  lead?: string;
  /** The content, already HTML (see markdown.ts), or plain paragraphs. */
  bodyHtml?: string;
  button?: { label: string; href: string };
  /** Small print above the standard footer: why this was sent. Plain text. */
  why?: string;
};

export function emailPage(page: EmailPage): string {
  const site = siteUrl();
  const button = page.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px"><tr><td style="border-radius:999px;background:${BRAND}">
        <a href="${escapeHtml(page.button.href)}" style="display:inline-block;padding:11px 22px;font:600 14px ${FONT};color:#ffffff;text-decoration:none;border-radius:999px">${escapeHtml(page.button.label)}</a>
      </td></tr></table>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(page.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(page.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}">
<tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
    <tr><td style="padding:0 6px 16px">
      <a href="${site}" style="text-decoration:none;font:700 18px ${FONT};color:${INK};letter-spacing:-0.01em">
        <span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${BRAND};margin-right:8px"></span>${APP_NAME}
      </a>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:16px;padding:30px 30px 28px">
      ${page.label ? `<p style="margin:0 0 8px;font:600 11px ${FONT};letter-spacing:0.08em;text-transform:uppercase;color:${BRAND}">${escapeHtml(page.label)}</p>` : ""}
      <h1 style="margin:0;font:700 22px/1.3 ${FONT};color:${INK};letter-spacing:-0.01em">${escapeHtml(page.heading)}</h1>
      ${page.lead ? `<p style="margin:8px 0 0;font:400 14px/1.55 ${FONT};color:${MUTED}">${escapeHtml(page.lead)}</p>` : ""}
      ${page.bodyHtml ? `<div style="margin-top:22px;padding-top:20px;border-top:1px solid ${LINE};font:400 15px/1.62 ${FONT};color:${INK}">${page.bodyHtml}</div>` : ""}
      ${button}
    </td></tr>
    <tr><td style="padding:18px 8px 0;font:400 12px/1.6 ${FONT};color:${MUTED}">
      ${page.why ? `${escapeHtml(page.why)}<br>` : ""}
      You can choose which emails you get in ${APP_NAME}, under Notifications in your account menu.
      <br><a href="${site}" style="color:${MUTED}">${site.replace(/^https?:\/\//, "")}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** Plain paragraphs as HTML, for a short notice that has no formatting of its own. */
export const paragraphs = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

export const EMAIL_STYLE = { INK, MUTED, LINE, BRAND, PAPER, FONT };
