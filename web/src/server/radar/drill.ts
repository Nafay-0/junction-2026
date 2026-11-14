import type { DrillNotice } from "./store";

/**
 * The drill page: a recall list and notice pages that this project hosts itself, in the same layout and format as
 * the Finnish Food Authority's (the same CSS classes the radar's listing parser reads, the same labelled fields),
 * so a drill notice travels the same path as a real one: listing, notice page, reader, facts, matching, hold.
 *
 * Every page says HARJOITUS / DRILL / ÖVNING in its title, headline, banner and text, names no invented hazard as a
 * finding, and links back to the operations screen. A drill is never presented as a real recall.
 */

export const DRILL_MARK = /HARJOITUS|DRILL|ÖVNING/;

const FI_MONTHS = ["tammikuuta", "helmikuuta", "maaliskuuta", "huhtikuuta", "toukokuuta", "kesäkuuta", "heinäkuuta", "elokuuta", "syyskuuta", "lokakuuta", "marraskuuta", "joulukuuta"];

function fiDate(iso: string): string {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-").map(Number);
  return `${p[2]}. ${FI_MONTHS[p[1] - 1]} ${p[0]}`;
}

const shortDate = (isoDay: string) => `${Number(isoDay.slice(8, 10))}.${Number(isoDay.slice(5, 7))}.${isoDay.slice(0, 4)}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f4f1ea;color:#1d1d1b}
main{max-width:760px;margin:0 auto;padding:20px 16px 60px}.drill-banner{background:#ffd23f;color:#1d1d1b;border:3px solid #1d1d1b;padding:10px 14px;font-weight:700}
h1{font-size:1.7rem;line-height:1.2}ul.content-list-block{list-style:none;padding:0}.content-list-block__list-item{border-top:1px solid #c9c4b8;padding:12px 0}
.content-list-block__date{margin:0;color:#5b5a55;font-size:.9rem}.content-list-block__title{margin:2px 0 0;font-size:1.1rem}a{color:#1d1d1b}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px}dt{font-weight:700}
</style></head>
<body><main>
<p class="drill-banner">HARJOITUS / DRILL / ÖVNING – Tämä ei ole oikea takaisinveto. This is not a real recall. Detta är inte en verklig återkallelse. Sivu kuuluu AimoPilot-hackathon-demon tuotteisiin kohdistuvaan harjoitukseen.</p>
${body}
</main></body></html>`;
}

/** The drill's recall list, newest first, in the authority's listing layout. */
export function renderDrillListing(drills: DrillNotice[], base = "/ui-api/radar/drill"): string {
  const live = drills.filter((d) => !d.withdrawnAt).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const items = live
    .map(
      (d) => `<li class="content-list-block__list-item">
<p class="content-list-block__date">${fiDate(d.publishedAt)}</p>
<h3 class="content-list-block__title"><a class="content-list-block__link" href="${base}/${esc(d.slug)}">${esc(drillTitle(d))}</a></h3>
</li>`,
    )
    .join("\n");
  return page(
    "HARJOITUS: Takaisinvedot (drill) – AimoPilot",
    `<h1>HARJOITUS: Takaisinvedot</h1>
<p>Harjoitussivu. Dockin henkilökunta julkaisee tänne harjoitustiedotteita testatakseen, että takaisinvetotutka huomaa ne. Ei oikeita takaisinvetoja.</p>
<div class="content-list-block"><ul class="content-list-block">
${items || '<li class="drill-empty">Ei julkaistuja harjoitustiedotteita.</li>'}
</ul></div>`,
  );
}

export function drillTitle(d: DrillNotice): string {
  return `HARJOITUS: ${d.names.fi ?? d.productName} – mahdollisesti listeriaa (ei oikea takaisinveto)`;
}

/** One drill notice in the authority's notice format, with the labelled fields the radar's code reader knows. */
export function renderDrillNotice(d: DrillNotice): string {
  const name = d.names.fi ?? d.productName;
  const fields = [
    ["Tuote", name],
    ...(d.brand && d.brand !== "unknown" ? [["Tuotemerkki", d.brand]] : []),
    ...(d.vendor ? [["Valmistaja", d.vendor]] : []),
    ...(d.pack ? [["Pakkauskoko", d.pack]] : []),
    ...(d.ean ? [["EAN", d.ean]] : []),
    ["Parasta ennen", shortDate(d.bestBefore)],
  ];
  const withdrawn = d.withdrawnAt ? `<p class="drill-banner">HARJOITUS PÄÄTTYNYT: tämä harjoitustiedote on peruttu ${fiDate(d.withdrawnAt)}.</p>` : "";
  return page(
    `${drillTitle(d)} – AimoPilot`,
    `${withdrawn}<article>
<h1>${esc(drillTitle(d))}</h1>
<p class="content-list-block__date">${fiDate(d.publishedAt)}</p>
<p>HARJOITUS. Tämä on Dockin takaisinvetotutkan harjoitus, ei oikea takaisinveto. Harjoituksessa oletetaan, että tuotteessa ${esc(name)} on todettu listeriaa (Listeria monocytogenes).</p>
<p>Harjoituksen takaisinveto koskee tuotetta, jonka parasta ennen -päiväys on ${shortDate(d.bestBefore)}.</p>
<p>Harjoituksen takaisinvedettävä tuote:</p>
<ul>
${fields.map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join("\n")}
</ul>
<p>Harjoituksessa kuluttajia pyydetään palauttamaan tuote ostopaikkaan tai hävittämään se.</p>
<p>Harjoituksessa ammattikeittiöitä ja ravintoloita pyydetään poistamaan tuote käytöstä ja ilmoittamaan siitä tukkurille.</p>
<p>DRILL (English): this page is an exercise of AimoPilot's recall radar. It is not a real recall and states no real finding about this product.</p>
</article>`,
  );
}
