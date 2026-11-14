import type { CSSProperties, ReactNode } from "react";
import type { TransitionPresentationComponentProps } from "@remotion/transitions";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IO = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 → 1 from `at` over `dur` frames, eased out. */
export const prog = (frame: number, at: number, dur = 18) => interpolate(frame, [at, at + dur], [0, 1], { ...clamp, easing: EASE });
/** 1 → 0 from `at` over `dur` frames. */
export const fall = (frame: number, at: number, dur = 10) => interpolate(frame, [at, at + dur], [1, 0], clamp);

/** Fades and rises in at `at`; with `exit`, fades out there. */
export const Rise = ({ at, dur = 18, y = 26, exit, exitDur = 10, children, style }: { at: number; dur?: number; y?: number; exit?: number; exitDur?: number; children: ReactNode; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, at, dur);
  const o = exit === undefined ? p : p * fall(frame, exit, exitDur);
  return <div style={{ opacity: o, translate: `0px ${(1 - p) * y}px`, ...style }}>{children}</div>;
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
  return <AbsoluteFill style={{ scale: String(1 + by * (frame / durationInFrames)), transformOrigin: origin }}>{children}</AbsoluteFill>;
};

/** The film's one transition: the old scene pushes toward the camera while the new one settles in from behind it. */
const Through = ({ children, presentationDirection, presentationProgress }: TransitionPresentationComponentProps<Record<string, never>>) => {
  const p = EASE_IO(presentationProgress);
  const entering = presentationDirection === "entering";
  return <AbsoluteFill style={{ opacity: entering ? presentationProgress : 1, scale: String(entering ? 0.955 + 0.045 * p : 1 + 0.05 * p) }}>{children}</AbsoluteFill>;
};
export const through = () => ({ component: Through, props: {} });
