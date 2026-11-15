/** Rewrites clips/INDEX.md from the JSON beside each clip (plus the notes in clips/NOTES.md, kept by hand). */
import fs from "node:fs";
import path from "node:path";
import { CLIPS } from "./rec";

const ORDER = ["c02", "c01", "c03", "c04", "c06", "c07", "c08", "c05", "c00", "c10", "c09"];
const files = fs.readdirSync(CLIPS).filter((f) => f.endsWith(".json"));
const rows = files
  .map((f) => ({ id: f.replace(/\.json$/, ""), ...(JSON.parse(fs.readFileSync(path.join(CLIPS, f), "utf8")) as { chapter: string; what: string; seconds: number; notes?: string; events: { t: number; name: string }[] }) }))
  .filter((r) => fs.existsSync(path.join(CLIPS, `${r.id}.mp4`)))
  .sort((a, b) => a.chapter.localeCompare(b.chapter) || a.id.localeCompare(b.id));
const notes = fs.existsSync(path.join(CLIPS, "NOTES.md")) ? fs.readFileSync(path.join(CLIPS, "NOTES.md"), "utf8") : "";
const total = rows.reduce((s, r) => s + r.seconds, 0);
let md = `# Clips for the AimoPilot demo video

Written by the capture session (scripts in \`valio-aimo/web/scripts/demo-video/\` on branch \`claude/demo-capture\`).
${rows.length} clips, ${(total / 60).toFixed(1)} minutes in all. Delivery order of chapters: ${ORDER.join(", ")}.

## How these were recorded

- Real Chromium (Playwright's \`chromium\` channel, headless) driven by script, so every take can be repeated. Desktop
  viewport 1280 x 720 CSS px rendered at device scale 1.5 (\`--force-device-scale-factor=1.5\`), so the product's
  layout is a normal laptop's and every frame is a sharp 1920 x 1080. Phone: 390 x 844 CSS px at 1.5.
- Frames come from the DevTools screencast (JPEG q92, about 40-45 frames a second while the page changes), with
  their own timestamps, then resampled to a constant 30 fps and encoded with ffmpeg (libx264, CRF 17, no audio).
  Playwright's own recordVideo was not used (soft, 1x).
- Waits on the agent or the network are compressed: a wait longer than 1.2 s keeps its first 0.55 s and last 0.4 s
  at real speed and runs the middle fast in 0.25 s, so the working line is seen but never sat through. Event times in
  each JSON are in the clip's own (compressed) time.
- A drawn pointer follows the real mouse (ripple on press); typing goes key by key at a human pace; scrolling is
  animated. The local server ran a production build with every hosted service blanked and its clock starting at
  Sunday 15 Nov 10:30 Helsinki (the browser shows the same clock), the real catalogue and the partner's live price API.
- Phone clips (layout "desk+phone"): the desk on the left (1400 px wide), the phone on the right (1000 px tall), on a
  quiet grey. A virtual authenticator stands in for Face ID.
- Redaction: one-time sign-in addresses (they carry a token) are blurred on screen. Nothing from \`.env.local\` is
  shown; e-mail addresses on screen are made-up or \`delivered@resend.dev\`.

## Clips

| clip | chapter | seconds | what it shows |
|---|---|---:|---|
${rows.map((r) => `| \`${r.id}.mp4\` | ${r.chapter} | ${r.seconds.toFixed(1)} | ${r.what}${r.notes ? ` **Note:** ${r.notes}` : ""} |`).join("\n")}

Contact sheets (12 frames each): \`sheets/<clip>.jpg\`.
`;
if (notes.trim()) md += `\n## Notes, oddities and product bugs seen\n\n${notes.trim()}\n`;
fs.writeFileSync(path.join(CLIPS, "INDEX.md"), md);
console.log(`INDEX.md: ${rows.length} clips, ${total.toFixed(0)} s`);
