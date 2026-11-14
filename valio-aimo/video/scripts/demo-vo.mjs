// Records the ten-minute demo's narration: one clip per paragraph of src/demo/script.json, with word timings.
//   node scripts/demo-vo.mjs                  every part (c00-1, c01-1, ...)
//   node scripts/demo-vo.mjs c02 c03-2        only those chapters or parts
//   node scripts/demo-vo.mjs --post           no recording: rebuild clips and timings from the raw takes
//   DEMO_VOICE=<id> DEMO_OUT=<dir> node scripts/demo-vo.mjs c00   a tryout with another voice into <dir> (raw takes only)
// The voice and its settings are one file, src/demo/voice.json: change "voice" there and run this again to re-record
// every chapter with another voice. A part's seed can be set in voice.json "seeds" to re-take an odd one.
// Writes public/demo-vo/raw/<part>.mp3 + .json (the take as recorded), public/demo-vo/<part>.mp3 (pauses tightened,
// at "tempo" with pitch kept, levelled) and src/demo/vo.json (per part: seconds and word times at that tempo).
// The key is read from the git-ignored web/.env.local and never printed.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, "../web/.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const key = process.env.ELEVENLABS_API_KEY;
const postOnly = process.argv.includes("--post");
if (!key && !postOnly) throw new Error("ELEVENLABS_API_KEY is not set (web/.env.local)");

const cfg = JSON.parse(readFileSync(join(root, "src/demo/voice.json"), "utf8"));
const VOICE = process.env.DEMO_VOICE ?? cfg.voice;
const TEMPO = Number(cfg.tempo ?? 1);
const SETTINGS = { stability: cfg.stability, similarity_boost: cfg.similarity ?? 0.8, style: cfg.style, speed: 1, use_speaker_boost: true };
const tryout = process.env.DEMO_OUT;
const rawDir = tryout ? (isAbsolute(tryout) ? tryout : join(root, tryout)) : join(root, "public/demo-vo/raw");
mkdirSync(rawDir, { recursive: true });
mkdirSync(join(root, "public/demo-vo"), { recursive: true });

const script = JSON.parse(readFileSync(join(root, "src/demo/script.json"), "utf8"));
const parts = script.flatMap((c) => c.parts.map((text, i) => ({ id: `${c.id}-${i + 1}`, chapter: c.id, text })));
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wanted = (p) => !only.length || only.includes(p.id) || only.includes(p.chapter);

function words(al, scale) {
  const out = [];
  let cur = null;
  let inTag = false;
  al.characters.forEach((ch, i) => {
    if (ch === "[") inTag = true;
    if (inTag) {
      if (ch === "]") inTag = false;
      return;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur), (cur = null);
      return;
    }
    if (!cur) cur = { w: "", s: al.character_start_times_seconds[i], e: 0 };
    cur.w += ch;
    cur.e = al.character_end_times_seconds[i];
  });
  if (cur) out.push(cur);
  return out.map((x) => ({ w: x.w, s: Math.round((x.s / scale) * 1000) / 1000, e: Math.round((x.e / scale) * 1000) / 1000 }));
}

// Silences longer than PAUSE_OVER keep PAUSE_KEEP (half each side): an editor's tightening, not a jump cut.
const PAUSE_OVER = 0.42;
const PAUSE_KEEP = 0.34;
function cuts(file) {
  const log = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=-36dB:d=${PAUSE_OVER}`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.flatMap((a, i) => (ends[i] !== undefined && a > 0.05 && ends[i] - a > PAUSE_KEEP + 0.02 ? [[a + PAUSE_KEEP / 2, ends[i] - PAUSE_KEEP / 2]] : []));
}

function finalize(id) {
  const rawFile = join(rawDir, `${id}.mp3`);
  const raw = JSON.parse(readFileSync(join(rawDir, `${id}.json`), "utf8"));
  const removed = cuts(rawFile);
  const dur = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", rawFile], { encoding: "utf8" }).stdout);
  const keep = [];
  let at = 0;
  for (const [a, b] of removed) keep.push([at, a]), (at = b);
  keep.push([at, dur]);
  const F = 0.008;
  const segs = keep.map(([a, b], i) => `[0:a]atrim=${a.toFixed(4)}:${b.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:d=${F},afade=t=out:st=${Math.max(0, b - a - F).toFixed(4)}:d=${F}[p${i}]`);
  const tempo = TEMPO === 1 ? "" : `,atempo=${TEMPO}`;
  const graph = `${segs.join(";")};${keep.map((_, i) => `[p${i}]`).join("")}concat=n=${keep.length}:v=0:a=1${tempo},loudnorm=I=-17:TP=-1.5:LRA=11[out]`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", rawFile, "-filter_complex", graph, "-map", "[out]", "-ar", "48000", "-b:a", "192k", join(root, "public/demo-vo", `${id}.mp3`)]);
  const shift = (t) => t - removed.reduce((s, [a, b]) => s + Math.max(0, Math.min(t, b) - a), 0);
  const al = raw.alignment;
  const moved = { characters: al.characters, character_start_times_seconds: al.character_start_times_seconds.map(shift), character_end_times_seconds: al.character_end_times_seconds.map(shift) };
  const ws = words(moved, TEMPO);
  const out = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(root, "public/demo-vo", `${id}.mp3`)], { encoding: "utf8" }).stdout);
  return { seconds: Math.round(Math.max(out, ws.at(-1).e) * 1000) / 1000, speechEnd: ws.at(-1).e, words: ws, tightened: Math.round(removed.reduce((s, [a, b]) => s + b - a, 0) * 100) / 100, voice: raw.voice, seed: raw.seed };
}

const voPath = join(root, "src/demo/vo.json");
const vo = existsSync(voPath) ? JSON.parse(readFileSync(voPath, "utf8")) : {};

for (const p of parts.filter(wanted)) {
  if (!postOnly) {
    const seed = Number(cfg.seeds?.[p.id] ?? cfg.seed ?? 7);
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_192`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text: p.text, model_id: cfg.model, voice_settings: SETTINGS, seed }),
    });
    if (!r.ok) {
      console.log(p.id, "FAILED", r.status, (await r.text()).slice(0, 300));
      process.exitCode = 1;
      continue;
    }
    const j = await r.json();
    writeFileSync(join(rawDir, `${p.id}.mp3`), Buffer.from(j.audio_base64, "base64"));
    writeFileSync(join(rawDir, `${p.id}.json`), JSON.stringify({ model: cfg.model, voice: VOICE, settings: SETTINGS, seed, text: p.text, alignment: j.alignment ?? j.normalized_alignment }));
    if (tryout) {
      console.log(p.id, "tryout saved in", rawDir);
      continue;
    }
  }
  vo[p.id] = finalize(p.id);
  const n = vo[p.id].words.length;
  console.log(p.id, `${vo[p.id].seconds.toFixed(2)} s`, `${n} words`, `${(n / vo[p.id].speechEnd).toFixed(2)} w/s`, `(tightened ${vo[p.id].tightened} s)`);
}
if (!tryout) {
  writeFileSync(voPath, JSON.stringify(vo, null, 1));
  const total = Object.values(vo).reduce((a, s) => a + s.seconds, 0);
  console.log("narration total", total.toFixed(1), "s over", Object.keys(vo).length, "parts");
}
