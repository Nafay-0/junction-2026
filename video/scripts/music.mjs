// Makes the film's music bed and two small sounds with ElevenLabs (music and sound-effects endpoints).
//   node scripts/music.mjs bed 1 2 3     candidates public/music/bed-<n>.mp3, each the film's exact length
//   node scripts/music.mjs sfx           public/sfx/tap.mp3 and public/sfx/swell.mp3
// The key is read from the git-ignored web/.env.local and never printed. Nothing is downloaded from anywhere else.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = [join(root, "../web/.env.local")].find((p) => existsSync(p));
if (envFile) process.loadEnvFile(envFile);
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set (web/.env.local)");

const cfg = JSON.parse(readFileSync(join(root, "src/extra.json"), "utf8"));
const vo = JSON.parse(readFileSync(join(root, "src/vo.json"), "utf8"));
const ids = Object.keys(cfg.extra);
const frames = ids.reduce((a, id) => a + cfg.lead + Math.ceil(vo[id].seconds * 30) + cfg.tail + cfg.extra[id] - cfg.into[id], 0);
const ms = Math.round((frames / 30) * 1000);

const PROMPT = `Instrumental background music for a two-minute technology product film with a narrator speaking over it. Exactly 100 BPM, 4/4, steady from the first beat, in a major key. Light, modern, optimistic and confident. A clean soft pulse, warm electric piano and muted plucks, a gentle sub bass, light tight percussion that enters after the first ten seconds. Sparse and spacious so a voice sits on top: no lead melody that competes with speech, no vocals, no choir, no risers, nothing cinematic or epic. A small lift in energy at about 15 seconds, a calm steady middle, a gentle lift over the last 25 seconds, and a clear resolved final chord that rings out and ends exactly at the end of the track.`;

const post = async (path, body, query = "") => {
  const r = await fetch(`https://api.elevenlabs.io${path}${query}`, { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return Buffer.from(await r.arrayBuffer());
};

const [what, ...rest] = process.argv.slice(2);
if (what === "bed") {
  mkdirSync(join(root, "public/music"), { recursive: true });
  for (const n of rest.length ? rest : ["1"]) {
    try {
      const audio = await post("/v1/music", { prompt: PROMPT, music_length_ms: ms, model_id: "music_v2_5", force_instrumental: true });
      writeFileSync(join(root, "public/music", `bed-${n}.mp3`), audio);
      console.log(`bed-${n}.mp3`, audio.length, "bytes, asked", ms, "ms");
    } catch (err) {
      console.log(`bed-${n} FAILED`, String(err.message).slice(0, 400));
    }
  }
}
if (what === "sfx") {
  mkdirSync(join(root, "public/sfx"), { recursive: true });
  const sounds = [
    { name: "tap", text: "A single soft, clean user-interface confirmation tick, short and subtle, high quality, no reverb tail", duration_seconds: 0.6 },
    { name: "swell", text: "A soft low warm swell rising gently and ending in a soft airy bloom, subtle, modern, for a logo reveal", duration_seconds: 2.5 },
  ];
  for (const s of sounds) {
    try {
      const audio = await post("/v1/sound-generation", { text: s.text, duration_seconds: s.duration_seconds, prompt_influence: 0.5 });
      writeFileSync(join(root, "public/sfx", `${s.name}.mp3`), audio);
      console.log(`${s.name}.mp3`, audio.length, "bytes");
    } catch (err) {
      console.log(`${s.name} FAILED`, String(err.message).slice(0, 300));
    }
  }
}
