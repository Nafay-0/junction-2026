import { expect, type APIRequestContext, type Page, type Route, type WebSocketRoute } from "@playwright/test";

/**
 * Stubs for the call screen tests (e2e/demo/call.spec.ts). The test server runs with DOCK_VOICE=off and no
 * Gemini key, so a real voice session can never open there; these stubs stand in for the parts that live in
 * Google's cloud. Everything that is AimoPilot's own (the call registry, the typed fallback, the intake, the
 * ledger) stays the real server.
 */

/** The Gemini Live WebSocket the browser opens (src/server/channels/voice/live.ts LIVE_WS_URL). */
export const LIVE_WS = /generativelanguage\.googleapis\.com\/ws\//;

export type MicMode = "real" | "synthetic" | "NotAllowedError" | "NotFoundError";

/**
 * Wrap navigator.mediaDevices.getUserMedia before any page script runs, and record what happened in
 * window.__mic. "real" passes through to the browser (the fake device on Chromium and Firefox); "synthetic" returns a
 * silent stream from a WebAudio oscillator (WebKit has no fake media device in Playwright); the error modes reject
 * the way a browser does when the person taps "Don't allow" (NotAllowedError) or the phone has no microphone.
 */
export async function wrapMicrophone(page: Page, mode: MicMode): Promise<void> {
  await page.addInitScript((mode: string) => {
    const w = window as unknown as { __mic: { calls: number; ok: number; errors: string[] } };
    w.__mic = { calls: 0, ok: 0, errors: [] };
    // Patched on MediaDevices.prototype, not on the navigator.mediaDevices instance: WebKit sometimes calls the
    // prototype's method although an own property was set (seen in about half the runs).
    const proto = typeof MediaDevices === "undefined" ? undefined : MediaDevices.prototype;
    if (!proto) return;
    const orig = proto.getUserMedia;
    proto.getUserMedia = async function (this: MediaDevices, c?: MediaStreamConstraints) {
      w.__mic.calls++;
      try {
        let s: MediaStream;
        if (mode === "NotAllowedError" || mode === "NotFoundError") throw new DOMException(mode === "NotAllowedError" ? "Permission denied" : "Requested device not found", mode);
        if (mode === "synthetic") {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const dest = ctx.createMediaStreamDestination();
          osc.connect(dest);
          osc.start();
          s = dest.stream;
        } else s = await orig.call(this, c);
        w.__mic.ok++;
        return s;
      } catch (e) {
        w.__mic.errors.push((e as Error).name);
        throw e;
      }
    };
  }, mode);
}

export const micLog = (page: Page) => page.evaluate(() => (window as unknown as { __mic: { calls: number; ok: number; errors: string[] } }).__mic);

/**
 * Make the call endpoint hand out a voice session although the server has voice off: the browser's POST for a voice
 * call is forwarded to the real server as a typed call (so the call id, heartbeats and hang-up are real), and the
 * answer gets a stubbed `live` block (a fake one-use token for the real Gemini URL, which routeWebSocket catches).
 * Returns the call ids the real server issued.
 */
export async function stubVoiceToken(page: Page): Promise<string[]> {
  const ids: string[] = [];
  await page.route(/\/ui-api\/voice\/[^/]+\/call$/, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = JSON.parse(route.request().postData() || "{}") as { mode?: string; carryFrom?: string };
    if (body.mode === "typed") return route.fallback();
    const res = await route.fetch({ postData: JSON.stringify({ ...body, mode: "typed" }) });
    const start = await res.json();
    if (!res.ok()) return route.fulfill({ response: res, json: start });
    ids.push(start.callId);
    await route.fulfill({
      status: 201,
      json: {
        ...start,
        mode: body.mode ?? "push_to_talk",
        maxSeconds: 300,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        live: { wsUrl: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained", token: "e2e-stub-token", model: "gemini-3.8-live", startBy: new Date(Date.now() + 60_000).toISOString() },
      },
    });
  });
  return ids;
}

/**
 * Stand in for the Gemini Live service. "answer": reply setupComplete to the setup message (the call connects);
 * "silent": accept the socket and never answer (a network that lets the socket through but nothing comes back).
 * The returned function gives the socket the test can close.
 */
export async function stubLiveService(page: Page, behaviour: "answer" | "silent"): Promise<{ socket: () => WebSocketRoute | undefined; setups: string[]; urls: string[] }> {
  let current: WebSocketRoute | undefined;
  const setups: string[] = [];
  const urls: string[] = [];
  await page.routeWebSocket(LIVE_WS, (ws) => {
    current = ws;
    urls.push(ws.url());
    ws.onMessage((m) => {
      const text = typeof m === "string" ? m : m.toString();
      if (text.includes('"setup"')) {
        setups.push(text);
        if (behaviour === "answer") ws.send(JSON.stringify({ setupComplete: {} }));
      }
    });
  });
  return { socket: () => current, setups, urls };
}

/** The visitor kitchen's own ledger entries, read with the phone's approver session: nothing ordered, quoted or sent for sign-off. */
export async function expectNothingOrdered(request: APIRequestContext): Promise<{ type: string; summary: string }[]> {
  const res = await request.get("/api/v1/ledger");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { verification: { ok: boolean }; entries: { type: string; summary: string; orderId?: string }[] };
  expect(body.verification.ok).toBe(true);
  const ordered = body.entries.filter((e) => e.orderId || ["quote", "decision", "approval_requested", "order"].includes(e.type));
  expect(ordered, "no quote, gate decision, sign-off request or order on this kitchen's ledger").toEqual([]);
  return body.entries;
}
