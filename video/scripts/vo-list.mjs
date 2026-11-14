// Lists the ElevenLabs models and voices this key can use. Prints names and ids only, never the key.
process.loadEnvFile(new URL("../../web/.env.local", import.meta.url));
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
const get = async (path) => {
  const r = await fetch(`https://api.elevenlabs.io${path}`, { headers: { "xi-api-key": key } });
  if (!r.ok) return { error: r.status, body: (await r.text()).slice(0, 300) };
  return r.json();
};
const models = await get("/v1/models");
if (Array.isArray(models)) for (const m of models) console.log("model", m.model_id, "|", m.name, "| tts", m.can_do_text_to_speech, "| langs", (m.languages ?? []).length, "| max", m.maximum_text_length_per_request ?? "", "|", (m.description ?? "").slice(0, 110));
else console.log("models", JSON.stringify(models).slice(0, 300));
const voices = await get("/v2/voices?page_size=100");
const list = voices.voices ?? [];
console.log("voices", list.length, voices.error ? JSON.stringify(voices) : "");
for (const v of list) console.log("voice", v.voice_id, "|", v.name, "|", v.category, "|", Object.entries(v.labels ?? {}).map(([k, x]) => `${k}:${x}`).join(" "), "|", (v.description ?? "").slice(0, 90));
const sub = await get("/v1/user/subscription");
console.log("plan", sub.tier ?? sub.error, "chars", sub.character_count, "/", sub.character_limit);
