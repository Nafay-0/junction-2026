// Records the narration, one clip per scene, with word timings (ElevenLabs text-to-speech with timestamps).
//   node scripts/vo.mjs                 every scene in src/script.json
//   node scripts/vo.mjs gate close      only those scenes (re-record a line alone)
//   VO_VOICE=<voice id> VO_OUT=tryouts/<name> node scripts/vo.mjs title     a tryout that does not touch the film's clips
//   node scripts/vo.mjs --post          no recording: rebuild the film's clips and timings from the raw takes
// Writes public/vo/raw/<id>.mp3 and .json (the take as recorded, with its alignment), public/vo/<id>.mp3 (the take at
// TEMPO, pitch kept: this model ignores the API's speed setting) and src/vo.json (seconds and word times the film is
// timed from, at that tempo). The key is read from the git-ignored web/.env.local and never printed.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = [join(root, "../web/.env.local")].find((p) => existsSync(p));
if (envFile) process.loadEnvFile(envFile);
const key = process.env.ELEVENLABS_API_KEY;
const postOnly = process.argv.includes("--post");
if (!key && !postOnly) throw new Error("ELEVENLABS_API_KEY is not set (web/.env.local)");
/** How much faster the film plays the take than it was recorded (1.1 = ten per cent). */
const TEMPO = Number(process.env.VO_TEMPO ?? 1.1);

export const MODEL = process.env.VO_MODEL ?? "eleven_v4_turbo";
export const VOICE = process.env.VO_VOICE ?? "pFZP5JQG7iQjIQuC4Bku"; // Lily - Velvety Actress (British), the user's choice
const SETTINGS = { stability: Number(process.env.VO_STABILITY ?? 0.35), similarity_boost: 0.8, style: Number(process.env.VO_STYLE ?? 0.6), speed: Number(process.env.VO_SPEED ?? 1), use_speaker_boost: true };
const tryout = !!process.env.VO_OUT;
const outDir = join(root, "public/vo", process.env.VO_OUT ?? "raw");
mkdirSync(outDir, { recursive: true });

const script = JSON.parse(readFileSync(join(root, "src/script.json"), "utf8"));
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/** Characters with times -> words with start and end, in seconds. Bracketed audio tags are not words. */
function words(al) {
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
  return out.map((x) => ({ w: x.w, s: Math.round((x.s / TEMPO) * 1000) / 1000, e: Math.round((x.e / TEMPO) * 1000) / 1000 }));
}

/**
 * Long pauses in the take, tightened the way an editor would: every silence longer than PAUSE_OVER seconds keeps
 * PAUSE_KEEP seconds (half at each side) and loses its middle. Returns the parts of the take that stay.
 */
const PAUSE_OVER = Number(process.env.VO_PAUSE_OVER ?? 0.34);
const PAUSE_KEEP = Number(process.env.VO_PAUSE_KEEP ?? 0.28);
function cuts(file) {
  const log = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=-36dB:d=${PAUSE_OVER}`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.flatMap((a, i) => (ends[i] !== undefined && a > 0.05 && ends[i] - a > PAUSE_KEEP + 0.02 ? [[a + PAUSE_KEEP / 2, ends[i] - PAUSE_KEEP / 2]] : []));
}

/** The film's clip from the raw take: pauses tightened, the same voice at TEMPO, levelled; and its word times. */
function finalize(id) {
  const rawFile = join(root, "public/vo/raw", `${id}.mp3`);
  const raw = JSON.parse(readFileSync(join(root, "public/vo/raw", `${id}.json`), "utf8"));
  const removed = cuts(rawFile);
  const dur = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", rawFile], { encoding: "utf8" }).stdout);
  const keep = [];
  let at = 0;
  for (const [a, b] of removed) keep.push([at, a]), (at = b);
  keep.push([at, dur]);
  const F = 0.008;
  const parts = keep.map(([a, b], i) => `[0:a]atrim=${a.toFixed(4)}:${b.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:d=${F},afade=t=out:st=${Math.max(0, b - a - F).toFixed(4)}:d=${F}[p${i}]`);
  const graph = `${parts.join(";")};${keep.map((_, i) => `[p${i}]`).join("")}concat=n=${keep.length}:v=0:a=1,atempo=${TEMPO},loudnorm=I=-17:TP=-1.5:LRA=11[out]`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", rawFile, "-filter_complex", graph, "-map", "[out]", "-ar", "44100", "-b:a", "192k", join(root, "public/vo", `${id}.mp3`)]);
  const shift = (t) => t - removed.reduce((s, [a, b]) => s + Math.max(0, Math.min(t, b) - a), 0);
  const al = raw.alignment;
  const moved = { characters: al.characters, character_start_times_seconds: al.character_start_times_seconds.map(shift), character_end_times_seconds: al.character_end_times_seconds.map(shift) };
  const ws = words(moved);
  return { seconds: ws.at(-1).e, words: ws, tightened: Math.round(removed.reduce((s, [a, b]) => s + b - a, 0) * 100) / 100 };
}

const voPath = join(root, "src/vo.json");
const vo = existsSync(voPath) ? JSON.parse(readFileSync(voPath, "utf8")) : {};

for (const scene of script) {
  if (only.length && !only.includes(scene.id)) continue;
  if (postOnly) {
    vo[scene.id] = finalize(scene.id);
    console.log(scene.id, `${vo[scene.id].seconds.toFixed(2)} s`, `(pauses tightened by ${vo[scene.id].tightened} s)`);
    continue;
  }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_192`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text: scene.text, model_id: MODEL, voice_settings: SETTINGS, seed: Number(process.env.VO_SEED ?? 7) }),
  });
  if (!r.ok) {
    console.log(scene.id, "FAILED", r.status, (await r.text()).slice(0, 400));
    process.exitCode = 1;
    continue;
  }
  const j = await r.json();
  const al = j.alignment ?? j.normalized_alignment;
  writeFileSync(join(outDir, `${scene.id}.mp3`), Buffer.from(j.audio_base64, "base64"));
  writeFileSync(join(outDir, `${scene.id}.json`), JSON.stringify({ model: MODEL, voice: VOICE, settings: SETTINGS, text: scene.text, alignment: al }));
  if (tryout) {
    console.log(scene.id, "tryout saved");
    continue;
  }
  vo[scene.id] = finalize(scene.id);
  console.log(scene.id, `${vo[scene.id].seconds.toFixed(2)} s`, `${vo[scene.id].words.length} words`);
}
if (!tryout) {
  writeFileSync(voPath, JSON.stringify(vo, null, 1));
  const total = Object.values(vo).reduce((a, s) => a + s.seconds, 0);
  console.log("narration total", total.toFixed(1), "s over", Object.keys(vo).length, "scenes");
}
