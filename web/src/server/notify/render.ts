import { dayL, measureL, roleLabelL, ruleTitleL } from "@/app/_i18n/format";
import { agentNameL, placeNameL } from "@/app/_i18n/kitchen-words";
import { clock, fiMoney, money, num } from "@/app/_ui/plain";
import { MAIL_TEXT } from "./mail.text";
import type { ChangedModel, ConfirmModel, MailModel, ReceiptModel, RenderContext, RenderedMail, SignOffModel } from "./model";

/**
 * The kitchen's emails as HTML and plain text. Pure: the same model and context give the same mail, so the operations
 * page renders a sent mail again instead of storing its body.
 *
 * Built for mail clients, not browsers: tables for layout, every style inline (a <style> block only adds the
 * narrow-screen and dark-mode touches that clients which read it apply), system fonts with a fallback stack, 600 px
 * wide and fluid below 620 px, a hidden preheader, no images (nothing needs one to be understood). Petrol #005670 on
 * white; the lime #c0e021 appears once, as the thin bar on top of the card. Numbers right-aligned in tabular figures,
 * written the Finnish way in all three languages.
 */

const C = { petrol: "#005670", petrolDeep: "#003f52", ink: "#17262c", soft: "#56676d", line: "#dfe6e8", bg: "#f2f5f6", card: "#ffffff", tint: "#eaf2f4", lime: "#c0e021", warn: "#8a4b00", warnTint: "#fff5e6" };
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const NUM = "font-variant-numeric:tabular-nums;-moz-font-feature-settings:'tnum';font-feature-settings:'tnum';";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

type Lang = RenderContext["lang"];

// ---------- formats (Finnish conventions in every language) ----------

const year = (iso: string) => iso.slice(0, 4);
/** "ma 16.11.2026" */
export const dateL = (isoDate: string, lang: Lang) => `${dayL(isoDate, lang)}${year(isoDate)}`;
/** "16.11.2026 klo 14.05" in Helsinki time. */
export function dateTimeL(iso: string, lang: Lang): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const [y, m, dd] = d.split("-");
  const at = lang === "fi" ? "klo " : lang === "sv" ? "kl. " : "";
  return `${Number(dd)}.${Number(m)}.${y} ${at}${clock(iso)}`;
}
const pct = (n: number) => `${num(n, 1)} %`;
const days = (ds: string[], lang: Lang) => [...new Set(ds)].sort().map((d) => dateL(d, lang)).join(", ");

// ---------- building blocks ----------

const td = (style: string, inner: string, attrs = "") => `<td ${attrs} style="${style}">${inner}</td>`;

function heading(text: string): string {
  return `<h1 class="ink" style="margin:0 0 12px 0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;color:${C.ink};">${esc(text)}</h1>`;
}

function para(text: string, opts: { soft?: boolean; size?: number; strong?: boolean; mb?: number } = {}): string {
  const size = opts.size ?? 16;
  return `<p class="${opts.soft ? "soft" : "ink"}" style="margin:0 0 ${opts.mb ?? 14}px 0;font-family:${FONT};font-size:${size}px;line-height:${Math.round(size * 1.5)}px;color:${opts.soft ? C.soft : C.ink};${opts.strong ? "font-weight:600;" : ""}">${esc(text)}</p>`;
}

function label(text: string): string {
  return `<p class="soft" style="margin:22px 0 8px 0;font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;color:${C.soft};">${esc(text)}</p>`;
}

function facts(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:4px 0 8px 0;">${rows
    .map(([k, v], i) => `<tr>${td(`padding:8px 12px 8px 0;${i ? `border-top:1px solid ${C.line};` : ""}font-family:${FONT};font-size:14px;line-height:20px;color:${C.soft};vertical-align:top;`, esc(k), 'class="soft line" width="42%"')}${td(`padding:8px 0;${i ? `border-top:1px solid ${C.line};` : ""}font-family:${FONT};font-size:14px;line-height:20px;color:${C.ink};text-align:right;vertical-align:top;${NUM}`, esc(v), 'class="ink line" align="right"')}</tr>`)
    .join("")}</table>`;
}

function note(text: string, tone: "petrol" | "warn" = "petrol"): string {
  const bg = tone === "warn" ? C.warnTint : C.tint;
  const fg = tone === "warn" ? C.warn : C.petrolDeep;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:18px 0;"><tr>${td(`padding:14px 16px;background:${bg};border-radius:8px;font-family:${FONT};font-size:15px;line-height:22px;color:${fg};font-weight:600;`, esc(text), `class="tint" bgcolor="${bg}"`)}</tr></table>`;
}

function button(text: string, href: string, kind: "primary" | "secondary" = "primary"): string {
  const primary = kind === "primary";
  const bg = primary ? C.petrol : C.card;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 8px 6px 0;display:inline-table;"><tr>${td(
    `border-radius:8px;background:${bg};`,
    `<a href="${esc(href)}" class="${primary ? "btn" : "petrol"}" style="display:inline-block;padding:12px 20px;border:1px solid ${C.petrol};border-radius:8px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${primary ? "#ffffff" : C.petrol};text-decoration:none;">${esc(text)}</a>`,
    `class="${primary ? "btn" : "btn2"}" bgcolor="${bg}"`,
  )}</tr></table>`;
}

function bullets(items: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 8px 0;">${items
    .map((t) => `<tr>${td(`width:18px;padding:3px 0;vertical-align:top;font-family:${FONT};font-size:15px;line-height:22px;color:${C.petrol};`, "&#8226;", 'class="petrol"')}${td(`padding:3px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.ink};`, t, 'class="ink"')}</tr>`)
    .join("")}</table>`;
}

/** Product lines: the name and how many at what price on the left, the line total on the right (reads at 360 px). */
function lineRows(rows: { name: string; sub: string[]; total: string }[], head: [string, string]): string {
  const th = (t: string, right = false) => td(`padding:0 0 8px 0;border-bottom:2px solid ${C.ink};font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;color:${C.soft};${right ? "text-align:right;" : ""}`, esc(t), `class="soft" ${right ? 'align="right"' : ""}`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:4px 0 0 0;"><tr>${th(head[0])}${th(head[1], true)}</tr>${rows
    .map(
      (r) =>
        `<tr>${td(`padding:12px 12px 12px 0;border-bottom:1px solid ${C.line};vertical-align:top;font-family:${FONT};`, `<p class="ink" style="margin:0;font-size:15px;line-height:21px;font-weight:600;color:${C.ink};">${esc(r.name)}</p>${r.sub.map((s) => `<p class="soft" style="margin:2px 0 0 0;font-size:13px;line-height:19px;color:${C.soft};${NUM}">${esc(s)}</p>`).join("")}`, 'class="line"')}${td(`padding:12px 0;border-bottom:1px solid ${C.line};vertical-align:top;text-align:right;white-space:nowrap;font-family:${FONT};font-size:15px;line-height:21px;font-weight:600;color:${C.ink};${NUM}`, esc(r.total), 'class="ink line" align="right"')}</tr>`,
    )
    .join("")}</table>`;
}

function sums(rows: { label: string; value: string; strong?: boolean; soft?: boolean }[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:6px 0 0 0;">${rows
    .map((r) => {
      const size = r.strong ? 17 : 14;
      const top = r.strong ? `border-top:2px solid ${C.ink};padding-top:12px;` : "padding-top:6px;";
      const color = r.soft ? C.soft : C.ink;
      return `<tr>${td(`${top}padding-bottom:6px;padding-right:12px;font-family:${FONT};font-size:${size}px;line-height:${size + 7}px;color:${color};${r.strong ? "font-weight:700;" : ""}`, esc(r.label), `class="${r.soft ? "soft" : "ink"}"`)}${td(`${top}padding-bottom:6px;text-align:right;white-space:nowrap;font-family:${FONT};font-size:${size}px;line-height:${size + 7}px;color:${color};${r.strong ? "font-weight:700;" : ""}${NUM}`, esc(r.value), `class="${r.soft ? "soft" : "ink"}" align="right"`)}</tr>`;
    })
    .join("")}</table>`;
}

function shell(lang: Lang, subject: string, preheader: string, kitchen: string, body: string, ctx: RenderContext): string {
  const t = MAIL_TEXT[lang];
  const foot = [
    esc(t.why(kitchen, ctx.maskedTo)),
    ctx.stopUrl ? `<a href="${esc(ctx.stopUrl)}" class="petrol" style="color:${C.petrol};text-decoration:underline;">${esc(t.stop)}</a> &nbsp;·&nbsp; <a href="${esc(ctx.settingsUrl)}" class="petrol" style="color:${C.petrol};text-decoration:underline;">${esc(t.change)}</a>` : "",
    esc(t.demo),
  ].filter(Boolean);
  // The preheader: the inbox's second line, then padding so the client does not pull body text in after it.
  const pad = "&#847;&zwnj;&nbsp;".repeat(60);
  return `<!doctype html>
<html lang="${lang === "sv" ? "sv-FI" : lang === "fi" ? "fi-FI" : "en-GB"}" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,p,a,h1{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0;padding:0;width:100% !important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
a{color:${C.petrol};}
@media screen and (max-width:620px){
  .container{width:100% !important;}
  .px{padding-left:20px !important;padding-right:20px !important;}
  .outer{padding:12px 8px !important;}
}
@media (prefers-color-scheme:dark){
  .bg{background:#0e181c !important;}
  .card{background:#15232a !important;border-left-color:#26383f !important;border-right-color:#26383f !important;border-bottom-color:#26383f !important;}
  .ink{color:#e6eef0 !important;}
  .soft{color:#a3b5bb !important;}
  .line{border-color:#2a3e45 !important;}
  .petrol{color:#7cc6da !important;}
  .tint{background:#1b3640 !important;color:#cfe9f0 !important;}
  .btn{background:#0a7290 !important;border-color:#0a7290 !important;color:#ffffff !important;}
  .btn2{background:transparent !important;}
  .brand{color:#7cc6da !important;}
}
[data-ogsc] .ink{color:#e6eef0 !important;}
[data-ogsc] .soft{color:#a3b5bb !important;}
[data-ogsc] .petrol,[data-ogsc] .brand{color:#7cc6da !important;}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${C.bg};">${esc(preheader)}${pad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${C.bg}" style="width:100%;background:${C.bg};">
<tr><td align="center" class="outer" style="padding:28px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="container" style="width:600px;max-width:600px;">
<tr><td class="px" style="padding:0 32px 14px 32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>
    ${td(`font-family:${FONT};font-size:20px;line-height:26px;font-weight:700;color:${C.petrol};letter-spacing:-0.01em;`, "AimoPilot", 'class="brand"')}
    ${td(`font-family:${FONT};font-size:13px;line-height:18px;color:${C.soft};text-align:right;`, esc(kitchen), 'class="soft" align="right"')}
  </tr></table>
</td></tr>
<tr><td class="card" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-top:4px solid ${C.lime};border-radius:12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td class="px" style="padding:30px 32px 26px 32px;">
${body}
  </td></tr></table>
</td></tr>
<tr><td class="px" style="padding:18px 32px 8px 32px;">
${foot.map((f) => `<p class="soft" style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.soft};">${f}</p>`).join("\n")}
<p class="soft" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.soft};">AimoPilot · ${esc(t.brandLine)}</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/** The plain-text alternative: the same content, wrapped by the client. */
function plain(parts: (string | false | undefined | null)[], ctx: RenderContext, kitchen: string): string {
  const t = MAIL_TEXT[ctx.lang];
  const body = parts.filter((x): x is string => typeof x === "string").join("\n");
  const foot = [t.why(kitchen, ctx.maskedTo), ctx.stopUrl ? `${t.stop}: ${ctx.stopUrl}` : "", ctx.stopUrl ? `${t.change}: ${ctx.settingsUrl}` : "", t.demo].filter(Boolean).join("\n");
  return `AimoPilot\n\n${body}\n\n--\n${foot}\n`.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n");
}

/** The watch's reason for a substitute, cut to its first two figures (price per litre or kilo, packs). */
const shortWhy = (why: string) => why.split(/;\s*/).slice(0, 2).join("; ");

const rule = (s = "") => s || "----------------------------------------";

// ---------- the mails ----------

function receipt(m: ReceiptModel, ctx: RenderContext): RenderedMail {
  const { lang } = ctx;
  const t = MAIL_TEXT[lang];
  const delivery = days(m.deliveryDates, lang);
  const firstDay = m.deliveryDates.slice().sort()[0] ?? "";
  const subject = t.receiptSubject(m.orderId, money(m.totalCents), firstDay ? dateL(firstDay, lang) : "");
  const preheader = t.receiptPre(m.lines.length, delivery);
  const first = t.receiptFirst(placeNameL(m.kitchen.name, ctx.lang), m.orderId, delivery);
  const decided = m.decidedBy.kind === "agent" ? t.byAgent(agentNameL(m.decidedBy.agentName, lang), money(m.decidedBy.limitCents)) : t.byPerson(m.decidedBy.name, roleLabelL(m.decidedBy.role, lang), dateTimeL(m.decidedBy.at, lang));
  const rows = m.lines.map((l) => ({
    name: l.name,
    sub: [
      t.packs(num(l.quantity, 0), measureL(l.packSize, l.unit, lang), money(l.unitPriceCents)),
      ...(l.insteadOf ? [t.insteadOf(l.insteadOf)] : []),
      ...(l.depositCents ? [t.depositLine(money(l.depositCents))] : []),
      ...(m.deliveryDates.length > 1 ? [`${t.factDelivery}: ${dateL(l.deliveryDate, lang)}`] : []),
    ],
    total: money(l.lineTotalCents),
  }));
  const vatRows = m.vat.byRate.map((v) => (v.ratePct === null || v.vatCents === null ? { label: t.vatUnknown(money(v.baseCents)), value: "–", soft: true } : { label: t.vatAt(pct(v.ratePct), money(v.baseCents)), value: money(v.vatCents) }));
  // With a VAT rate unknown the total before VAT is the last word (the invoice adds the rest); otherwise the total with VAT.
  const sumRows: { label: string; value: string; strong?: boolean; soft?: boolean }[] = [
    ...(m.depositCents ? [{ label: t.goods, value: money(m.goodsCents) }, { label: t.deposits, value: money(m.depositCents) }] : []),
    ...(m.vat.incomplete ? [] : [{ label: t.totalExcl, value: money(m.totalCents) }]),
    ...vatRows,
    m.vat.incomplete ? { label: t.totalExcl, value: money(m.totalCents), strong: true } : { label: t.totalIncl, value: money(m.totalWithVatCents), strong: true },
  ];
  const factRows: [string, string][] = [
    [t.factOrder, m.orderId],
    [t.factKitchen, placeNameL(m.kitchen.name, ctx.lang)],
    [t.factPlaced, dateTimeL(m.committedAt, lang)],
    [t.factDelivery, delivery],
  ];
  const html = [
    heading(t.receiptTitle),
    para(first),
    para(decided, { soft: true, size: 15 }),
    m.decidedBy.kind === "person" && !m.decidedBy.verified ? para(t.unverified, { soft: true, size: 13 }) : "",
    facts(factRows),
    lineRows(rows, [t.colProduct, t.colTotal]),
    sums(sumRows),
    note(t.hiccups),
    `<div style="margin:4px 0 6px 0;">${button(t.openOrder, m.links.order)}${button(t.verify, m.links.verify, "secondary")}</div>`,
    m.fingerprint ? `<p class="soft" style="margin:14px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.soft};">${esc(t.signedNote(m.fingerprint))} <a href="${esc(m.links.keys)}" class="petrol" style="color:${C.petrol};">${esc(t.keys)}</a>.</p>` : "",
  ].join("\n");
  const text = plain(
    [
      t.receiptTitle.toUpperCase(),
      "",
      first,
      decided,
      "",
      ...factRows.map(([k, v]) => `${k}: ${v}`),
      "",
      rule(),
      ...m.lines.flatMap((l, i) => [`${l.name}`, `  ${rows[i].sub.join(" · ")}`, `  = ${money(l.lineTotalCents)}`]),
      rule(),
      ...sumRows.map((r) => `${r.label}: ${r.value}`),
      "",
      t.hiccups,
      "",
      `${t.openOrder}: ${m.links.order}`,
      `${t.verify}: ${m.links.verify}`,
      m.fingerprint ? `${t.signedNote(m.fingerprint)} ${m.links.keys}` : null,
    ],
    ctx,
    placeNameL(m.kitchen.name, ctx.lang),
  );
  return { subject, preheader, html: shell(lang, subject, preheader, placeNameL(m.kitchen.name, ctx.lang), html, ctx), text };
}

function signOff(m: SignOffModel, ctx: RenderContext): RenderedMail {
  const { lang } = ctx;
  const t = MAIL_TEXT[lang];
  const subject = t.signOffSubject(m.approver.name, m.orderId, money(m.totalCents));
  const preheader = t.signOffPre(m.approver.name, money(m.totalCents));
  const first = t.signOffFirst(agentNameL(m.agentName, lang), money(m.totalCents), placeNameL(m.kitchen.name, ctx.lang), m.approver.name);
  const reasons = m.reasons.map((r) => `${ruleTitleL(r.rule, lang)}: ${fiMoney(r.reason)}`);
  const rows = m.lines.map((l) => ({ name: l.name, sub: [`${num(l.quantity, 0)} × ${measureL(l.packSize, l.unit, lang)}`, ...(l.insteadOf ? [t.insteadOf(l.insteadOf)] : [])], total: money(l.lineTotalCents) }));
  const html = [
    heading(t.signOffTitle),
    para(first),
    para(t.signOffWho(m.approver.name, roleLabelL(m.approver.role, lang)), { soft: true, size: 15 }),
    label(t.whyPerson),
    bullets(reasons.map(esc)),
    facts([
      [t.factOrder, m.orderId],
      [t.factDelivery, days(m.deliveryDates, lang)],
    ]),
    lineRows(rows, [t.colProduct, t.colTotal]),
    sums([{ label: t.totalExcl, value: money(m.totalCents), strong: true }]),
    m.holdsUntil ? note(t.holdsUntil(dateTimeL(m.holdsUntil, lang))) : "",
    `<div style="margin:4px 0 0 0;">${button(t.openIt, m.links.order)}</div>`,
  ].join("\n");
  const text = plain(
    [t.signOffTitle.toUpperCase(), "", first, t.signOffWho(m.approver.name, roleLabelL(m.approver.role, lang)), "", `${t.whyPerson}:`, ...reasons.map((r) => `- ${r}`), "", `${t.factOrder}: ${m.orderId}`, `${t.factDelivery}: ${days(m.deliveryDates, lang)}`, rule(), ...rows.map((r) => `${r.name} (${r.sub.join(", ")}): ${r.total}`), rule(), `${t.totalExcl}: ${money(m.totalCents)}`, m.holdsUntil ? `\n${t.holdsUntil(dateTimeL(m.holdsUntil, lang))}` : null, "", `${t.openIt}: ${m.links.order}`],
    ctx,
    placeNameL(m.kitchen.name, ctx.lang),
  );
  return { subject, preheader, html: shell(lang, subject, preheader, placeNameL(m.kitchen.name, ctx.lang), html, ctx), text };
}

function changed(m: ChangedModel, ctx: RenderContext): RenderedMail {
  const { lang } = ctx;
  const t = MAIL_TEXT[lang];
  const day = m.date ? dateL(m.date, lang) : "";
  const total = m.totalCents !== undefined ? money(m.totalCents) : "";
  const amount = (n: number, unit: string) => measureL(n, unit, lang);
  let subject = "";
  let preheader = "";
  let title = "";
  let first = "";
  const happened: string[] = [];
  const did: string[] = [];
  const you: string[] = [];
  const figures: [string, string][] = [];
  let subs: string[] = [];
  switch (m.change) {
    case "cannot_come": {
      const name = m.product?.name ?? "";
      subject = t.cannotSubject(name, day);
      preheader = t.cannotPre(!!m.substitutes?.length);
      title = t.cannotTitle;
      first = t.cannotFirst(name, t.cannotWhat(m.source ?? "order", m.orderId), day);
      happened.push(t.cannotWhy(m.reasonCode ?? "not_orderable", m.backOn ? dateL(m.backOn, lang) : null));
      did.push(t.cannotDid);
      you.push(t.cannotYou);
      if (m.product?.amount !== undefined && m.product.unit) figures.push([t.factDelivery, `${day} · ${amount(m.product.amount, m.product.unit)}`]);
      subs = (m.substitutes ?? []).slice(0, 3).map((s) => `<strong>${esc(t.rank[s.rank])}:</strong> ${esc(s.name)}<br><span class="soft" style="color:${C.soft};font-size:13px;">${esc(shortWhy(s.why))} · ${esc(s.insidePreferences ? t.inside : t.outside)}</span>`);
      if (!m.substitutes?.length) did.push(t.noSubstitute);
      break;
    }
    case "substituted": {
      const usual = m.product?.name ?? "";
      const sub = m.substitute?.name ?? "";
      subject = t.subSubject(sub, day);
      preheader = t.subPre(usual);
      title = t.subTitle;
      first = t.subFirst(usual, day, sub);
      did.push(m.substitute?.insidePreferences ? t.subAlone : t.subWaits(m.outcome?.approver ?? "–"));
      you.push(t.subYou);
      if (m.outcome?.totalCents !== undefined) figures.push([t.totalExcl, money(m.outcome.totalCents)]);
      if (m.orderId) figures.unshift([t.factOrder, m.orderId]);
      break;
    }
    case "renewal_held": {
      const what = m.product?.name ?? "";
      subject = t.heldSubject(what, day);
      preheader = t.heldPre;
      title = t.heldTitle;
      first = t.heldFirst(what, day);
      if (m.reason) happened.push(m.reason);
      if (m.amounts) happened.push(t.heldAmounts(amount(m.amounts.usual, m.amounts.unit), amount(m.amounts.latest, m.amounts.unit)));
      did.push(t.heldDid);
      you.push(t.heldYou);
      break;
    }
    case "refused": {
      const ruleName = ruleTitleL(m.reasonCode, lang);
      subject = t.refusedSubject(total);
      preheader = t.refusedPre;
      title = t.refusedTitle;
      first = t.refusedFirst(total, placeNameL(m.kitchen.name, ctx.lang), ruleName);
      if (m.reason) happened.push(m.reason);
      did.push(t.refusedDid);
      you.push(t.refusedYou);
      break;
    }
    case "declined": {
      subject = t.declinedSubject(m.orderId ?? "");
      preheader = t.declinedPre(m.by ?? "–");
      title = t.declinedTitle;
      first = t.declinedFirst(m.by ?? "–", m.orderId ?? "", total);
      if (m.reason) happened.push(m.reason);
      did.push(t.noneOrdered);
      break;
    }
    case "expired": {
      subject = t.expiredSubject(m.orderId ?? "");
      preheader = t.expiredPre;
      title = t.expiredTitle;
      first = t.expiredFirst(m.orderId ?? "", total);
      did.push(t.noneOrdered);
      break;
    }
    case "withdrawn": {
      subject = t.withdrawnSubject(m.orderId ?? "");
      preheader = t.withdrawnPre;
      title = t.withdrawnTitle;
      first = t.withdrawnFirst(m.orderId ?? "", total, m.by);
      if (m.reason) happened.push(m.reason);
      did.push(t.noneOrdered);
      break;
    }
  }
  const link = m.links.order ?? m.links.store;
  // The system's own sentences arrive as written (a buyer's note may start in lower case).
  for (let i = 0; i < happened.length; i++) happened[i] = fiMoney(happened[i].charAt(0).toUpperCase() + happened[i].slice(1));
  const html = [
    heading(title),
    para(first),
    happened.length ? label(t.whatHappened) + happened.map((h) => para(h, { size: 15 })).join("") : "",
    did.length ? label(t.whatWeDid) + did.map((h) => para(h, { size: 15 })).join("") : "",
    figures.length ? label(t.figures) + facts(figures) : "",
    subs.length ? label(t.whatYouCan) + bullets(subs) : "",
    you.length ? note(you.join(" ")) : "",
    m.staged ? para(t.staged, { soft: true, size: 13 }) : "",
    `<div style="margin:4px 0 0 0;">${button(m.links.order ? t.openOrder : t.openStore, link)}</div>`,
  ].join("\n");
  const text = plain(
    [
      title.toUpperCase(),
      "",
      first,
      ...(happened.length ? ["", `${t.whatHappened}:`, ...happened] : []),
      ...(did.length ? ["", `${t.whatWeDid}:`, ...did] : []),
      ...(m.substitutes?.length ? m.substitutes.slice(0, 3).map((s) => `- ${t.rank[s.rank]}: ${s.name} (${shortWhy(s.why)}; ${s.insidePreferences ? t.inside : t.outside})`) : []),
      ...(figures.length ? ["", ...figures.map(([k, v]) => `${k}: ${v}`)] : []),
      ...(you.length ? ["", `${t.whatYouCan}: ${you.join(" ")}`] : []),
      m.staged ? `\n${t.staged}` : null,
      "",
      `${m.links.order ? t.openOrder : t.openStore}: ${link}`,
    ],
    ctx,
    placeNameL(m.kitchen.name, ctx.lang),
  );
  return { subject, preheader, html: shell(lang, subject, preheader, placeNameL(m.kitchen.name, ctx.lang), html, ctx), text };
}

function confirm(m: ConfirmModel, ctx: RenderContext): RenderedMail {
  const t = MAIL_TEXT[ctx.lang];
  const subject = t.confirmSubject;
  const preheader = t.confirmPre(placeNameL(m.kitchen.name, ctx.lang));
  const html = [heading(t.confirmTitle), para(t.confirmFirst(placeNameL(m.kitchen.name, ctx.lang))), `<div style="margin:8px 0 14px 0;">${button(t.confirmButton, m.links.confirm)}</div>`, para(t.confirmHours(m.hours), { soft: true, size: 14 }), para(t.confirmIgnore, { soft: true, size: 14 })].join("\n");
  const text = plain([t.confirmTitle.toUpperCase(), "", t.confirmFirst(placeNameL(m.kitchen.name, ctx.lang)), "", `${t.confirmButton}: ${m.links.confirm}`, "", t.confirmHours(m.hours), t.confirmIgnore], { ...ctx, stopUrl: undefined }, placeNameL(m.kitchen.name, ctx.lang));
  return { subject, preheader, html: shell(ctx.lang, subject, preheader, placeNameL(m.kitchen.name, ctx.lang), html, { ...ctx, stopUrl: undefined }), text };
}

export function renderMail(m: MailModel, ctx: RenderContext): RenderedMail {
  switch (m.kind) {
    case "receipt":
      return receipt(m, ctx);
    case "sign_off":
      return signOff(m, ctx);
    case "changed":
      return changed(m, ctx);
    case "confirm":
      return confirm(m, ctx);
  }
}
