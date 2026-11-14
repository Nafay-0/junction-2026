import type { CSSProperties, ReactNode } from "react";
import type { TransitionPresentationComponentProps } from "@remotion/transitions";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IO = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 → 1 from `at` over `dur` frames, eased out. */
export const prog = (frame: number, at: number, dur = 18) => interpolate(frame, [at, at + dur], [0, 1], { ...clamp, easing: EASE });
/** 1 → 0 from `at` over `dur` frames. */
export const fall = (frame: number, at: number, dur = 10) => interpolate(frame, [at, at + dur], [1, 0], { ...clamp, easing: EASE_IO });

/** The film's three durations, in frames. */
export const Q = 12;
export const M = 18;
export const L = 30;

/** Arrives with a short travel and opacity at `at`; with `exit`, leaves the same way before the next thing arrives. */
export const Rise = ({ at, dur = M, y = 26, x = 0, exit, exitDur = Q, children, style }: { at: number; dur?: number; y?: number; x?: number; exit?: number; exitDur?: number; children: ReactNode; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, at, dur);
  const q = exit === undefined ? 0 : interpolate(frame, [exit, exit + exitDur], [0, 1], { ...clamp, easing: EASE_IO });
  if (frame < at - 1 || q >= 1) return null;
  return <div style={{ opacity: p * (1 - q), translate: `${(1 - p) * x}px ${(1 - p) * y - q * 14}px`, ...style }}>{children}</div>;
};

/** Grows from no height to its content's height at `at`, pushing what is above it: a new line arriving in a thread. */
export const Grow = ({ at, dur = 16, children, style }: { at: number; dur?: number; children: ReactNode; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, at, dur);
  if (frame < at) return null;
  return (
    <div style={{ display: "grid", gridTemplateRows: `${p}fr`, opacity: interpolate(frame, [at + 2, at + dur], [0, 1], clamp), ...style }}>
      <div style={{ minHeight: 0, overflow: "hidden" }}>{children}</div>
    </div>
  );
};

/** The reverse: folds away from `at`, pulling what is above it down. */
export const Shrink = ({ at, dur = 12, children }: { at: number; dur?: number; children: ReactNode }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, at, dur);
  if (frame >= at + dur) return null;
  return (
    <div style={{ display: "grid", gridTemplateRows: `${1 - p}fr`, opacity: 1 - p }}>
      <div style={{ minHeight: 0, overflow: "hidden" }}>{children}</div>
    </div>
  );
};

/** Text typed a character at a time from `at`. */
export const Typed = ({ text, at, perFrame = 1.1, caret = true }: { text: string; at: number; perFrame?: number; caret?: boolean }) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor((frame - at) * perFrame)));
  const typing = frame >= at && n < text.length;
  return (
    <>
      {text.slice(0, n)}
      {caret && (typing || (frame >= at && Math.floor(frame / 15) % 2 === 0 && n < text.length)) && <span style={{ opacity: 0.6 }}>|</span>}
    </>
  );
};

/** A number counting up from 0 to `to` between `at` and `at + dur`. */
export const Count = ({ to, at, dur = 30, format }: { to: number; at: number; dur?: number; format?: (n: number) => string }) => {
  const frame = useCurrentFrame();
  const v = Math.round(interpolate(frame, [at, at + dur], [0, to], { ...clamp, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }));
  return <>{format ? format(v) : v}</>;
};

/** Finnish-style thousands: 17 546. */
export const fi = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** A slow push toward the picture for the length of the scene: nothing sits still. */
export const Drift = ({ children, by = 0.025, origin = "50% 50%" }: { children: ReactNode; by?: number; origin?: string }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <AbsoluteFill style={{ scale: String(1 + by * EASE_IO(frame / durationInFrames) * 0.5 + by * 0.5 * (frame / durationInFrames)), transformOrigin: origin, willChange: "transform" }}>{children}</AbsoluteFill>;
};

/**
 * The film's one transition, a push-through on the beat: the old scene pushes toward the camera and clears, then the
 * new one settles in from behind it. The two never show their words over each other.
 */
const Through = ({ children, presentationDirection, presentationProgress }: TransitionPresentationComponentProps<Record<string, never>>) => {
  const entering = presentationDirection === "entering";
  // The old scene is fully gone before the new one starts to show: never two scenes on screen at once.
  const p = entering ? interpolate(presentationProgress, [0.5, 1], [0, 1], clamp) : interpolate(presentationProgress, [0, 0.5], [0, 1], clamp);
  return <AbsoluteFill style={{ opacity: entering ? p : 1 - p, scale: String(entering ? 0.94 + 0.06 * EASE(p) : 1 + 0.08 * EASE_IO(p)) }}>{children}</AbsoluteFill>;
};
export const through = () => ({ component: Through, props: {} });

/** A point on a cubic curve. */
export const bez = (p: number[][], t: number): [number, number] => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]) as [number, number];
};

/**
 * A line in a diagram (inside an svg): it draws on from `at` with a moving head; once drawn, with `every` set, a token
 * travels along it again and again (`back` sends it the other way).
 */
export const Wire = ({ pts, at, dur = M, color = "#c0e021", width = 3, every = 0, offset = 0, back = false, rest = 0.5 }: { pts: number[][]; at: number; dur?: number; color?: string; width?: number; every?: number; offset?: number; back?: boolean; rest?: number }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, at, dur);
  if (frame < at) return null;
  const d = `M ${pts[0]} C ${pts[1]}, ${pts[2]}, ${pts[3]}`;
  const head = bez(pts, p);
  const run = every > 0 && frame > at + dur;
  const u = run ? EASE_IO((((frame - at - dur + offset) % every) + every) % every / every) : 0;
  const tok = bez(pts, back ? 1 - u : u);
  return (
    <>
      <path d={d} fill="none" stroke={color} strokeOpacity={rest} strokeWidth={width} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
      {p > 0 && p < 1 && <circle cx={head[0]} cy={head[1]} r={width * 2} fill={color} />}
      {run && <circle cx={tok[0]} cy={tok[1]} r={width * 2.2} fill={color} opacity={Math.sin(u * Math.PI) ** 0.5} />}
    </>
  );
};
