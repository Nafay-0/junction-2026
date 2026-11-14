import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, EASE, EASE_IO, fi, L, M, prog, Q, Rise } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { Ground } from "../ui";
import { cue } from "../vo";

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
 * How a search runs (web/docs/smart-search.md), as a machine: the whole catalogue, vector and keyword recall pulling
 * fifty candidates through the kitchen's rules, a decision model judging them (it can say "not sold here"), and plain
 * code checking the judge.
 */
const COLS = 22;
const DOTS = COLS * 7;
const PICKED = Array.from({ length: 28 }, (_, k) => (k * 37 + 5) % DOTS);
const home = (i: number): [number, number] => [70 + (i % COLS) * 30, 318 + Math.floor(i / COLS) * 38];
const spot = (k: number): [number, number] => [930 + (k % 7) * 34, 356 + Math.floor(k / 7) * 34];
const ANSWER: [number, number] = [1420, 400];

const Machine = () => {
  const frame = useCurrentFrame();
  const sweep = interpolate(frame, [T.recall, T.recall + 44], [0, 1], { ...clamp, easing: EASE_IO });
  const rules = prog(frame, T.rules, M);
  const judged = prog(frame, T.judge + 6, L);
  const answer = prog(frame, T.judge + 18, M);
  const no = prog(frame, T.judge + 30, M);
  const checked = prog(frame, T.code + 4, Q);
  const count = Math.round(interpolate(frame, [6, 6 + L], [0, 17546], { ...clamp, easing: EASE }));
  return (
    <>
      {Array.from({ length: DOTS }, (_, i) => {
        const k = PICKED.indexOf(i);
        const [hx, hy] = home(i);
        const inP = prog(frame, 4 + (i % COLS) * 0.7 + Math.floor(i / COLS), Q);
        const near = 1 - Math.min(1, Math.abs((i % COLS) / COLS - sweep) * 5);
        if (k < 0) return <span key={i} style={{ position: "absolute", left: hx, top: hy, width: 18, height: 18, borderRadius: 5, background: "rgb(255 255 255 / 0.5)", opacity: inP * (0.5 + 0.5 * near * (sweep < 1 ? 1 : 0)) * (1 - 0.5 * rules) }} />;
        const pull = interpolate(frame, [T.fifty - 14 + k * 1.1, T.fifty + 16 + k * 1.1], [0, 1], { ...clamp, easing: EASE_IO });
        const [sx, sy] = spot(k);
        const chosen = k === 10;
        const go = chosen ? interpolate(frame, [T.judge + 10, T.judge + 10 + M], [0, 1], { ...clamp, easing: EASE_IO }) : 0;
        const scan = Math.max(0, 1 - Math.abs(judged * 30 - k) / 3) * (judged < 1 ? 1 : 0);
        const x = hx + (sx - hx) * pull + (ANSWER[0] - sx) * go;
        const y = hy + (sy - hy) * pull + (ANSWER[1] + 40 - sy) * go;
        return <span key={i} style={{ position: "absolute", left: x, top: y, width: 18, height: 18, borderRadius: 5, background: pull > 0.05 ? C.lime : "rgb(255 255 255 / 0.5)", opacity: inP * (chosen ? 1 - go : 1 - 0.55 * judged * (1 - scan)), scale: String(1 + 0.5 * scan + 0.3 * pull * (1 - pull) * 4), boxShadow: scan > 0.2 ? "0 0 16px rgb(192 224 33 / 0.9)" : "none" }} />;
      })}
      <div style={{ position: "absolute", left: 850, top: 300, width: 8, height: 290, borderRadius: 4, background: C.safety, opacity: 0.25 + 0.75 * rules, boxShadow: `0 0 ${30 * rules}px rgb(255 194 14 / ${0.7 * rules})` }} />

      <div style={{ position: "absolute", left: 70, top: 606, ...sans, fontSize: 34, color: C.paper }}>
        <span style={{ ...display, fontSize: 48, color: C.lime, fontVariantNumeric: "tabular-nums" }}>{fi(count)}</span> products
      </div>
      <Rise at={T.rules} dur={Q} y={10} style={{ position: "absolute", left: 742, top: 606, width: 220, ...sans, fontSize: 28, color: C.safety, fontWeight: 600, textAlign: "center" }}>
        the kitchen&apos;s rules
      </Rise>
      <Rise at={T.fifty} dur={Q} y={10} style={{ position: "absolute", left: 930, top: 606, ...sans, fontSize: 34, color: C.paper, whiteSpace: "nowrap" }}>
        <span style={{ ...display, fontSize: 48, color: C.lime }}>50</span> candidates
      </Rise>
      <Rise at={T.recall + M} dur={Q} y={10} style={{ position: "absolute", left: 70, top: 668, ...sans, fontSize: 28, color: "rgb(255 255 255 / 0.74)" }}>
        vectors and keyword lists, on Aiven for OpenSearch
      </Rise>

      <div style={{ position: "absolute", left: ANSWER[0], top: ANSWER[1] - 110, width: 430, height: 190, boxSizing: "border-box", borderRadius: 26, background: C.paper, boxShadow: SHADOW.xl, borderTop: `8px solid ${C.lime}`, padding: "20px 26px", ...sans, opacity: answer, translate: `${(1 - answer) * 40}px 0px` }}>
        <div style={{ fontSize: 24, color: C.inkSoft }}>The judge: a decision model</div>
        <div style={{ ...display, fontSize: 46, color: C.ink, marginTop: 8, whiteSpace: "nowrap" }}>Valio Eila, 1 l</div>
        <div style={{ fontSize: 24, color: C.good, fontWeight: 700, marginTop: 6 }}>the right product</div>
        <div style={{ position: "absolute", right: -14, top: -24, height: 56, padding: "0 22px", borderRadius: 28, background: C.lime, color: C.ink, display: "flex", alignItems: "center", gap: 10, fontSize: 26, fontWeight: 800, opacity: checked, scale: String(1.4 - 0.4 * checked), rotate: "4deg" }}>checked by code</div>
      </div>
      <div style={{ position: "absolute", left: ANSWER[0], top: ANSWER[1] + 104, width: 430, height: 96, boxSizing: "border-box", borderRadius: 22, background: "rgb(255 255 255 / 0.08)", border: `2.5px dashed ${C.safety}`, display: "flex", alignItems: "center", padding: "0 26px", ...sans, fontSize: 30, color: C.paper, opacity: no, translate: `${(1 - no) * 40}px 0px` }}>
        or: &quot;not sold here&quot;
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
  const ours = interpolate(frame, [T.ours + 6, T.big + 4, T.big + M], [0, 99.5, 97], { ...clamp, easing: EASE });
  const land = prog(frame, T.big, M);
  return (
    <AbsoluteFill>
      <Ground>
        <Rise at={8} style={{ position: "absolute", left: 60, top: 70, ...display, fontSize: 104, color: C.paper }}>
          The right product, first.
        </Rise>

        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "60px 240px", scale: String(1 - 0.5 * up), translate: `0px ${-34 * up}px`, opacity: 1 - 0.35 * up, willChange: "transform" }}>
          <Machine />
        </div>

        <div style={{ position: "absolute", left: 60, top: 452, width: 1800 }}>
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
        <Rise at={T.bars + 6} style={{ position: "absolute", right: 60, top: 306, ...sans, fontSize: 32, color: "rgb(255 255 255 / 0.7)", textAlign: "right" }}>
          Right first answer, 189 real requests
        </Rise>
      </Ground>
    </AbsoluteFill>
  );
};
