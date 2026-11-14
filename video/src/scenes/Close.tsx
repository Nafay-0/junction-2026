import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clamp, EASE, EASE_IO, fall, prog, Rise } from "../anim";
import { C, display, sans } from "../theme";
import { BrowserFrame, Ground } from "../ui";
import { cue } from "../vo";

const c = (phrase: string, shift = 0) => cue("close", phrase, shift);
const T = { agent: c("every agent", -4), decision: c("every decision", -4), stop: c("stop", -4), end: c("AimoPilot", -8), line: c("Keep", -4), foot: c("AimoPilot", 10) };

export const Close = () => {
  const frame = useCurrentFrame();
  const out = fall(frame, T.end, 12);
  const p = prog(frame, 2, 24);
  const end = prog(frame, T.end + 6, 20);
  const glow = interpolate(frame, [T.end + 10, T.end + 50], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Ground>
        <div style={{ position: "absolute", inset: 0, opacity: out }}>
          <div style={{ position: "absolute", inset: 0, perspective: 2600 }}>
            <div style={{ position: "absolute", left: 120, top: 150, opacity: p, translate: `0px ${(1 - p) * 60}px`, rotate: `y ${interpolate(frame, [0, T.end + 12], [13, 7], { ...clamp, easing: EASE_IO })}deg`, scale: String(interpolate(frame, [0, T.end + 12], [1, 1.05], { ...clamp, easing: EASE_IO })), transformOrigin: "0 50%", willChange: "transform" }}>
              <BrowserFrame width={1180} height={737} url="aimopilot.zeroanomaly.tech/ops">
                <Img src={staticFile("shots/ops-live.webp")} style={{ width: 1180 }} />
              </BrowserFrame>
            </div>
          </div>
          <Rise at={T.agent - 20} x={40} y={0} style={{ position: "absolute", left: 1330, top: 380, width: 520, ...display, fontSize: 92, color: C.paper }}>
            The wholesaler sees it all.
          </Rise>
          <Rise at={T.stop} x={40} y={0} style={{ position: "absolute", left: 1330, top: 720, ...sans, display: "inline-flex", alignItems: "center", height: 76, padding: "0 34px", borderRadius: 38, background: C.safety, color: C.slab, fontSize: 36, fontWeight: 800 }}>
            Suspend any agent
          </Rise>
        </div>

        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: end }}>
          <div style={{ display: "flex", alignItems: "center", gap: 40, scale: String(interpolate(end, [0, 1], [0.94, 1], { easing: EASE })) }}>
            <span style={{ width: 128, height: 128, borderRadius: "32%", background: "rgb(255 255 255 / 0.13)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ width: 60, height: 60, borderRadius: "50%", background: C.lime, boxShadow: `0 0 0 ${8 + glow * 9}px rgb(192 224 33 / ${0.14 + glow * 0.14}), 0 0 ${50 + glow * 80}px ${glow * 20}px rgb(192 224 33 / ${0.25 + glow * 0.3})` }} />
            </span>
            <span style={{ ...display, fontSize: 200, fontWeight: 700, letterSpacing: "-0.03em", color: C.paper, lineHeight: 1 }}>AimoPilot</span>
          </div>
          <Rise at={T.line} style={{ ...display, fontSize: 80, color: C.paper, marginTop: 54 }}>
            Let AI do the buying. Keep the last word.
          </Rise>
          <Rise at={T.foot} style={{ marginTop: 56, height: 84, padding: "0 46px", borderRadius: 42, background: C.lime, color: C.ink, display: "flex", alignItems: "center", ...sans, fontSize: 44, fontWeight: 700 }}>
            aimopilot.zeroanomaly.tech
          </Rise>
          <Rise at={T.foot + 8} style={{ display: "flex", gap: 14, marginTop: 46 }}>
            {["MCP", "OpenAPI", "WebAuthn passkeys", "Signed JWS mandates", "W3C verifiable credentials"].map((x) => (
              <span key={x} style={{ ...sans, height: 52, padding: "0 24px", borderRadius: 26, border: "1.5px solid rgb(255 255 255 / 0.3)", color: "rgb(255 255 255 / 0.86)", display: "flex", alignItems: "center", fontSize: 26, fontWeight: 600 }}>
                {x}
              </span>
            ))}
          </Rise>
          <Rise at={T.foot + 16} style={{ ...sans, fontSize: 28, color: "rgb(255 255 255 / 0.66)", marginTop: 30 }}>
            Built for Valio Aimo at Junction 2026. Demo on synthetic data.
          </Rise>
        </div>
      </Ground>
    </AbsoluteFill>
  );
};
