import { Audio } from "@remotion/media";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { EDL } from "./edl";
import { CalloutView, ChapterCard, Corner, EndCard, Ground, Label, OVER, ShotView } from "./parts";
import { CHAPTERS, END_CARD, PARTS, SPEECH, TOTAL } from "./timeline";

/** The bed sits about 14 dB under the voice while he speaks (the clips are levelled to -17 LUFS, the bed is about -14) and lifts between lines. */
const UNDER = 0.14;
const BETWEEN = 0.27;
const RAMP = 14;
const BED: number[] = (() => {
  const v = new Array<number>(TOTAL).fill(BETWEEN);
  for (const [a, b] of SPEECH) for (let f = Math.max(0, a - RAMP); f < Math.min(TOTAL, b + RAMP); f++) {
    const t = f < a ? (a - f) / RAMP : f > b ? (f - b) / RAMP : 0;
    v[f] = Math.min(v[f], UNDER + (BETWEEN - UNDER) * t);
  }
  for (let f = 0; f < TOTAL; f++) {
    if (f < 20) v[f] *= f / 20;
    if (f > TOTAL - 75) v[f] *= Math.max(0, (TOTAL - f) / 75);
  }
  return v;
})();

const CARD = 46;

const ChapterView = ({ id }: { id: string }) => {
  const ch = CHAPTERS.find((c) => c.id === id)!;
  const { shots, callouts } = EDL[id]();
  const len = ch.end - ch.start;
  const sorted = [...shots].sort((a, b) => a.at - b.at);
  return (
    <AbsoluteFill>
      <Ground />
      {sorted.map((s, i) => {
        const from = Math.max(0, s.at - ch.start);
        const until = i < sorted.length - 1 ? sorted[i + 1].at - ch.start + OVER : len;
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, until - from)} premountFor={30}>
            <ShotView shot={s} dur={until - from} title={ch.title} fadeIn={i > 0} />
            {s.label && !s.full ? <Label text={s.label} /> : null}
          </Sequence>
        );
      })}
      {callouts.map((c, i) => (
        <Sequence key={`c${i}`} from={c.at - ch.start} durationInFrames={c.dur ?? 120}>
          <CalloutView c={c} dur={c.dur ?? 120} />
        </Sequence>
      ))}
      <Corner />
      {ch.index > 0 ? (
        <Sequence durationInFrames={CARD}>
          <ChapterCard n={ch.index} title={ch.title} len={CARD} />
        </Sequence>
      ) : null}
      {ch.index === CHAPTERS.length - 1 ? (
        <Sequence from={len - END_CARD - 12}>
          <EndCard />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

export const Demo = () => (
  <AbsoluteFill style={{ background: "#00222d" }}>
    {CHAPTERS.map((c) => (
      <Sequence key={c.id} from={c.start} durationInFrames={c.end - c.start} name={`${c.id} ${c.title}`}>
        <ChapterView id={c.id} />
      </Sequence>
    ))}
    {PARTS.map((p) => (
      <Sequence key={p.id} from={p.start} durationInFrames={p.len + 6} name={`vo ${p.id}`}>
        <Audio src={staticFile(`demo-vo/${p.id}.mp3`)} />
      </Sequence>
    ))}
    <Audio src={staticFile("demo-music/bed-loop.mp3")} volume={(f) => BED[Math.min(TOTAL - 1, Math.max(0, Math.round(f)))]} />
  </AbsoluteFill>
);

export const DEMO_TOTAL = TOTAL;
