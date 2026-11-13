import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readDocument } from "./scan/read";
import { liveSetup, mintLiveToken, voiceModel } from "./voice/live";

// Paid, opt-in: DOCK_LIVE=1 with GEMINI_API_KEY (voice) and ANTHROPIC_API_KEY (reader). Skipped otherwise.
const live = process.env.DOCK_LIVE === "1";

describe.skipIf(!live || !process.env.GEMINI_API_KEY)("live: Gemini Live token", () => {
  it("mints a one-use token with the setup locked inside", async () => {
    const t = await mintLiveToken(liveSetup({ model: voiceModel(), system: "Test.", mode: "push_to_talk" }), { seconds: 60 });
    expect(t.token).toMatch(/^auth_tokens\//);
  });
});

describe.skipIf(!live || !process.env.ANTHROPIC_API_KEY)("live: document reader", () => {
  it("does not guess a smudged amount", async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, "../../../eval/scan/06-smudged.jpg")));
    const r = await readDocument({ kind: "image", bytes, mediaType: "image/jpeg" });
    const cream = r.lines.find((l) => /cream/i.test(l.read));
    expect(cream?.status).not.toBe("ready");
    expect(r.lines.find((l) => /milk/i.test(l.read))).toMatchObject({ amount: 25, unit: "L", status: "ready" });
  }, 60_000);
});
