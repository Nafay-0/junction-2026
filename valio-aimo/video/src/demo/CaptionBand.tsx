import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame } from "remotion";
import { C, sans } from "../theme";
import { type Page, PAGES } from "./captions";
import { FPS } from "./timeline";

/** The caption band's height at the bottom of the frame (the picture is scaled up above it). */
export const BAND = 150;
const DIM = "rgb(255 255 255 / 0.42)";

const PageView = ({ page }: { page: Page }) => {
  const f = useCurrentFrame();
  const ms = page.startMs + (f / FPS) * 1000;
  const inn = interpolate(f, [0, 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ position: "absolute", left: 160, right: 160, bottom: 0, height: BAND, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: inn, translate: `0 ${(1 - inn) * 10}px` }}>
      {page.lines.map((line, i) => (
        <div key={i} style={{ ...sans, fontSize: 40, fontWeight: 600, lineHeight: 1.32, letterSpacing: "0.005em", whiteSpace: "pre", textAlign: "center" }}>
          {line.map((t, k) => {
            const active = t.startMs <= ms && ms < Math.max(t.endMs, t.startMs + 120);
            const said = ms >= t.endMs;
            return (
              <span key={k} style={{ color: active ? C.lime : said ? "#ffffff" : DIM }}>
                {(k ? " " : "") + t.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Captions in their own band, one page at a time, following the voice word by word. */
export const CaptionBand = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {PAGES.map((p, i) => {
      const from = Math.round((p.startMs / 1000) * FPS);
      const dur = Math.max(1, Math.round((p.endMs / 1000) * FPS) - from);
      return (
        <Sequence key={i} from={from} durationInFrames={dur} name={`caption ${i}`}>
          <PageView page={p} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
