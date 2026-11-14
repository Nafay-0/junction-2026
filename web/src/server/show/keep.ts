import { saveRecording } from "./recordings";
import type { AttackResult, OutsideRun } from "./types";

/**
 * Live results of acts two and three are kept as their fallback recordings as soon as they happen: the last result
 * of each attack, and the last finished outside-agent run, each with the time it was captured. Played back, they
 * carry the label "Recording of a real run".
 */
const g = globalThis as typeof globalThis & { __dockShowKept?: { attacks: Map<string, AttackResult>; t0: number } };

export async function keepAttack(r: AttackResult): Promise<void> {
  if (r.source !== "live" || r.how === "error") return;
  const k = (g.__dockShowKept ??= { attacks: new Map(), t0: Date.now() });
  k.attacks.set(r.id, r);
  const list = [...k.attacks.values()].sort((a, b) => a.at.localeCompare(b.at));
  const t0 = Date.parse(list[0].at);
  await saveRecording({
    kind: "attacks",
    title: "Now try to break it",
    capturedAt: new Date().toISOString(),
    source: "live attacks through the gate, kept as they happened",
    durationMs: Date.parse(list.at(-1)!.at) - t0,
    frames: list.map((x, i) => ({ t: i * 1500, data: { results: list.slice(0, i + 1).map((y) => ({ ...y, source: "recording" as const })), startedAt: list[0].at } })),
  }).catch(() => undefined);
}

export async function keepOutside(run: OutsideRun, frames: { t: number; data: OutsideRun }[]): Promise<void> {
  if (run.source !== "live" || run.state !== "done") return;
  await saveRecording({
    kind: "outside",
    title: "Any agent can order",
    capturedAt: run.endedAt ?? new Date().toISOString(),
    source: `live ${run.runner} run on ${run.model}`,
    durationMs: frames.at(-1)?.t ?? 0,
    frames: frames.map((f) => ({ t: f.t, data: { ...f.data, source: "recording" as const, recordedAt: run.endedAt } })),
  }).catch(() => undefined);
}
