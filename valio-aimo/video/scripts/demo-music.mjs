// Makes the demo's music bed with ElevenLabs Music (instrumental). Nothing is downloaded from anywhere else.
//   node scripts/demo-music.mjs <seconds> <name>     public/demo-music/<name>.mp3
// The key is read from the git-ignored web/.env.local and never printed.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, "../web/.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set (web/.env.local)");
const [secs = "300", name = "bed"] = process.argv.slice(2);
const PROMPT = `Instrumental background bed for a long, calm technology product walkthrough with a narrator speaking over it the whole time. About 96 BPM, 4/4, steady, in a major key. Light, modern, warm and quietly optimistic. A soft pulse, warm electric piano chords, muted plucks, a gentle sub bass, very light tight percussion. Sparse and even, with no lead melody, no vocals, no choir, no risers, no drops, nothing cinematic or epic, no big changes in energy: it should sit under speech for minutes without drawing attention. Loops cleanly, with a gentle soft ending.`;
mkdirSync(join(root, "public/demo-music"), { recursive: true });
const r = await fetch("https://api.elevenlabs.io/v1/music", { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ prompt: PROMPT, music_length_ms: Number(secs) * 1000, model_id: "music_v2_5", force_instrumental: true }) });
if (!r.ok) { console.log("FAILED", r.status, (await r.text()).slice(0, 400)); process.exit(1); }
const audio = Buffer.from(await r.arrayBuffer());
writeFileSync(join(root, "public/demo-music", `${name}.mp3`), audio);
console.log(`${name}.mp3`, audio.length, "bytes");
