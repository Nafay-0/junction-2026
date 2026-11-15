import { Video } from "@remotion/media";
import type { ReactNode } from "react";
import { AbsoluteFill, Easing, Freeze, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, display, sans } from "../theme";
import { IconLock, PilotLight } from "../ui";
import clips from "./clips.json";
import { FPS } from "./timeline";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IO = Easing.bezier(0.65, 0, 0.35, 1);
type ClipInfo = { seconds: number; events: Record<string, number>; what: string };
export const CLIPS = clips as unknown as Record<string, ClipInfo>;
export const FILM_SECONDS = 118.0;

/** The frame the clips sit in: a light window on the deep petrol ground, below a label row. */
export const FRAME = { x: 120, y: 84, w: 1680, h: 945, bar: 34 } as const;
/** Largest push-in that keeps the 1920-wide capture at or under its own pixels. */
export const MAX_ZOOM = 1920 / FRAME.w;
/** Frames a new shot fades in over the one before it. */
export const OVER = 8;

/** The source second at which `clip`'s first event whose name starts with `name` happens. */
export function ev(clip: string, name: string): number {
  const c = CLIPS[clip];
  if (!c) throw new Error(`No clip ${clip}`);
  const k = Object.keys(c.events).find((n) => n.startsWith(name));
  if (k === undefined) throw new Error(`Clip ${clip} has no event "${name}"`);
  return c.events[k];
}
export const has = (clip: string) => !!CLIPS[clip];
const lengthOf = (clip: string) => (clip === "film" ? FILM_SECONDS : CLIPS[clip].seconds);
const srcOf = (clip: string) => (clip === "film" ? staticFile("demo-film.mp4") : staticFile(`demo-clips/${clip}.mp4`));

export type Zoom = { at: number; s: number; x: number; y: number; dur?: number };
export type Shot = {
  /** A clip name from clips.json, "film" (the two-minute film, video only) or "placeholder". */
  clip: string;
  /** Absolute frame the shot starts on; it lasts until the next shot starts. */
  at: number;
  /** Source second to start from (default 0) and the rate to play at (default 1). */
  from?: number;
  rate?: number;
  /** Anchors [source second, absolute frame]: that moment of the clip is on screen on that frame. Overrides from/rate. */
  sync?: [number, number][];
  /** Freeze from this source second on (default: the clip's end). */
  until?: number;
  label?: string;
  url?: string;
  /** Full frame, no window (the film's segments). */
  full?: boolean;
  zoom?: Zoom[];
  /** For a placeholder: what the picture will be. */
  what?: string;
  /** Areas of the clip (in its own 1920 x 1080 pixels) painted over in the page's own colour: content that belongs to a later chapter. */
  masks?: { x: number; y: number; w: number; h: number; color: string; fade?: number }[];
};
type Piece = { start: number; dur: number; src: number; rate: number }; // rate 0: a held frame

const MIN_RATE = 0.9;
const MAX_RATE = 1.5;

/** A shot's pieces, in frames relative to the shot's start: plays, speed-ups within limits, held frames. */
export function piecesOf(shot: Shot, dur: number): Piece[] {
  const end = Math.max(0, (shot.until ?? lengthOf(shot.clip)) - 1 / FPS - 0.02);
  const out: Piece[] = [];
  const play = (start: number, frames: number, src: number, rate: number) => {
    if (frames <= 0) return;
    const playable = Math.max(0, Math.floor(((end - src) / rate) * FPS));
    const p = Math.min(frames, playable);
    if (p > 0) out.push({ start, dur: p, src, rate });
    if (frames > p) out.push({ start: start + p, dur: frames - p, src: Math.min(end, src + (p * rate) / FPS), rate: 0 });
  };
  if (!shot.sync?.length) {
    play(0, dur, shot.from ?? 0, shot.rate ?? 1);
    return out;
  }
  const anchors = shot.sync.map(([s, f]) => [s, f - shot.at] as [number, number]).sort((a, b) => a[1] - b[1]);
  // Before the first anchor: real time, holding the first frame if the clip would have to start before its own start.
  const [s0, f0] = anchors[0];
  if (f0 > 0) {
    const base = shot.from ?? 0;
    const from = s0 - f0 / FPS;
    if (from >= base) play(0, f0, from, 1);
    else {
      const lead = Math.max(0, Math.round((s0 - base) * FPS));
      out.push({ start: 0, dur: f0 - lead, src: base, rate: 0 });
      play(f0 - lead, lead, base, 1);
    }
  }
  for (let i = 0; i < anchors.length; i++) {
    const [sa, fa] = anchors[i];
    const next = anchors[i + 1];
    const fb = next ? Math.min(next[1], dur) : dur;
    if (fb <= fa) continue;
    if (!next) {
      play(fa, fb - fa, sa, 1);
      continue;
    }
    const sb = next[0];
    const frames = fb - fa;
    const rate = (sb - sa) / (frames / FPS);
    if (rate >= MIN_RATE && rate <= MAX_RATE) play(fa, frames, sa, rate);
    else if (rate < MIN_RATE) {
      // Not enough happens in the clip: play at real time, then hold on the anchor's frame.
      const p = Math.round((sb - sa) * FPS);
      play(fa, p, sa, 1);
      out.push({ start: fa + p, dur: frames - p, src: sb, rate: 0 });
    } else {
      // Too much happens: the most a viewer can follow, then a cut to the anchor.
      play(fa, frames, sb - (frames / FPS) * MAX_RATE, MAX_RATE);
    }
  }
  return out;
}

const zoomAt = (zooms: Zoom[] | undefined, frame: number) => {
  let st = { s: 1, x: 0.5, y: 0.5 };
  for (const z of zooms ?? []) {
    if (frame < z.at) break;
    const t = interpolate(frame, [z.at, z.at + (z.dur ?? 36)], [0, 1], { ...clamp, easing: EASE_IO });
    const s = Math.min(MAX_ZOOM, z.s);
    st = { s: st.s + (s - st.s) * t, x: st.x + (z.x - st.x) * t, y: st.y + (z.y - st.y) * t };
  }
  return st;
};

const ClipPieces = ({ shot, dur }: { shot: Shot; dur: number }) => {
  const src = srcOf(shot.clip);
  return (
    <>
      {piecesOf(shot, dur).map((p, i) => (
        <Sequence key={i} from={p.start} durationInFrames={p.dur} premountFor={45}>
          {p.rate === 0 ? (
            <Freeze frame={0}>
              <Video src={src} muted trimBefore={Math.round(p.src * FPS)} style={{ width: "100%", height: "100%" }} />
            </Freeze>
          ) : (
            <Video src={src} muted trimBefore={Math.round(p.src * FPS)} playbackRate={p.rate} style={{ width: "100%", height: "100%" }} />
          )}
        </Sequence>
      ))}
    </>
  );
};

export const Placeholder = ({ title, what }: { title: string; what?: string }) => (
  <AbsoluteFill style={{ background: `linear-gradient(160deg, ${C.mist}, ${C.petrolSoft})`, alignItems: "center", justifyContent: "center", ...sans }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14, color: C.petrol, fontSize: 26, fontWeight: 650, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      <PilotLight size={26} /> Screen recording to come
    </div>
    <div style={{ ...display, fontSize: 84, color: C.petrolDeep, marginTop: 26 }}>{title}</div>
    {what ? <div style={{ fontSize: 32, color: C.inkSoft, marginTop: 22, maxWidth: 1200, textAlign: "center", lineHeight: 1.4 }}>{what}</div> : null}
  </AbsoluteFill>
);

/** One shot inside the window (or full frame), with its push-ins; it fades in over the shot before it. */
export const ShotView = ({ shot, dur, title, fadeIn }: { shot: Shot; dur: number; title: string; fadeIn: boolean }) => {
  const f = useCurrentFrame();
  const o = fadeIn ? interpolate(f, [0, OVER], [0, 1], clamp) : 1;
  const z = zoomAt(shot.zoom?.map((k) => ({ ...k, at: k.at - shot.at })), f);
  const inner =
    shot.clip === "placeholder" ? (
      <Placeholder title={title} what={shot.what} />
    ) : (
      <AbsoluteFill style={{ transformOrigin: `${z.x * 100}% ${z.y * 100}%`, scale: String(z.s) }}>
        <ClipPieces shot={shot} dur={dur} />
        {(shot.masks ?? []).map((m, i) => (
          <div key={i} style={{ position: "absolute", left: `${(m.x / 1920) * 100}%`, top: `${(m.y / 1080) * 100}%`, width: `${(m.w / 1920) * 100}%`, height: `${(m.h / 1080) * 100}%`, background: `linear-gradient(to bottom, transparent, ${m.color} ${m.fade ?? 36}px)` }} />
        ))}
      </AbsoluteFill>
    );
  if (shot.full) return <AbsoluteFill style={{ opacity: o, overflow: "hidden", background: C.petrolDeep }}>{inner}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <div style={{ position: "absolute", left: FRAME.x, top: FRAME.y, width: FRAME.w, height: FRAME.h + FRAME.bar, borderRadius: 14, overflow: "hidden", background: C.paper, boxShadow: "0 40px 100px -30px rgb(0 20 28 / 0.7)" }}>
        <div style={{ height: FRAME.bar, background: "#e6edef", display: "flex", alignItems: "center", padding: "0 14px", gap: 7, borderBottom: `1px solid ${C.line}` }}>
          {["#f26d5f", "#f5bf4f", "#5fcb58"].map((c) => (
            <span key={c} style={{ width: 11, height: 11, borderRadius: "50%", background: c, opacity: 0.85 }} />
          ))}
          <div style={{ ...sans, margin: "0 auto", translate: "-24px 0", minWidth: 440, height: 24, borderRadius: 12, background: C.paper, color: C.inkSoft, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "0 14px" }}>
            <IconLock size={11} color={C.inkFaint} />
            {shot.url ?? "aimopilot.zeroanomaly.tech"}
          </div>
        </div>
        <div style={{ position: "relative", width: FRAME.w, height: FRAME.h, overflow: "hidden" }}>{inner}</div>
      </div>
    </AbsoluteFill>
  );
};

/** The label of what is on screen, top left, over the window. */
export const Label = ({ text }: { text: string }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 10], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", left: FRAME.x, top: 22, height: 44, display: "flex", alignItems: "center", gap: 12, opacity: o, ...sans, color: C.paper, fontSize: 25, fontWeight: 650 }}>
      <span style={{ width: 11, height: 11, borderRadius: "50%", background: C.lime, boxShadow: "0 0 0 5px rgb(192 224 33 / 0.18)" }} />
      {text}
    </div>
  );
};

/** The note that stays: top right. */
export const Corner = () => (
  <div style={{ position: "absolute", right: FRAME.x, top: 22, height: 44, display: "flex", alignItems: "center", gap: 10, ...sans, color: "rgb(255 255 255 / 0.62)", fontSize: 20, fontWeight: 500 }}>
    <PilotLight size={20} onDark /> AimoPilot · demo on synthetic data
  </div>
);

export type Callout = { at: number; text: string; dur?: number; pos?: "tl" | "tr" | "bl" | "br" | "bc" };
/** A one-line callout timed to the narrator's words, inside the window's corner. */
export const CalloutView = ({ c, dur }: { c: Callout; dur: number }) => {
  const f = useCurrentFrame();
  const inn = interpolate(f, [0, 14], [0, 1], { ...clamp, easing: EASE });
  const out = interpolate(f, [dur - 10, dur], [1, 0], clamp);
  const pos = c.pos ?? "br";
  const m = 34;
  const place: Record<string, React.CSSProperties> = {
    tl: { left: FRAME.x + m, top: FRAME.y + FRAME.bar + m },
    tr: { right: 1920 - FRAME.x - FRAME.w + m, top: FRAME.y + FRAME.bar + m },
    bl: { left: FRAME.x + m, bottom: 1080 - FRAME.y - FRAME.bar - FRAME.h + m },
    br: { right: 1920 - FRAME.x - FRAME.w + m, bottom: 1080 - FRAME.y - FRAME.bar - FRAME.h + m },
    bc: { left: "50%", bottom: 1080 - FRAME.y - FRAME.bar - FRAME.h + m, translate: "-50% 0" },
  };
  return (
    <div style={{ position: "absolute", ...place[pos], opacity: inn * out, display: "flex", alignItems: "stretch", borderRadius: 14, overflow: "hidden", background: "rgb(26 29 33 / 0.94)", boxShadow: "0 18px 40px -16px rgb(0 0 0 / 0.55)", transform: `translateY(${(1 - inn) * 18}px)` }}>
      <span style={{ width: 8, background: C.lime }} />
      <span style={{ ...sans, color: C.chalk, fontSize: 31, fontWeight: 600, padding: "18px 28px 18px 22px", whiteSpace: "nowrap" }}>{c.text}</span>
    </div>
  );
};

/** The chapter card: its number and name, under two seconds, then it lifts away. */
export const ChapterCard = ({ n, title, len }: { n: number; title: string; len: number }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [len - 14, len], [1, 0], clamp);
  const rise = interpolate(f, [0, 20], [0, 1], { ...clamp, easing: EASE });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 120% at 20% 10%, ${C.petrol}, ${C.petrolDeep} 60%, #00222d)`, opacity: o, justifyContent: "center", paddingLeft: 180 }}>
      <div style={{ opacity: rise, translate: `0 ${(1 - rise) * 24}px` }}>
        <div style={{ ...sans, color: C.lime, fontSize: 34, fontWeight: 700, letterSpacing: "0.12em" }}>{String(n).padStart(2, "0")}</div>
        <div style={{ ...display, color: C.paper, fontSize: 140, marginTop: 14 }}>{title}</div>
        <div style={{ width: interpolate(f, [4, 30], [0, 220], { ...clamp, easing: EASE }), height: 6, borderRadius: 3, background: C.lime, marginTop: 40 }} />
      </div>
    </AbsoluteFill>
  );
};

export const Ground = ({ children }: { children?: ReactNode }) => (
  <AbsoluteFill style={{ background: `radial-gradient(140% 120% at 30% 0%, #0a4a5e, ${C.petrolDeep} 55%, #00222d)` }}>{children}</AbsoluteFill>
);

/** The end card: the mark, the name, the address, the note. */
export const EndCard = () => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 22], [0, 1], { ...clamp, easing: EASE });
  const b = interpolate(f, [12, 34], [0, 1], { ...clamp, easing: EASE });
  const glow = interpolate(f, [10, 60], [0, 1], clamp);
  return (
    <Ground>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: a }}>
        <div style={{ display: "flex", alignItems: "center", gap: 40, scale: String(0.95 + 0.05 * a) }}>
          <span style={{ width: 128, height: 128, borderRadius: "32%", background: "rgb(255 255 255 / 0.13)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 60, height: 60, borderRadius: "50%", background: C.lime, boxShadow: `0 0 0 ${8 + glow * 9}px rgb(192 224 33 / ${0.14 + glow * 0.14}), 0 0 ${50 + glow * 80}px ${glow * 20}px rgb(192 224 33 / ${0.25 + glow * 0.3})` }} />
          </span>
          <span style={{ ...display, fontSize: 200, fontWeight: 700, letterSpacing: "-0.03em", color: C.paper, lineHeight: 1 }}>AimoPilot</span>
        </div>
        <div style={{ opacity: b, marginTop: 64, height: 84, padding: "0 46px", borderRadius: 42, background: C.lime, color: C.ink, display: "flex", alignItems: "center", ...sans, fontSize: 44, fontWeight: 700 }}>aimopilot.zeroanomaly.tech</div>
        <div style={{ opacity: b, ...sans, fontSize: 30, color: "rgb(255 255 255 / 0.7)", marginTop: 34 }}>Built for Valio Aimo at Junction 2026. Demo on synthetic data.</div>
      </AbsoluteFill>
    </Ground>
  );
};
