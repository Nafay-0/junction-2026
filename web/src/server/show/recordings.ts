import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Recording } from "./types";

/**
 * The presenter's fallbacks: recordings of real earlier runs, played through the same screens with a "Recording"
 * label. Two places, newest wins:
 *
 *   .data/show/recordings/<kind>.json     kept on this server from a live run (the "keep as fallback" key, or the
 *                                         recorder script); survives restarts of the process, not a new deploy
 *   src/server/show/recordings/<kind>.json captured by the team's own tooling from the real system and committed
 *                                         (scripts/show/record.ts), so a fresh deploy has a fallback from the start
 *
 * A recording holds what the screen showed (snapshots over time), never a key, token or passkey.
 */
export type RecordingKind = "week" | "attacks" | "outside";
export const RECORDING_KINDS: RecordingKind[] = ["week", "attacks", "outside"];

const savedDir = () => path.join(process.cwd(), ".data", "show", "recordings");
const bundledDir = () => path.join(process.cwd(), "src", "server", "show", "recordings");

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function loadRecording<T = unknown>(kind: RecordingKind): Promise<(Recording<T> & { where: "saved" | "bundled" }) | undefined> {
  const saved = await readJson<Recording<T>>(path.join(savedDir(), `${kind}.json`));
  const bundled = await readJson<Recording<T>>(path.join(bundledDir(), `${kind}.json`));
  const pick = [saved && { ...saved, where: "saved" as const }, bundled && { ...bundled, where: "bundled" as const }]
    .filter((x): x is Recording<T> & { where: "saved" | "bundled" } => !!x && Array.isArray(x.frames) && x.frames.length > 0)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  return pick[0];
}

export async function saveRecording<T>(rec: Recording<T>, opts: { bundled?: boolean } = {}): Promise<{ file: string; capturedAt: string; frames: number }> {
  const dir = opts.bundled ? bundledDir() : savedDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${rec.kind}.json`);
  await writeFile(file, JSON.stringify(rec));
  return { file: path.relative(process.cwd(), file), capturedAt: rec.capturedAt, frames: rec.frames.length };
}

/** What the presenter can fall back to, per act. */
export async function recordingIndex(): Promise<{ kind: RecordingKind; capturedAt: string; source: string; durationMs: number; where: string }[]> {
  const out = [];
  for (const kind of RECORDING_KINDS) {
    const r = await loadRecording(kind);
    if (r) out.push({ kind, capturedAt: r.capturedAt, source: r.source, durationMs: r.durationMs, where: r.where });
  }
  return out;
}
