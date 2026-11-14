import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, EASE, prog, Rise } from "../anim";
import { C, display, sans } from "../theme";
import { Ground } from "../ui";
import { cue } from "../vo";

const HIT = cue("title", "AimoPilot", -5);
const LINE = cue("title", "Let AI", -4);
const BUILT = cue("title", "Built for", -4);

/** The name arrives on the music's lift, with scale and light; then the line; then who it was built for. */
export const Title = () => {
  const frame = useCurrentFrame();
  const hit = interpolate(frame, [HIT - 6, HIT + 16], [0, 1], { ...clamp, easing: EASE });
  const bloom = interpolate(frame, [HIT - 6, HIT + 3, HIT + 46], [0, 0.6, 0], clamp);
  const glow = interpolate(frame, [HIT, HIT + 30, HIT + 240], [0, 1, 0.7], clamp);
  return (
    <AbsoluteFill>
      <Ground>
        <div style={{ position: "absolute", left: 960 - 900, top: 430 - 900, width: 1800, height: 1800, borderRadius: "50%", background: "radial-gradient(closest-side, rgb(192 224 33 / 0.55), rgb(192 224 33 / 0.12) 45%, transparent 70%)", opacity: bloom, scale: String(interpolate(frame, [HIT - 6, HIT + 46], [0.35, 1.25], clamp)) }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 46, opacity: interpolate(frame, [HIT - 6, HIT + 2], [0, 1], clamp), scale: String(1.32 - 0.32 * hit) }}>
            <span style={{ width: 150, height: 150, borderRadius: "32%", background: "rgb(255 255 255 / 0.13)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ width: 70, height: 70, borderRadius: "50%", background: C.lime, boxShadow: `0 0 0 ${10 + glow * 10}px rgb(192 224 33 / ${0.12 + glow * 0.16}), 0 0 ${60 + glow * 90}px ${glow * 22}px rgb(192 224 33 / ${0.25 + glow * 0.3})` }} />
            </span>
            <span style={{ ...display, fontSize: 236, fontWeight: 700, letterSpacing: `${-0.03 + 0.03 * (1 - hit)}em`, color: C.paper, lineHeight: 1 }}>AimoPilot</span>
          </div>
          <Rise at={LINE} dur={20} style={{ ...display, fontSize: 84, color: C.paper, marginTop: 64 }}>
            Let AI do the buying. Keep the last word.
          </Rise>
          <Rise at={BUILT} dur={20} style={{ ...sans, fontSize: 38, color: "rgb(255 255 255 / 0.72)", marginTop: 44 }}>
            Built for Valio Aimo at Junction 2026.
          </Rise>
        </div>
        <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: prog(frame, HIT - 3, 3) * interpolate(frame, [HIT, HIT + 10], [0.16, 0], clamp) }} />
      </Ground>
    </AbsoluteFill>
  );
};
