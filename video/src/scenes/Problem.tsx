import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, prog } from "../anim";
import { C, display } from "../theme";
import { Ground } from "../ui";
import { cue } from "../vo";

const LINES = [
  { at: cue("problem", "AI agents", -4), text: "AI agents are starting to do the buying." },
  { at: cue("problem", "But the webshop", -4), text: "The wholesaler's webshop was built for people." },
  { at: cue("problem", "So who signs", -4), text: "An agent that can order is a risk nobody signs off on." },
];

/** The problem, said in three lines on the product's own line: each node lights as its sentence arrives. */
export const Problem = () => {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [0, LINES[2].at + 30], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Ground>
        <div style={{ position: "absolute", left: 190, top: 150, bottom: 150, width: 3, background: "rgb(255 255 255 / 0.14)" }}>
          <div style={{ width: 3, height: `${draw * 100}%`, background: C.lime, opacity: 0.9 }} />
        </div>
        <div style={{ position: "absolute", left: 270, top: 160, right: 200, display: "flex", flexDirection: "column", gap: 62 }}>
          {LINES.map((l, i) => {
            const p = prog(frame, l.at, 22);
            const next = LINES[i + 1];
            const dim = next ? interpolate(frame, [next.at, next.at + 20], [1, 0.38], clamp) : 1;
            return (
              <div key={l.text} style={{ position: "relative", opacity: p * dim, translate: `${(1 - p) * 40}px 0px` }}>
                <span style={{ position: "absolute", left: -98, top: 40, width: 34, height: 34, borderRadius: "50%", background: C.petrolDeep, border: `4px solid ${C.lime}`, boxSizing: "border-box", scale: String(0.6 + p * 0.4) }} />
                <div style={{ ...display, fontSize: 104, color: C.paper, textWrap: "balance", maxWidth: 1300 }}>{l.text}</div>
              </div>
            );
          })}
        </div>
      </Ground>
    </AbsoluteFill>
  );
};
