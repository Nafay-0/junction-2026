import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, EASE, prog, Rise } from "../anim";
import { C, display, sans } from "../theme";
import { Ground } from "../ui";
import { cue } from "../vo";

const c = (phrase: string, shift = 0) => cue("search", phrase, shift);
const T = { bars: c("the best standard", -6), best: c("seventy-two", -4), ours: c("AimoPilot", -2), big: c("Ninety-seven", -2) };

/** Right first answer on the same 189 requests (web/src/app/_landing/search-eval.json, from web/docs/smart-search.md). */
const ROWS = [
  { label: "BM25", detail: "OpenSearch's default ranking", v: 31 },
  { label: "Keyword search", detail: "IDF-weighted word match", v: 40 },
  { label: "Standard hybrid", detail: "BM25 + k-NN, rank fusion", v: 58 },
  { label: "Semantic search", detail: "k-NN over embeddings", v: 72 },
];
const FULL = 960;

export const Search = () => {
  const frame = useCurrentFrame();
  const ours = interpolate(frame, [T.ours, T.big + 14], [0, 97], { ...clamp, easing: EASE });
  return (
    <AbsoluteFill>
      <Ground>
        <Rise at={4} style={{ position: "absolute", left: 110, top: 84, ...display, fontSize: 104, color: C.paper }}>
          The right product, first.
        </Rise>
        <Rise at={14} style={{ position: "absolute", left: 110, top: 218, ...sans, fontSize: 38, color: "rgb(255 255 255 / 0.78)" }}>
          189 real requests. 17 546 products. Right at first place:
        </Rise>
        <div style={{ position: "absolute", left: 110, top: 330, width: 1700 }}>
          {ROWS.map((r, i) => {
            const g = interpolate(frame, [T.bars + i * 9, T.bars + i * 9 + 30], [0, r.v], { ...clamp, easing: EASE });
            const hot = i === 3 ? prog(frame, T.best, 10) : 0;
            return (
              <div key={r.label} style={{ display: "flex", alignItems: "center", height: 104, opacity: prog(frame, T.bars - 14 + i * 5, 14) }}>
                <div style={{ width: 430 }}>
                  <div style={{ ...sans, fontSize: 38, fontWeight: 600, color: C.paper }}>{r.label}</div>
                  <div style={{ ...sans, fontSize: 24, color: "rgb(255 255 255 / 0.58)" }}>{r.detail}</div>
                </div>
                <div style={{ height: 54, width: (g / 100) * FULL, borderRadius: 12, background: `rgb(255 255 255 / ${0.24 + hot * 0.3})` }} />
                <div style={{ ...display, fontSize: 60, color: C.paper, marginLeft: 22, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", opacity: g > 1 ? 1 : 0 }}>{Math.round(g)} %</div>
              </div>
            );
          })}
          <div style={{ display: "flex", alignItems: "center", height: 150, marginTop: 14, opacity: prog(frame, T.ours - 10, 12) }}>
            <div style={{ width: 430 }}>
              <div style={{ ...display, fontSize: 60, color: C.lime }}>AimoPilot</div>
              <div style={{ ...sans, fontSize: 24, color: "rgb(255 255 255 / 0.7)" }}>hybrid recall, hard rules, a judge</div>
            </div>
            <div style={{ height: 92, width: (ours / 100) * FULL, borderRadius: 16, background: C.lime, boxShadow: "0 0 60px -10px rgb(192 224 33 / 0.7)" }} />
            <div style={{ ...display, fontSize: 132, color: C.lime, marginLeft: 26, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", opacity: ours > 1 ? 1 : 0 }}>{Math.round(ours)} %</div>
          </div>
        </div>
        <Rise at={T.big + 16} style={{ position: "absolute", left: 110, top: 946, ...sans, fontSize: 30, color: "rgb(255 255 255 / 0.62)" }}>
          Standard set-ups we built and ran: same requests, same scoring.
        </Rise>
      </Ground>
    </AbsoluteFill>
  );
};
