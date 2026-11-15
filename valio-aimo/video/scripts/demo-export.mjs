// Writes the demo's captions and script files from the narration's word times and the timeline.
//   node scripts/demo-export.mjs <out dir>    -> aimopilot-demo-10min.vtt, script.json, script.md
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { timeline } from "./demo-timeline.mjs";
const out = process.argv[2] ?? ".";
const { chapters, total } = timeline();
const F = 30;
const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(3).padStart(6, "0"); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${x}`; };
const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
// Spelled for the voice, written for the eye.
const eye = (t) => t
  .replace(/seventeen thousand, five hundred and forty-six/gi, "17,546")
  .replace(/a hundred and eighty-nine/gi, "189")
  .replace(/forty percent/gi, "40 percent")
  .replace(/seventy-two/gi, "72").replace(/ninety-seven/gi, "97")
  .replace(/thirteen scenarios/gi, "13 scenarios").replace(/nineteen MCP/gi, "19 MCP")
  .replace(/five hundred euro/gi, "500 euro").replace(/forty-five/gi, "45")
  .replace(/more than seventeen hundred/gi, "more than 1,700")
  .replace(/aimopilot dot zero anomaly dot tech/gi, "aimopilot.zeroanomaly.tech");
const cues = [];
for (const c of chapters) for (const p of c.parts) {
  const t0 = p.start / F;
  let cur = [];
  const flush = () => { if (cur.length) cues.push({ a: t0 + cur[0].s, b: t0 + cur.at(-1).e + 0.3, text: cur.map((x) => x.w).join(" ") }); cur = []; };
  for (const w of p.words) {
    cur.push(w);
    const long = cur.map((x) => x.w).join(" ").length > 70;
    if (/[.?!]$/.test(w.w) || (long && /[,:;]$/.test(w.w))) flush();
  }
  flush();
}
const vtt = ["WEBVTT", ""];
cues.forEach((c, i) => vtt.push(`${ts(c.a)} --> ${ts(Math.min(c.b, (cues[i + 1]?.a ?? Infinity) - 0.03))}`, eye(c.text), ""));
writeFileSync(join(out, "aimopilot-demo-10min.vtt"), vtt.join("\n"));
const words = chapters.reduce((n, c) => n + c.parts.reduce((m, p) => m + p.text.split(/\s+/).length, 0), 0);
const json = { total: { seconds: Math.round((total / F) * 10) / 10, words }, chapters: chapters.map((c) => ({ id: c.id, title: c.title, start: Math.round((c.start / F) * 10) / 10, end: Math.round((c.end / F) * 10) / 10, parts: c.parts.map((p) => ({ id: p.id, start: Math.round((p.start / F) * 10) / 10, seconds: Math.round((p.len / F) * 10) / 10, text: eye(p.text) })) })) };
writeFileSync(join(out, "script.json"), JSON.stringify(json, null, 2));
const md = [`# AimoPilot: the ten-minute demo, narration`, "", `Length ${mmss(total / F)}; ${words} words of narration. Times are where each chapter and paragraph starts in the video.`, ""];
for (const c of json.chapters) {
  md.push(`## ${c.id.slice(1)}. ${c.title} (${mmss(c.start)} to ${mmss(c.end)})`, "");
  for (const p of c.parts) md.push(`**${mmss(p.start)}** ${p.text}`, "");
}
writeFileSync(join(out, "script.md"), md.join("\n"));
console.log("total", mmss(total / F), words, "words,", cues.length, "captions");
