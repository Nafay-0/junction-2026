// Writes the film's captions (WebVTT) from the narration's word timings: one cue per sentence.
// node scripts/captions.mjs > ../web/public/landing/film.vtt
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "src/extra.json"), "utf8"));
const vo = JSON.parse(readFileSync(join(root, "src/vo.json"), "utf8"));
const ids = Object.keys(cfg.extra);
const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(3).padStart(6, "0"); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${x}`; };
let start = 0;
const cues = [];
for (const [i, id] of ids.entries()) {
  const t0 = (start + cfg.lead) / 30;
  let cur = [];
  for (const w of vo[id].words) {
    cur.push(w);
    if (/[.?!:]$/.test(w.w)) { cues.push({ a: t0 + cur[0].s, b: t0 + cur.at(-1).e + 0.3, text: cur.map((x) => x.w).join(" ") }); cur = []; }
  }
  if (cur.length) cues.push({ a: t0 + cur[0].s, b: t0 + cur.at(-1).e + 0.3, text: cur.map((x) => x.w).join(" ") });
  start += cfg.lead + Math.ceil(vo[id].seconds * 30) + cfg.tail + cfg.extra[id] - (cfg.into[ids[i + 1]] ?? 0);
}
const out = ["WEBVTT", ""];
// Spelled for the voice, written for the eye.
const eye = (t) => t.replace(/twenty twenty-six/gi, "2026");
cues.forEach((c, i) => out.push(`${ts(c.a)} --> ${ts(Math.min(c.b, (cues[i + 1]?.a ?? Infinity) - 0.03))}`, eye(c.text), ""));
console.log(out.join("\n"));
