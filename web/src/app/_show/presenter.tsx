"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../_client/api";
import { PRODUCT_NAME } from "../_ui/brand";
import { clock } from "../_ui/plain";
import { Target } from "../_ui/target";
import { CrashMatrix } from "../_wall/crash-matrix";
import type { Board } from "../_wall/crash-board";
import type { AttackResult, KitchenRef, OutsideRun, PreflightCheck, Recording, Spend, WeekRun } from "@/server/show/types";
import { AttackBoard, OutsideBoard, type AttackMeta } from "./acts";
import { ClockOffset } from "./clock";
import { BEATS, TOTAL_SECONDS, type Beat, type Dep } from "./script";
import { css } from "./css";
import { useLiveWeek, useRecording } from "./use-week";
import { WeekBoard } from "./week-board";

/**
 * Presenter mode: one screen, run from the keyboard (or a clicker: Page Up / Page Down), that carries the whole
 * three-minute story and can recover from anything. The stage fills the screen; the presenter's strip at the foot
 * (toggle with N) says what to say, what will happen, the time against the three minutes, the state of every
 * dependency, and that F switches the current act to a recording of a real earlier run.
 */
type KitchenRow = KitchenRef & { createdAt: string; week?: WeekRun };
type Props = { board: Board; attacks: AttackMeta[]; publicUrl: string; staff: string };

const SENTENCE = "The agent can ask for anything. It can only buy what the kitchen signed for.";

export function Presenter({ board, attacks, publicUrl, staff }: Props) {
  const [beat, setBeat] = useState(0);
  const [t0, setT0] = useState<number>();
  const [beatAt, setBeatAt] = useState<number>(() => Date.now());
  const [notes, setNotes] = useState(true);
  const [overlay, setOverlay] = useState<"none" | "preflight" | "kitchens" | "help">("none");
  const [kitchens, setKitchens] = useState<KitchenRow[]>([]);
  const [sandboxId, setSandboxId] = useState<string>();
  const [weekId, setWeekId] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [fallback, setFallback] = useState<Record<string, boolean>>({});
  const [recs, setRecs] = useState<Record<string, Recording<unknown> | null>>({});
  const [results, setResults] = useState<AttackResult[]>([]);
  const [busyAttack, setBusyAttack] = useState<string>();
  const [outsideId, setOutsideId] = useState<string>();
  const [outside, setOutside] = useState<OutsideRun>();
  const [checks, setChecks] = useState<PreflightCheck[]>();
  const [spend, setSpend] = useState<Spend>();
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const current: Beat = BEATS[beat];

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // Kitchens: the presenter's phone joins like a visitor; the newest kitchen with a passkey is picked by default.
  const loadKitchens = useCallback(async () => {
    const r = await api<{ kitchens: KitchenRow[] }>("GET", "/ui-api/show/kitchens");
    if (!r.ok) return;
    setKitchens(r.data.kitchens);
    setSandboxId((id) => (id && r.data.kitchens.some((k) => k.sandboxId === id) ? id : r.data.kitchens.find((k) => k.passkey && !k.house)?.sandboxId));
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void loadKitchens(), 0);
    const t = setInterval(() => void loadKitchens(), 5000);
    return () => (clearTimeout(first), clearInterval(t));
  }, [loadKitchens]);
  const kitchen = kitchens.find((k) => k.sandboxId === sandboxId);

  const { run: liveWeek, error: weekError } = useLiveWeek(weekId);

  const loadRecording = useCallback(
    async (kind: string) => {
      if (recs[kind] !== undefined) return;
      const r = await api<{ recording: Recording<unknown> }>("GET", `/ui-api/show/recordings/${kind}`);
      setRecs((m) => ({ ...m, [kind]: r.ok ? r.data.recording : null }));
    },
    [recs],
  );

  const go = useCallback(
    (i: number) => {
      const n = Math.max(0, Math.min(BEATS.length - 1, i));
      setBeat(n);
      setBeatAt(Date.now());
      setT0((t) => t ?? (n > 0 ? Date.now() : undefined));
    },
    [],
  );

  const startWeek = useCallback(async () => {
    setProblem(undefined);
    setFallback((f) => ({ ...f, week: false }));
    const r = await api<{ run: WeekRun }>("POST", "/ui-api/show/week", { sandboxId, pace: "brisk" });
    if (!r.ok) {
      setProblem(`The week did not start: ${r.error.message} Press F for the recording.`);
      return;
    }
    setWeekId(r.data.run.runId);
  }, [sandboxId]);

  const attack = useCallback(
    async (id: string) => {
      setBusyAttack(id);
      setFallback((f) => ({ ...f, attacks: false }));
      const r = await api<{ result: AttackResult }>("POST", "/ui-api/show/attack", { id, sandboxId });
      setBusyAttack(undefined);
      if (!r.ok) return setProblem(`That attack did not run: ${r.error.message} Press F for the recording.`);
      setResults((xs) => [...xs, r.data.result]);
    },
    [sandboxId],
  );

  const sendOutside = useCallback(async () => {
    setProblem(undefined);
    setFallback((f) => ({ ...f, outside: false }));
    const r = await api<{ run: OutsideRun }>("POST", "/ui-api/show/outside", { sandboxId });
    if (!r.ok) return setProblem(`The outside agent did not start: ${r.error.message} Press F for the recording.`);
    setOutside(r.data.run);
    setOutsideId(r.data.run.runId);
  }, [sandboxId]);

  useEffect(() => {
    if (!outsideId) return;
    let alive = true;
    let v = -1;
    (async () => {
      while (alive) {
        const r = await api<{ run: OutsideRun }>("GET", `/ui-api/show/outside/${outsideId}?after=${v}`);
        if (!alive) return;
        if (!r.ok) {
          await new Promise((res) => setTimeout(res, 1500));
          continue;
        }
        v = r.data.run.version;
        setOutside(r.data.run);
        if (r.data.run.state !== "running") return;
      }
    })();
    return () => {
      alive = false;
    };
  }, [outsideId]);

  const runPreflight = useCallback(
    async (model = false) => {
      setChecking(true);
      setOverlay("preflight");
      const r = await api<{ checks: PreflightCheck[]; spend: Spend }>("GET", `/ui-api/show/preflight?${new URLSearchParams({ ...(sandboxId ? { sandboxId } : {}), ...(model ? { model: "1" } : {}) })}`);
      setChecking(false);
      if (r.ok) {
        setChecks(r.data.checks);
        setSpend(r.data.spend);
      } else setChecks([{ id: "server", label: "This server", state: "fail", detail: r.error.message, fix: "Use the recordings (F) on every act." }]);
    },
    [sandboxId],
  );

  const keep = useCallback(async () => {
    if (!weekId) return;
    const r = await api<{ saved: { capturedAt: string } }>("POST", `/ui-api/show/week/${weekId}/record`);
    setProblem(r.ok ? `Kept this week as the fallback recording (${clock(r.data.saved.capturedAt)}).` : r.error.message);
    setRecs((m) => ({ ...m, week: undefined as never }));
  }, [weekId]);

  const toggleFallback = useCallback(() => {
    const kind = current.fallback;
    if (!kind) return setProblem("This beat has no live dependency: nothing to fall back to.");
    void loadRecording(kind);
    setFallback((f) => ({ ...f, [kind]: !f[kind] }));
  }, [current, loadRecording]);

  // The keyboard.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (overlay !== "none" && k === "Escape") return setOverlay("none");
    if (k === "ArrowRight" || k === "PageDown" || k === " ") return go(beat + 1);
    if (k === "ArrowLeft" || k === "PageUp") return go(beat - 1);
    if (k === "Enter") {
      if (current.stage === "week") return void startWeek();
      if (current.stage === "outside") return void sendOutside();
      return go(beat + 1);
    }
    const lower = k.toLowerCase();
    if (/^[1-6]$/.test(k)) {
      go(BEATS.findIndex((b) => b.stage === "attacks"));
      return void attack(attacks[Number(k) - 1].id);
    }
    if (lower === "s") return void attack("suspend");
    if (lower === "r") return void attack("resume");
    if (lower === "w") {
      go(BEATS.findIndex((b) => b.stage === "week"));
      return void startWeek();
    }
    if (lower === "a") {
      go(BEATS.findIndex((b) => b.stage === "outside"));
      return void sendOutside();
    }
    if (lower === "l") return go(BEATS.findIndex((b) => b.stage === "board"));
    if (lower === "f") return toggleFallback();
    if (lower === "p") return void runPreflight(e.shiftKey);
    if (lower === "k") return setOverlay((o) => (o === "kitchens" ? "none" : "kitchens"));
    if (lower === "n" || k === ".") return setNotes((n) => !n);
    if (lower === "t") {
      setT0(Date.now());
      return setBeatAt(Date.now());
    }
    if (lower === "x" && weekId) return void api("POST", `/ui-api/show/week/${weekId}/stop`);
    if (lower === "c") return void keep();
    if (k === "?" || lower === "h") return setOverlay((o) => (o === "help" ? "none" : "help"));
  };
  useEffect(() => {
    keys.current = onKey;
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, select, textarea")) return;
      keys.current(e);
      if (["ArrowRight", "ArrowLeft", " ", "PageDown", "PageUp"].includes(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Dependencies: what preflight found, and what the live calls just showed.
  const depState = useMemo(() => {
    const find = (id: string) => checks?.find((c) => c.id === id)?.state;
    const st: Record<Dep, "ok" | "warn" | "fail" | "unknown"> = {
      partner: weekError ? "fail" : (find("partner") ?? "unknown"),
      phone: kitchen ? (kitchen.house ? "fail" : kitchen.passkey ? "ok" : "warn") : "fail",
      model: find("model") ?? "unknown",
      database: find("database") ?? "unknown",
    };
    return st;
  }, [checks, kitchen, weekError]);

  const elapsed = t0 ? (now - t0) / 1000 : 0;
  const beatElapsed = (now - beatAt) / 1000;

  return (
    <div className={`${css.stage} on-dark flex h-dvh flex-col overflow-hidden`}>
      <main className="relative min-h-0 flex-1">
        <StageView beat={current} board={board} attacks={attacks} results={results} busyAttack={busyAttack} outside={outside} liveWeek={liveWeek} kitchen={kitchen} fallback={fallback} recs={recs} publicUrl={publicUrl} />
        {problem && (
          <p role="status" className={`absolute inset-x-0 top-0 bg-paper px-4 py-2 font-semibold text-petrol-deep ${css.body}`}>
            {problem}
          </p>
        )}
        {overlay === "preflight" && <Preflight checks={checks} spend={spend} checking={checking} onClose={() => setOverlay("none")} onModel={() => void runPreflight(true)} />}
        {overlay === "kitchens" && <Kitchens kitchens={kitchens} chosen={sandboxId} onPick={(id) => (setSandboxId(id), setOverlay("none"))} />}
        {overlay === "help" && <Help />}
      </main>
      {notes && (
        <footer className="shrink-0 border-t-4 border-lime bg-ink text-paper">
          <div className="grid gap-x-6 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="text-[0.85rem] text-paper/70">
                {beat + 1} of {BEATS.length}, {current.act}. Speaker {current.speaker}.
              </p>
              <p className="display text-[1.5rem]">{current.title}</p>
              <p className="mt-1 max-w-[110ch] text-[1.05rem] leading-snug">{current.say}</p>
              <p className="mt-1 text-[0.92rem] text-paper/75">What happens: {current.happens}</p>
            </div>
            <div className="min-w-0 space-y-2 text-[0.92rem]">
              <p>
                <span className={`display tabular text-[1.8rem] ${elapsed > TOTAL_SECONDS ? "text-safety" : "text-lime"}`}>{mmss(elapsed)}</span> <span className="text-paper/70">of 3:00</span>
                <span className="ml-4 tabular">
                  this beat {mmss(beatElapsed)} of {mmss(current.seconds)}
                </span>
              </p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Dependencies">
                {(["partner", "phone", "model", "database"] as Dep[]).map((d) => (
                  <li key={d} className={current.deps.includes(d) ? "" : "text-paper/50"}>
                    <span aria-hidden className={depState[d] === "ok" ? "text-lime" : depState[d] === "fail" ? "text-safety" : depState[d] === "warn" ? "text-safety" : "text-paper/50"}>
                      ●
                    </span>{" "}
                    {DEP_LABEL[d]}
                    {d === "phone" && kitchen ? `: ${kitchen.approverName}` : ""}
                  </li>
                ))}
              </ul>
              <p className="text-paper/75">
                {current.fallback ? (fallback[current.fallback] ? "Showing the recording. F: back to live." : "F: switch this act to its recording.") : "No live dependency here."} P: preflight. K: kitchen. ?: keys. Signed in as {staff}.
              </p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

const DEP_LABEL: Record<Dep, string> = { partner: "partner's live service", phone: "the phone that signs", model: "the model", database: "the database" };

function mmss(s: number): string {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

function StageView(p: {
  beat: Beat;
  board: Board;
  attacks: AttackMeta[];
  results: AttackResult[];
  busyAttack?: string;
  outside?: OutsideRun;
  liveWeek?: WeekRun;
  kitchen?: KitchenRow;
  fallback: Record<string, boolean>;
  recs: Record<string, Recording<unknown> | null>;
  publicUrl: string;
}) {
  const weekRec = p.recs.week as Recording<WeekRun> | null | undefined;
  const playWeek = !!p.fallback.week && !!weekRec;
  const played = useRecording(weekRec ?? undefined, playWeek);
  const outRec = p.recs.outside as Recording<OutsideRun> | null | undefined;
  const playOut = !!p.fallback.outside && !!outRec;
  const outPlayed = useRecording(outRec ?? undefined, playOut);
  const attRec = p.recs.attacks as Recording<{ results: AttackResult[]; startedAt: string }> | null | undefined;
  const playAtt = !!p.fallback.attacks && !!attRec;
  const attPlayed = useRecording(attRec ?? undefined, playAtt);

  switch (p.beat.stage) {
    case "title":
      return (
        <div className="flex h-full flex-col justify-center px-[6vw]">
          <div className="flex items-center gap-[1.5vw]">
            <Target size={120} tone="chalk" />
            <p className="display text-[clamp(4rem,10vw,12rem)] leading-none">{PRODUCT_NAME}</p>
          </div>
          <p className={`mt-[2vw] max-w-[30ch] text-paper/90 ${css.title}`}>The open gate through which AI purchasing agents order food from a wholesaler.</p>
          <p className={`mt-[3vw] text-paper/70 ${css.body}`}>Junction 2026, Valio Aimo: Trusted Trade Agents. Demo on synthetic data.</p>
        </div>
      );
    case "sentence":
    case "close":
      return (
        <div className="flex h-full flex-col justify-center px-[6vw]">
          <p className="display max-w-[18ch] text-[clamp(3rem,7vw,9rem)] leading-[0.95]">{SENTENCE}</p>
          {p.beat.stage === "close" && <p className={`mt-[3vw] text-paper/80 ${css.lead}`}>{p.publicUrl}. Runs on Aiven, on MCP, OpenAPI, signed tokens and passkeys.</p>}
        </div>
      );
    case "week": {
      if (p.fallback.week) {
        if (weekRec === null) return <Missing what="the week" />;
        if (!played.data) return <Missing what="the week" loading />;
        return (
          <ClockOffset.Provider value={played.offset}>
            <WeekBoard run={played.data} />
          </ClockOffset.Provider>
        );
      }
      if (p.liveWeek) return <WeekBoard run={p.liveWeek} />;
      return (
        <div className="flex h-full flex-col justify-center px-[6vw]">
          <p className={`display ${css.day}`}>A week in a kitchen</p>
          <p className={`mt-4 max-w-[52ch] text-paper/85 ${css.lead}`}>
            {p.kitchen ? (
              <>
                Press Enter to play the week in {p.kitchen.name}. {p.kitchen.house ? "No phone has joined, so the sign-off will time out." : `${p.kitchen.approverName} signs on their phone.`}
              </>
            ) : (
              "No kitchen yet: scan the join QR code with the approver's phone, or press Enter to play it in a house kitchen nobody can sign for."
            )}
          </p>
        </div>
      );
    }
    case "attacks": {
      if (p.fallback.attacks) {
        if (attRec === null) return <Missing what="the attacks" />;
        return <AttackBoard attacks={p.attacks} results={attPlayed.data?.results ?? []} recording={attRec ? clock(attRec.capturedAt) : undefined} />;
      }
      return <AttackBoard attacks={p.attacks} results={p.results} busy={p.busyAttack} />;
    }
    case "outside": {
      if (p.fallback.outside) {
        if (outRec === null) return <Missing what="the outside agent" />;
        return (
          <ClockOffset.Provider value={outPlayed.offset}>
            <OutsideBoard run={outPlayed.data} />
          </ClockOffset.Provider>
        );
      }
      return <OutsideBoard run={p.outside} />;
    }
    case "board":
      return (
        <div className="flex h-full min-h-0 flex-col px-[clamp(0.9rem,2vw,2.6rem)] py-[clamp(0.6rem,1.4vw,1.8rem)]">
          <h2 className={`display ${css.day}`}>The crash test for AI buyers</h2>
          <div className="mt-4 min-h-0 flex-1 overflow-hidden">
            <CrashMatrix board={p.board} dark big maxRows={7} />
          </div>
        </div>
      );
  }
}

function Missing({ what, loading }: { what: string; loading?: boolean }) {
  return (
    <div className="flex h-full items-center px-[6vw]">
      <p className={`max-w-[50ch] ${css.lead}`}>{loading ? `Loading the recording of ${what}…` : `There is no recording of ${what} on this server yet. Run it live once (and for the week, press C to keep it).`}</p>
    </div>
  );
}

function Panel({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div role="dialog" aria-label={title} className="absolute inset-[4vh_4vw] overflow-auto bg-paper p-6 text-ink shadow-2xl">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="display text-[2.2rem]">{title}</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="text-petrol underline underline-offset-4">
            Close (Esc)
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Preflight({ checks, spend, checking, onClose, onModel }: { checks?: PreflightCheck[]; spend?: Spend; checking: boolean; onClose: () => void; onModel: () => void }) {
  const bad = checks?.filter((c) => c.state !== "ok") ?? [];
  return (
    <Panel title={checking ? "Preflight: checking…" : bad.length ? `Preflight: ${bad.length} thing${bad.length === 1 ? "" : "s"} to fix` : "Preflight: ready"} onClose={onClose}>
      <ul className="mt-4 divide-y divide-line">
        {(checks ?? []).map((c) => (
          <li key={c.id} className="grid grid-cols-[2rem_14rem_1fr] gap-3 py-2 text-[1.05rem]">
            <span aria-label={c.state} className={c.state === "ok" ? "text-petrol" : "font-bold text-safety-ink"}>
              {c.state === "ok" ? "✓" : c.state === "warn" ? "!" : "✕"}
            </span>
            <span className="font-semibold">{c.label}</span>
            <span>
              {c.detail}
              {c.fix && <strong className="block">{c.fix}</strong>}
            </span>
          </li>
        ))}
      </ul>
      {spend && (
        <p className="mt-4 text-[0.98rem] text-ink-soft">
          Today: {spend.weeks.used} of {spend.weeks.cap} weeks, {spend.outsideRuns.used} of {spend.outsideRuns.cap} outside-agent runs, model ${spend.modelUsd.used.toFixed(2)} of ${spend.modelUsd.cap.toFixed(2)}. Partner calls: {spend.partnerCalls.byShow} by the show, {spend.partnerCalls.byDock} by {PRODUCT_NAME} since start (ceiling {spend.partnerCalls.dailyCeiling} a day){spend.callsPerWeek !== null ? `, about ${spend.callsPerWeek} per week played` : ""}.
        </p>
      )}
      <p className="mt-4">
        <button type="button" onClick={onModel} className="text-petrol underline underline-offset-4">
          Also call the model once (Shift+P, under a cent)
        </button>
      </p>
    </Panel>
  );
}

function Kitchens({ kitchens, chosen, onPick }: { kitchens: KitchenRow[]; chosen?: string; onPick: (id: string) => void }) {
  return (
    <Panel title="Which kitchen plays the week">
      <p className="mt-2 text-ink-soft">The approver&apos;s phone joins by scanning the QR code on /join; its kitchen appears here. Kitchens live 90 minutes.</p>
      <ul className="mt-4 divide-y divide-line">
        {kitchens.length === 0 && <li className="py-2">No kitchen is open. Without one, the week plays in a house kitchen whose sign-off times out.</li>}
        {kitchens.map((k) => (
          <li key={k.sandboxId}>
            <button type="button" onClick={() => onPick(k.sandboxId)} className={`w-full py-2 text-left text-[1.05rem] ${k.sandboxId === chosen ? "font-bold text-petrol" : ""}`}>
              {k.name}, {k.city}: {k.house ? "house kitchen, no phone" : `${k.approverName}${k.passkey ? ", passkey" : ", no passkey"}`}; joined {clock(k.createdAt)}, closes {clock(k.expiresAt)}
              {k.week ? `; week ${k.week.state}` : ""}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Help() {
  const rows: [string, string][] = [
    ["→  Space  Page Down", "Next beat"],
    ["←  Page Up", "Previous beat"],
    ["Enter", "Run the beat: start the week, send in the outside agent"],
    ["W", "Start (or restart) the week now"],
    ["1 to 6", "Run an attack"],
    ["S, R", "Suspend the agent from the operations side; resume it"],
    ["A", "Send in the outside agent"],
    ["L", "The crash-test leaderboard"],
    ["F", "This act: switch between live and the recording of a real run"],
    ["C", "Keep the week just played as the week's recording"],
    ["X", "Stop the week (the kitchen is cleaned up)"],
    ["P, Shift+P", "Preflight (Shift: also call the model once)"],
    ["K", "Pick the kitchen (the phone that signs)"],
    ["N", "Hide or show this strip"],
    ["T", "Restart the timer"],
  ];
  return (
    <Panel title="Keys">
      <table className="mt-4 text-[1.05rem]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th className="py-1 pr-6 text-left font-semibold">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
