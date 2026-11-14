import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as joinRoute from "@/app/api/v1/join/route";
import * as joinVerifyRoute from "@/app/api/v1/join/verify/route";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { frameIndexAt } from "@/app/_show/use-week";
import { getRuntime, resetRuntime } from "../runtime";
import { runAttack } from "./attacks";
import { forgetCast } from "./cast";
import { keepAttack } from "./keep";
import { preflight } from "./preflight";
import { loadRecording, recordingIndex, saveRecording } from "./recordings";
import { recordingOf, resetShow, startWeek, weekDone } from "./registry";
import type { AttackId, WeekRun } from "./types";
import { TEST_PACE } from "./week";

const BASE = "https://dock.test";
const SUNDAY_MORNING = new Date("2026-11-15T07:00:00Z");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function join() {
  const auth = new SoftwareAuthenticator(BASE);
  const post = (p: string, body?: unknown) => new Request(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const start = (await (await joinRoute.POST(post("/api/v1/join"))).json()) as Json;
  const done = (await (await joinVerifyRoute.POST(post("/api/v1/join/verify", { response: auth.register(start.options) }))).json()) as Json;
  return done.sandbox as Json;
}

const cwd = process.cwd();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: SUNDAY_MORNING });
  resetRuntime();
  resetShow();
  forgetCast();
  process.chdir(mkdtempSync(path.join(tmpdir(), "dock-show-")));
});
afterEach(() => {
  process.chdir(cwd);
  vi.useRealTimers();
});

describe("now try to break it", () => {
  it("every attack is held by the gate with its rule named, and leaves nothing waiting", async () => {
    const sandbox = await join();
    const rt = await getRuntime();
    const run = (id: AttackId) => runAttack(rt, id, { sandboxId: sandbox.sandboxId, by: "Test presenter" });

    expect(await run("tenfold")).toMatchObject({ held: true, how: "stopped", rule: "human_input" });
    expect(await run("forged_mandate")).toMatchObject({ held: true, how: "refused", rule: "mandate_signature", status: 401 });
    expect(await run("replay")).toMatchObject({ held: true, how: "refused", rule: "quote_replay" });
    expect(await run("self_approve")).toMatchObject({ held: true, how: "refused", rule: "approver_identity", status: 403 });
    expect(await run("split")).toMatchObject({ held: true, how: "person", rule: "order_splitting" });
    expect(await run("relayed_yes")).toMatchObject({ held: true, how: "person", rule: "human_confirmation" });
    expect(await run("suspend")).toMatchObject({ held: true, how: "refused", rule: "operator_suspension" });
    expect(await run("resume")).toMatchObject({ held: false, how: "allowed", status: 200 });

    const waiting = (await rt.dock.listOrders()).filter((o) => o.orgId === sandbox.orgId && o.status === "pending_approval");
    expect(waiting).toHaveLength(0);
    expect(rt.dock.ledger.verify().ok).toBe(true);
  }, 60_000);

  it("keeps each live attack as the act's recording, labelled as one", async () => {
    const sandbox = await join();
    const rt = await getRuntime();
    await keepAttack(await runAttack(rt, "forged_mandate", { sandboxId: sandbox.sandboxId, by: "Test" }));
    await keepAttack(await runAttack(rt, "replay", { sandboxId: sandbox.sandboxId, by: "Test" }));
    const rec = await loadRecording<{ results: { id: string; source: string }[] }>("attacks");
    expect(rec?.where).toBe("saved");
    expect(rec?.frames.at(-1)?.data.results.map((r) => [r.id, r.source])).toEqual([
      ["forged_mandate", "recording"],
      ["replay", "recording"],
    ]);
  }, 60_000);
});

describe("the presenter's fallbacks", () => {
  it("a finished live week becomes a recording that replays frame by frame, labelled as a recording", async () => {
    const sandbox = await join();
    const rt = await getRuntime();
    const started = await startWeek(rt, { sandboxId: sandbox.sandboxId, pace: TEST_PACE, signOffTimeoutMs: 200 });
    expect(recordingOf(started.runId, "test")).toBeUndefined(); // only a finished week
    await weekDone(started.runId);
    const rec = recordingOf(started.runId, "test")!;
    expect(rec.kind).toBe("week");
    expect(rec.frames[0].t).toBe(0);
    expect(rec.frames.every((f) => f.data.source === "recording" && f.data.recordedAt)).toBe(true);
    expect(rec.frames.at(-1)!.data.state).toBe("finished");
    expect(rec.frames.map((f) => f.t)).toEqual([...rec.frames.map((f) => f.t)].sort((a, b) => a - b));

    await saveRecording(rec);
    const back = await loadRecording<WeekRun>("week");
    expect(back).toMatchObject({ kind: "week", where: "saved" });
    expect((await recordingIndex()).map((r) => r.kind)).toContain("week");

    // The player shows the last frame whose time has come.
    expect(frameIndexAt(rec.frames, -1)).toBe(0);
    expect(frameIndexAt(rec.frames, Number.MAX_SAFE_INTEGER)).toBe(rec.frames.length - 1);
  }, 60_000);

  it("with no recording on the server, says so instead of showing anything", async () => {
    expect(await loadRecording("outside")).toBeUndefined();
    expect(await recordingIndex()).toEqual([]);
  });

  it("preflight names what is wrong and what to do", async () => {
    const rt = await getRuntime();
    const checks = await preflight(rt, { origin: "http://localhost:3000" });
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId.catalogue).toMatchObject({ state: "warn" }); // the seed in tests
    expect(byId.phone).toMatchObject({ state: "fail", fix: expect.stringMatching(/Scan the QR code/) }); // no phone joined
    expect(byId.partner.state).toBe("ok");
    expect(byId.rec_week).toMatchObject({ state: "warn", fix: expect.stringMatching(/press C to keep/) });
    for (const c of checks) if (c.state !== "ok") expect(c.detail.length).toBeGreaterThan(5);
  }, 60_000);
});
