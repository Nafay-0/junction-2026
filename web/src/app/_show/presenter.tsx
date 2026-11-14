"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../_client/api";
import { PRODUCT_NAME } from "../_ui/brand";
import { clock } from "../_ui/plain";
import { Check, CircleAlert, X } from "lucide-react";
import { Kbd } from "../_ui/kit";
import { PilotLight } from "../_ui/wordmark";
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
          <p role="status" className={`absolute left-1/2 top-[clamp(0.6rem,1vw,1.2rem)] z-10 flex max-w-[min(90vw,70rem)] -translate-x-1/2 items-center gap-[0.6em] rounded-full bg-paper px-[1.1em] py-[0.5em] font-semibold text-ink shadow-lg ${css.body}`}>
            <CircleAlert aria-hidden className="size-[1.1em] shrink-0 text-notice" />
            {problem}
          </p>
        )}
        {overlay === "preflight" && <Preflight checks={checks} spend={spend} checking={checking} onClose={() => setOverlay("none")} onModel={() => void runPreflight(true)} />}
        {overlay === "kitchens" && <Kitchens kitchens={kitchens} chosen={sandboxId} onPick={(id) => (setSandboxId(id), setOverlay("none"))} />}
        {overlay === "help" && <Help />}
      </main>
      {notes && (
        <footer className="shrink-0 border-t border-paper/10 bg-ink text-paper">
          <div className="grid gap-x-8 gap-y-2 px-5 py-3.5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] [@media(max-height:860px)]:py-2.5">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.85rem] text-paper/70">
                <span className="rounded-full bg-paper/10 px-2.5 font-semibold leading-6 text-paper tabular">
                  {beat + 1} of {BEATS.length}
                </span>
                {current.act}. Speaker {current.speaker}.
              </p>
              <p className="display mt-1 text-[1.5rem] [@media(max-height:860px)]:text-[1.2rem]">{current.title}</p>
              <p className="mt-1 max-w-[110ch] text-[1.05rem] leading-snug [@media(max-height:860px)]:text-[0.92rem]">{current.say}</p>
              <p className="mt-1 text-[0.92rem] text-paper/70 [@media(max-height:860px)]:line-clamp-1 [@media(max-height:860px)]:text-[0.82rem]">What happens: {current.happens}</p>
            </div>
            <div className="min-w-0 space-y-2.5 text-[0.92rem]">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className={`display tabular text-[1.9rem] leading-none ${elapsed > TOTAL_SECONDS ? "text-safety" : "text-lime"}`}>{mmss(elapsed)}</span>
                <span className="text-paper/70">of 3:00</span>
                <span className="tabular text-paper/85">
                  this beat {mmss(beatElapsed)} of {mmss(current.seconds)}
                </span>
              </p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Dependencies">
                {(["partner", "phone", "model", "database"] as Dep[]).map((d) => (
                  <li key={d} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 leading-7 ${current.deps.includes(d) ? "bg-paper/10" : "text-paper/50"}`}>
                    <span aria-hidden className={`size-2 rounded-full ${depState[d] === "ok" ? "bg-lime" : depState[d] === "fail" || depState[d] === "warn" ? "bg-safety" : "bg-paper/35"}`} />
                    <span className="sr-only">{depState[d]}: </span>
                    {DEP_LABEL[d]}
                    {d === "phone" && kitchen ? `: ${kitchen.approverName}` : ""}
                  </li>
                ))}
              </ul>
              <p className="text-paper/70">
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
          <div className="flex items-center gap-[1.6vw]">
            <PilotLight size="clamp(3.4rem,8vw,9.5rem)" onDark />
            <p className="display text-[clamp(4rem,10vw,12rem)] leading-none" style={{ fontWeight: 700, letterSpacing: "-0.035em" }}>
              {PRODUCT_NAME}
            </p>
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
          <div className="mt-[clamp(0.8rem,1.4vw,1.8rem)] min-h-0 flex-1 overflow-hidden rounded-[clamp(18px,1.6vw,32px)] bg-paper/[0.05] p-[clamp(0.9rem,1.6vw,2rem)] ring-1 ring-inset ring-paper/10">
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
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-petrol-deep/60 p-[4vh_4vw] backdrop-blur-[2px]">
      <div role="dialog" aria-label={title} className="sheet-up max-h-full w-full max-w-[72rem] overflow-auto rounded-2xl bg-paper p-7 text-ink shadow-lg">
        <div className="flex items-center justify-between gap-4">
          <h2 className="display text-[2rem]">{title}</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line-strong px-4 text-[0.95rem] font-semibold hover:bg-mist">
              Close <Kbd>Esc</Kbd>
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function Preflight({ checks, spend, checking, onClose, onModel }: { checks?: PreflightCheck[]; spend?: Spend; checking: boolean; onClose: () => void; onModel: () => void }) {
  const bad = checks?.filter((c) => c.state !== "ok") ?? [];
  return (
    <Panel title={checking ? "Preflight: checking…" : bad.length ? `Preflight: ${bad.length} thing${bad.length === 1 ? "" : "s"} to fix` : "Preflight: ready"} onClose={onClose}>
      <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {(checks ?? []).map((c) => (
          <li key={c.id} className="grid grid-cols-[2rem_14rem_1fr] items-start gap-3 px-4 py-3 text-[1.02rem]">
            <span aria-label={c.state} className={`mt-0.5 flex size-6 items-center justify-center rounded-full ${c.state === "ok" ? "bg-good-soft text-good" : c.state === "warn" ? "bg-safety-soft text-safety-ink" : "bg-safety-ink text-safety"}`}>
              {c.state === "ok" ? <Check aria-hidden size={14} strokeWidth={3} /> : c.state === "warn" ? <CircleAlert aria-hidden size={14} /> : <X aria-hidden size={14} strokeWidth={3} />}
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
        <button type="button" onClick={onModel} className="inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 font-semibold hover:bg-mist">
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
      <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {kitchens.length === 0 && <li className="px-4 py-3">No kitchen is open. Without one, the week plays in a house kitchen whose sign-off times out.</li>}
        {kitchens.map((k) => (
          <li key={k.sandboxId}>
            <button type="button" onClick={() => onPick(k.sandboxId)} aria-pressed={k.sandboxId === chosen} className={`w-full rounded-none px-4 py-3 text-left text-[1.02rem] transition-colors hover:bg-mist ${k.sandboxId === chosen ? "bg-petrol-soft font-semibold text-petrol-deep" : ""}`}>
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
      <table className="mt-5 w-full text-[1.02rem]">
        <tbody className="divide-y divide-line">
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th className="whitespace-nowrap py-2 pr-8 text-left align-top font-normal">
                <span className="inline-flex flex-wrap gap-1">
                  {k.split(/\s{2,}|, /).map((x) => (
                    <Kbd key={x}>{x}</Kbd>
                  ))}
                </span>
              </th>
              <td className="py-2">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
