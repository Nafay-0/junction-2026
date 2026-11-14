/**
 * How many voice sessions the configured key admits at once: opens N sessions together (each with its own one-use
 * token, as N phones calling at the same moment would), counts how many start (setupComplete / session.created)
 * within 12 s, how many are refused and with what close reason, and how long each took to start. Each session is
 * closed as soon as it starts; nothing is said, so this costs next to nothing.
 *
 *   pnpm tsx scripts/eval/voice-capacity.ts [--model gemini-3.8-live] [--n 5]
 */
import { flag, loadLocalEnv } from "../lib/agent-cli";

loadLocalEnv();

async function main() {
  const args = process.argv.slice(2);
  const model = flag(args, "--model") ?? "gemini-3.8-live";
  const n = Number(flag(args, "--n") ?? 5);
  const { liveSetup, mintLiveToken, LIVE_WS_URL, providerOf } = await import("@/server/channels/voice/live");
  const { realtimeSession, mintRealtimeSecret, REALTIME_WS_URL } = await import("@/server/channels/voice/realtime");
  const openai = providerOf(model) === "openai";
  const tokens = await Promise.all(
    Array.from({ length: n }, () =>
      openai
        ? mintRealtimeSecret(realtimeSession({ model, system: "Say nothing.", mode: "hands_free" }), { seconds: 60 }).then((t) => ({ ok: true as const, token: t.token }))
        : mintLiveToken(liveSetup({ model, system: "Say nothing.", mode: "hands_free" }), { seconds: 60 }).then((t) => ({ ok: true as const, token: t.token })),
    ).map((p) => p.catch((e: Error) => ({ ok: false as const, error: e.message.slice(0, 160) }))),
  );
  const t0 = Date.now();
  const results = await Promise.all(
    tokens.map(
      (t) =>
        new Promise<string>((resolve) => {
          if (!t.ok) return resolve(`token refused: ${t.error}`);
          const ws = openai ? new WebSocket(`${REALTIME_WS_URL}?model=${model}`, ["realtime", `openai-insecure-api-key.${t.token}`]) : new WebSocket(`${LIVE_WS_URL}?access_token=${encodeURIComponent(t.token)}`);
          const timer = setTimeout(() => {
            ws.close();
            resolve("no start within 12 s");
          }, 12_000);
          ws.onopen = () => !openai && ws.send(JSON.stringify({ setup: { model: `models/${model}` } }));
          ws.onmessage = async (e) => {
            const text = typeof e.data === "string" ? e.data : await (e.data as Blob).text();
            if (/setupComplete|session\.created/.test(text)) {
              clearTimeout(timer);
              resolve(`started in ${Date.now() - t0} ms`);
              ws.close();
            }
          };
          ws.onclose = (e) => {
            clearTimeout(timer);
            resolve(`closed ${e.code} ${e.reason.slice(0, 160)}`);
          };
        }),
    ),
  );
  console.log(JSON.stringify({ model, sessions: n, at: new Date().toISOString(), results }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
