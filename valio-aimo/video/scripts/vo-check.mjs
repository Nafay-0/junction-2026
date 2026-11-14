// Transcribes recorded clips back to text (ElevenLabs speech-to-text) to check that names and numbers were said.
// node scripts/vo-check.mjs public/vo/title.mp3 ...   Prints the transcript only.
import { existsSync, readFileSync } from "node:fs";
const envFile = new URL("../../web/.env.local", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const key = process.env.ELEVENLABS_API_KEY;
for (const file of process.argv.slice(2)) {
  const form = new FormData();
  form.append("model_id", process.env.STT_MODEL ?? "scribe_v1");
  form.append("file", new Blob([readFileSync(file)], { type: "audio/mpeg" }), "clip.mp3");
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
  const t = await r.text();
  let out = t.slice(0, 300);
  try { out = JSON.parse(t).text ?? out; } catch {}
  console.log(file.split("/").slice(-2).join("/"), r.status, "|", out);
}
