import type { TransitionPresentationComponentProps } from "@remotion/transitions";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { clamp } from "./anim";
import { C } from "./theme";

/**
 * The camera rig. The film is one world: every scene sits somewhere in it, and the joins between scenes are camera
 * moves over that world, not cuts. A move is a TransitionSeries presentation that places the two scenes where they
 * sit relative to each other and moves one virtual camera from the first to the second. Behind them, the world's
 * floor of light (World, below) moves with the same camera at a fraction of its speed: the depth layers give
 * parallax.
 *
 * - pan: the next scene lies beside, below or above this one (dx, dy in pixels); `floor` draws the floor the camera
 *   tilts down through on its way.
 * - zoom: the next scene is nested inside this one. `from` is a point in this scene, `to` the same object's point in
 *   the next, `s` how many times larger the object is here than there. The two scenes swap while the object they
 *   share is under the camera, so nothing else is ever read twice.
 */
export type Move = { kind: "through" } | { kind: "pan"; dx: number; dy: number; floor?: boolean } | { kind: "zoom"; from: [number, number]; to: [number, number]; s: number };

/** The camera's easing: a firm start and a long settle, the way a heavy camera head moves. */
export const CAM = Easing.bezier(0.55, 0, 0.18, 1);
const speed = (p: number) => (CAM(Math.min(1, p + 0.01)) - CAM(Math.max(0, p - 0.01))) / 0.02;

type PanProps = { dx: number; dy: number; floor?: boolean };
const Pan = ({ children, presentationDirection, presentationProgress, passedProps }: TransitionPresentationComponentProps<PanProps>) => {
  const e = CAM(presentationProgress);
  const { dx, dy, floor } = passedProps;
  const entering = presentationDirection === "entering";
  const x = entering ? dx * (1 - e) : -dx * e;
  const y = entering ? dy * (1 - e) : -dy * e;
  // A touch of blur only at the fastest frames of the move, along with it: the eye reads it as speed, not softness.
  const blur = Math.max(0, speed(presentationProgress) - 1.2) * 2.2;
  return (
    <AbsoluteFill style={{ transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`, filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined }}>
      {children}
      {floor && !entering && <Floor dy={dy} />}
    </AbsoluteFill>
  );
};

/** The floor between two levels of the world: a lit edge and a grid going away from it. */
const Floor = ({ dy }: { dy: number }) => {
  const down = dy > 0;
  const top = down ? 1080 + (dy - 1080) / 2 : -(Math.abs(dy) - 1080) / 2;
  return (
    <div style={{ position: "absolute", left: -200, width: 2320, top: top - 160, height: 320, pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, perspective: 900, perspectiveOrigin: "50% 50%" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 160, height: 900, transformOrigin: "50% 0", transform: "rotateX(78deg)", backgroundImage: `linear-gradient(rgb(192 224 33 / 0.32) 2px, transparent 2px), linear-gradient(90deg, rgb(192 224 33 / 0.32) 2px, transparent 2px)`, backgroundSize: "120px 120px", maskImage: "linear-gradient(to bottom, #000, transparent 70%)", WebkitMaskImage: "linear-gradient(to bottom, #000, transparent 70%)" }} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 158, height: 4, background: C.lime, boxShadow: "0 0 40px 6px rgb(192 224 33 / 0.55)", opacity: 0.85 }} />
    </div>
  );
};

type ZoomProps = { from: [number, number]; to: [number, number]; s: number };
const Zoom = ({ children, presentationDirection, presentationProgress, passedProps }: TransitionPresentationComponentProps<ZoomProps>) => {
  const e = CAM(presentationProgress);
  const { from, to, s } = passedProps;
  const entering = presentationDirection === "entering";
  // The camera's zoom moves on a log scale, so a pull-back feels even from start to end.
  const z = Math.pow(s, -e);
  const ax = from[0] + (to[0] - from[0]) * e;
  const ay = from[1] + (to[1] - from[1]) * e;
  const k = entering ? z * s : z;
  const o = entering ? to : from;
  const opacity = entering ? interpolate(e, [0.3, 0.58], [0, 1], clamp) : interpolate(e, [0.42, 0.72], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ transformOrigin: "0 0", transform: `translate(${(ax - k * o[0]).toFixed(2)}px, ${(ay - k * o[1]).toFixed(2)}px) scale(${k.toFixed(5)})`, opacity }}>
      {children}
    </AbsoluteFill>
  );
};

/** The old cut, kept where two worlds do not connect: the old scene is gone before the new one shows. */
const Through = ({ children, presentationDirection, presentationProgress }: TransitionPresentationComponentProps<Record<string, never>>) => {
  const entering = presentationDirection === "entering";
  const p = entering ? interpolate(presentationProgress, [0.5, 1], [0, 1], clamp) : interpolate(presentationProgress, [0, 0.5], [0, 1], clamp);
  const q = CAM(p);
  return <AbsoluteFill style={{ opacity: entering ? q : 1 - q, scale: String(entering ? 0.95 + 0.05 * q : 1 + 0.07 * q) }}>{children}</AbsoluteFill>;
};

/** One presentation for every move: it hands the progress to the move's own component. */
const Camera = (props: TransitionPresentationComponentProps<{ m: Move }>) => {
  const { m } = props.passedProps;
  if (m.kind === "pan") return <Pan {...props} passedProps={{ dx: m.dx, dy: m.dy, floor: m.floor }} />;
  if (m.kind === "zoom") return <Zoom {...props} passedProps={{ from: m.from, to: m.to, s: m.s }} />;
  return <Through {...props} passedProps={{}} />;
};
export const presentation = (m: Move) => ({ component: Camera, props: { m } });

/**
 * Where the world's camera is at a film frame, for the depth layers behind the scenes: summed over the moves made so
 * far. `moves` lists each move with the film frame it starts on and its length.
 */
export const worldCamera = (frame: number, moves: { at: number; dur: number; move: Move }[]) => {
  let x = 0;
  let y = 0;
  let s = 1;
  for (const { at, dur, move } of moves) {
    if (frame <= at) break;
    const e = CAM(Math.min(1, (frame - at) / dur));
    if (move.kind === "pan") {
      x -= move.dx * e;
      y -= move.dy * e;
    } else if (move.kind === "zoom") {
      s *= Math.pow(move.s, -e);
      x -= (move.to[0] - move.from[0]) * e;
      y -= (move.to[1] - move.from[1]) * e;
    }
  }
  return { x, y, s };
};

/** The near field repeats every 64 px, so it moves by transform (smooth below a pixel) and wraps unseen. */
const wrap = (v: number) => (((v % 64) + 64) % 64) - 64;

/**
 * The world behind the scenes: deep petrol, two far glows (a tenth of the camera's travel), and a near field of fine
 * points (a quarter of it). Scenes are drawn over it without a background of their own.
 */
export const World = ({ moves }: { moves: { at: number; dur: number; move: Move }[] }) => {
  const frame = useCurrentFrame();
  const cam = worldCamera(frame, moves);
  // A slow drift that never stops, so the world is never a still picture.
  const drift = frame * 0.35;
  const near = { x: cam.x * 0.25 - drift, y: cam.y * 0.25 };
  const far = { x: cam.x * 0.1 - drift * 0.4, y: cam.y * 0.1 };
  const ns = Math.pow(cam.s, 0.35);
  const fs = Math.pow(cam.s, 0.15);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(110% 85% at 50% 40%, #08495c 0%, ${C.petrolDeep} 50%, #01222c 100%)`, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: -1920, top: -1080, width: 5760, height: 3240, transform: `translate(${far.x.toFixed(2)}px, ${far.y.toFixed(2)}px) scale(${fs.toFixed(5)})` }}>
        {[
          [2300, 1300, 1100, "rgb(10 110 135 / 0.45)"],
          [3700, 1950, 900, "rgb(192 224 33 / 0.07)"],
          [1500, 2300, 1000, "rgb(8 90 112 / 0.4)"],
          [4300, 900, 1200, "rgb(10 110 135 / 0.35)"],
        ].map(([x, y, r, c], i) => (
          <div key={i} style={{ position: "absolute", left: (x as number) - (r as number) / 2, top: (y as number) - (r as number) / 2, width: r, height: r, borderRadius: "50%", background: `radial-gradient(circle, ${c} 0%, transparent 68%)` }} />
        ))}
      </div>
      <div style={{ position: "absolute", left: -1920, top: -1080, width: 5760, height: 3240, transform: `scale(${ns.toFixed(5)}) translate(${wrap(near.x).toFixed(2)}px, ${wrap(near.y).toFixed(2)}px)`, backgroundImage: "radial-gradient(circle, rgb(226 238 241 / 0.10) 1.3px, transparent 1.9px)", backgroundSize: "64px 64px" }} />
      <AbsoluteFill style={{ background: "radial-gradient(125% 95% at 50% 50%, transparent 55%, rgb(0 14 18 / 0.55) 100%)" }} />
    </AbsoluteFill>
  );
};
