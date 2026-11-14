import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, EASE, prog, Rise } from "../anim";
import { C, display, sans } from "../theme";
import { Ground } from "../ui";
import { cue } from "../vo";

const NAME = cue("title", "AimoPilot", -6);
const LINE = cue("title", "Let AI", -4);
const BUILT = cue("title", "Built for", -4);

/** The name, the line, who it was built for. */
export const Title = () => {
  const frame = useCurrentFrame();
  const lamp = prog(frame, 2, 22);
  const glow = interpolate(frame, [NAME, NAME + 40, NAME + 240], [0, 1, 0.75], clamp);
  return (
    <AbsoluteFill>
      <Ground>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 46 }}>
            <span style={{ width: 150, height: 150, borderRadius: "32%", background: "rgb(255 255 255 / 0.13)", display: "flex", alignItems: "center", justifyContent: "center", scale: String(interpolate(frame, [2, 26], [0.5, 1], { ...clamp, easing: EASE })), opacity: lamp }}>
              <span style={{ width: 70, height: 70, borderRadius: "50%", background: C.lime, boxShadow: `0 0 0 ${10 + glow * 10}px rgb(192 224 33 / ${0.12 + glow * 0.16}), 0 0 ${60 + glow * 90}px ${glow * 22}px rgb(192 224 33 / ${0.25 + glow * 0.3})` }} />
            </span>
            <Rise at={NAME} dur={22} y={0} style={{ ...display, fontSize: 236, fontWeight: 700, letterSpacing: "-0.03em", color: C.paper, lineHeight: 1 }}>
              AimoPilot
            </Rise>
          </div>
          <Rise at={LINE} dur={22} style={{ ...display, fontSize: 84, color: C.paper, marginTop: 64 }}>
            Let AI do the buying. Keep the last word.
          </Rise>
          <Rise at={BUILT} dur={22} style={{ ...sans, fontSize: 38, color: "rgb(255 255 255 / 0.72)", marginTop: 44 }}>
            The open loading dock for AI buyers. Built for Valio Aimo at Junction 2026.
          </Rise>
        </div>
      </Ground>
    </AbsoluteFill>
  );
};
