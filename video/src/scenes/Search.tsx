import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, Count, EASE, EASE_IO, fi, L, M, prog, Q, Rise } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { Ground } from "../ui";
import { cue } from "../vo";
import { Field } from "../world";

const c = (phrase: string, shift = 0) => cue("search", phrase, shift);
const T = {
  recall: c("Vector", -2),
  fifty: c("fifty", -4),
  rules: c("inside", -4),
  judge: c("A decision", -4),
  code: c("code checks", -4),
  bars: c("Standard", -12),
  best: c("seventy-two", -4),
  ours: c("AimoPilot", -4),
  big: c("Ninety-seven", -2),
};

/**
 * How a search runs (web/docs/smart-search.md), as a machine: every product a dot, vector and keyword recall pulling
 * fifty of them forward, the kitchen's rules dropping what they exclude, a decision model judging the fifty (it can
 * say "not sold here"), and plain code checking the judge.
 */
const HUB: [number, number] = [1010, 560];
const BAR = 1250;
const Machine = () => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [4, 4 + L], [0, 1], { ...clamp, easing: EASE });
  const pull = interpolate(frame, [T.recall + 8, T.fifty + L], [0, 1], { ...clamp, easing: EASE_IO });
  const rules = prog(frame, T.rules, L);
  const judging = interpolate(frame, [T.judge, T.judge + 10, T.judge + 34], [0, 1, 0], clamp);
  const answer = prog(frame, T.judge + 18, M);
  const no = prog(frame, T.judge + 30, M);
  const checked = prog(frame, T.code + 4, Q);
  return (
    <>
      <Field appear={appear} pull={pull} rules={rules} pulse={judging} top={250} height={640} hub={HUB} />
      <div style={{ position: "absolute", left: BAR, top: 250, width: 8, height: 640, borderRadius: 4, background: C.safety, opacity: 0.2 + 0.8 * rules, boxShadow: `0 0 ${34 * rules}px rgb(255 194 14 / ${0.8 * rules})` }} />
      <Rise at={T.rules} dur={Q} y={10} style={{ position: "absolute", left: BAR - 110, top: 196, width: 228, textAlign: "center", ...sans, fontSize: 28, fontWeight: 700, color: C.safety, whiteSpace: "nowrap" }}>
        the kitchen&apos;s rules
      </Rise>
      <div style={{ position: "absolute", left: 1330, top: 330, width: 500, height: 210, boxSizing: "border-box", borderRadius: 28, background: C.paper, boxShadow: SHADOW.xl, borderTop: `8px solid ${C.lime}`, padding: "22px 28px", ...sans, opacity: answer, translate: `${(1 - answer) * 40}px 0px` }}>
        <div style={{ fontSize: 26, color: C.inkSoft }}>The judge: a decision model</div>
        <div style={{ ...display, fontSize: 52, color: C.ink, marginTop: 8, whiteSpace: "nowrap" }}>Valio Eila, 1 l</div>
        <div style={{ fontSize: 26, color: C.good, fontWeight: 700, marginTop: 6 }}>the right product</div>
        <div style={{ position: "absolute", right: -10, top: -26, height: 58, padding: "0 24px", borderRadius: 29, background: C.lime, color: C.ink, display: "flex", alignItems: "center", fontSize: 27, fontWeight: 800, opacity: checked, scale: String(1.4 - 0.4 * checked), rotate: "4deg" }}>checked by code</div>
      </div>
      <div style={{ position: "absolute", left: 1330, top: 566, width: 500, height: 100, boxSizing: "border-box", borderRadius: 24, background: "rgb(255 255 255 / 0.08)", border: `2.5px dashed ${C.safety}`, display: "flex", alignItems: "center", padding: "0 28px", ...sans, fontSize: 32, color: C.paper, opacity: no, translate: `${(1 - no) * 40}px 0px` }}>
        or: &quot;not sold here&quot;
      </div>
      <div style={{ position: "absolute", left: 60, top: 916, display: "flex", alignItems: "baseline", gap: 22, opacity: appear }}>
        <span style={{ ...display, fontSize: 120, color: C.lime, fontVariantNumeric: "tabular-nums" }}>
          <Count to={17546} at={4} dur={40} format={fi} />
        </span>
        <span style={{ ...display, fontSize: 68, color: C.paper }}>products</span>
      </div>
    </>
  );
};

/** Right first answer on the same 189 requests (web/src/app/_landing/search-eval.json). */
const ROWS = [
  { label: "BM25", v: 31 },
  { label: "Keyword search", v: 40 },
  { label: "Standard hybrid", v: 58 },
  { label: "Semantic search", v: 72 },
];
const FULL = 1000;

export const Search = () => {
  const frame = useCurrentFrame();
  // One move: the pipeline settles up and back as the comparison arrives under it.
  const up = interpolate(frame, [T.bars, T.bars + L], [0, 1], { ...clamp, easing: EASE_IO });
  // The bar and its number never read more than the measured 97.
  const ours = interpolate(frame, [T.ours + 6, T.big + 6], [0, 97], { ...clamp, easing: EASE });
  const land = prog(frame, T.big, M);
  return (
    <AbsoluteFill>
      <Ground>

        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "50% 50%", scale: String(1 + 0.05 * up), opacity: 1 - up, willChange: "transform" }}>
          <Machine />
        </div>

        <div style={{ position: "absolute", left: 60, top: 320, width: 1800 }}>
          {ROWS.map((r, i) => {
            const at = T.bars + 10 + i * 4;
            const g = interpolate(frame, [at, at + M], [0, r.v], { ...clamp, easing: EASE });
            const hot = i === 3 ? prog(frame, T.best, Q) : 0;
            const dim = 1 - 0.45 * land;
            return (
              <div key={r.label} style={{ display: "flex", alignItems: "center", height: 84, opacity: prog(frame, at - 4, Q) * dim }}>
                <div style={{ width: 400, ...sans, fontSize: 38, fontWeight: 600, color: C.paper }}>{r.label}</div>
                <div style={{ height: 46, width: (g / 100) * FULL, borderRadius: 10, background: `rgb(255 255 255 / ${0.24 + hot * 0.3})` }} />
                <div style={{ ...display, fontSize: 54, color: C.paper, marginLeft: 20, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", opacity: g > 1 ? 1 : 0 }}>{Math.round(g)} %</div>
              </div>
            );
          })}
          <div style={{ display: "flex", alignItems: "center", height: 190, marginTop: 6, opacity: prog(frame, T.ours, Q) }}>
            <div style={{ width: 400, ...display, fontSize: 72, color: C.lime }}>AimoPilot</div>
            <div style={{ height: 112, width: (ours / 100) * FULL, borderRadius: 18, background: C.lime, boxShadow: `0 0 ${50 + 60 * land}px -8px rgb(192 224 33 / ${0.5 + 0.4 * land})` }} />
            <div style={{ ...display, fontSize: 210, lineHeight: 1, color: C.lime, marginLeft: 30, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", opacity: ours > 1 ? 1 : 0, scale: String(1 + 0.06 * (1 - land)), transformOrigin: "0 60%" }}>{Math.round(ours)} %</div>
          </div>
        </div>
        <Rise at={T.bars + 6} style={{ position: "absolute", left: 60, top: 216, ...sans, fontSize: 36, color: "rgb(255 255 255 / 0.74)" }}>
          Right first answer, 189 real requests
        </Rise>
      </Ground>
    </AbsoluteFill>
  );
};
