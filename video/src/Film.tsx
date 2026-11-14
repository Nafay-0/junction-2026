import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type { ReactNode } from "react";
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Drift } from "./anim";
import { type Move, presentation, World } from "./camera";
import { Agents, BUYER_NODE, RING_GATE } from "./scenes/Agents";
import { Aiven } from "./scenes/Aiven";
import { Close } from "./scenes/Close";
import { Flow } from "./scenes/Flow";
import { Gate, GATE_SCENE } from "./scenes/Gate";
import { Memory, MEMORY_NODE } from "./scenes/Memory";
import { Problem } from "./scenes/Problem";
import { Search } from "./scenes/Search";
import { Title } from "./scenes/Title";
import { C } from "./theme";
import { D, START, TOTAL } from "./timing";
import { cue, FPS, INTO, LEAD, SCENES, type SceneId } from "./vo";
import vo from "./vo.json";

/**
 * How the camera gets into each scene (src/camera.tsx). The shop's signed order travels on to the gate; the camera
 * pulls back from the gate to the six agents around it, pushes into the buying agent for its memory, follows the
 * corrected order on to the search, tilts down through the floor to the platform it all runs on, and rises to the
 * wholesaler's portal for the close. The opening and the title are cuts on the beat.
 */
const MOVES: Partial<Record<SceneId, Move>> = {
  title: { kind: "through" },
  flow: { kind: "through" },
  gate: { kind: "pan", dx: 2160, dy: 0 },
  agents: { kind: "zoom", from: [GATE_SCENE.x, GATE_SCENE.y], to: [RING_GATE.x, RING_GATE.y], s: (GATE_SCENE.w * (1 + GATE_SCENE.push)) / RING_GATE.w },
  memory: { kind: "zoom", from: [BUYER_NODE.x, BUYER_NODE.y], to: [MEMORY_NODE.x, MEMORY_NODE.y], s: BUYER_NODE.w / MEMORY_NODE.w },
  search: { kind: "pan", dx: 2160, dy: 0 },
  aiven: { kind: "pan", dx: 0, dy: 1700, floor: true },
  close: { kind: "pan", dx: 0, dy: -1500 },
};
const WORLD_MOVES = SCENES.filter((id) => MOVES[id]).map((id) => ({ at: START[id], dur: INTO[id], move: MOVES[id] as Move }));
const move = (id: SceneId) => <TransitionSeries.Transition presentation={presentation(MOVES[id] as Move)} timing={linearTiming({ durationInFrames: INTO[id] })} />;

/** A scene with its narration: the clip starts after the lead-in, on the frame the cut into the scene ends. */
const scene = (id: SceneId, picture: ReactNode) => (
  <TransitionSeries.Sequence name={id} durationInFrames={D[id]}>
    {picture}
    <Sequence from={LEAD} layout="none">
      <Audio src={staticFile(`vo/${id}.mp3`)} />
    </Sequence>
  </TransitionSeries.Sequence>
);

/**
 * The music's level, frame by frame: down under the voice, up in the gaps, at the title and at the close. The track
 * (public/music/bed.mp3, made for this film: 100 beats a minute, 18 frames a beat, the film's exact length) starts
 * quieter for its first bars, so the opening is ducked less.
 */
const UNDER = 0.16;
const OPEN = 0.5;
const speech = SCENES.map((id) => {
  const w = vo[id].words;
  return [START[id] + LEAD + Math.round(w[0].s * FPS) - 5, START[id] + LEAD + Math.round(w[w.length - 1].e * FPS) + 5] as const;
});
const raw = Array.from({ length: TOTAL }, (_, f) => {
  const quietIntro = f < START.flow ? 1.9 : 1;
  return (speech.some(([a, b]) => f >= a && f <= b) ? UNDER : OPEN) * quietIntro;
});
const SPAN = 9;
const LEVEL = raw.map((_, f) => {
  let s = 0;
  let n = 0;
  for (let k = Math.max(0, f - SPAN); k <= Math.min(TOTAL - 1, f + SPAN); k++) {
    s += raw[k];
    n++;
  }
  return Math.min(1, s / n);
});

const Bed = () => {
  const frame = useCurrentFrame();
  return <Audio src={staticFile("music/bed.mp3")} volume={LEVEL[Math.max(0, Math.min(TOTAL - 1, frame))]} />;
};

/** Two small sounds: a soft swell that blooms as the name appears, and a tick on the passkey tap. */
const SWELL = START.title + cue("title", "AimoPilot") - 62;
const TAP = START.flow + cue("flow", "One passkey", 4);

export const Film = () => (
  <AbsoluteFill style={{ background: C.petrolDeep }}>
    <World moves={WORLD_MOVES} />
    <TransitionSeries>
      {scene("problem", <Drift origin="20% 50%">{<Problem />}</Drift>)}
      {move("title")}
      {scene("title", <Drift by={0.04}>{<Title />}</Drift>)}
      {move("flow")}
      {scene("flow", <Flow />)}
      {move("gate")}
      {scene("gate", <Gate />)}
      {move("agents")}
      {scene("agents", <Agents />)}
      {move("memory")}
      {scene("memory", <Memory />)}
      {move("search")}
      {scene("search", <Drift by={0.02}>{<Search />}</Drift>)}
      {move("aiven")}
      {scene("aiven", <Drift by={0.02}>{<Aiven />}</Drift>)}
      {move("close")}
      {scene("close", <Close />)}
    </TransitionSeries>
    <Bed />
    <Sequence from={SWELL} layout="none">
      <Audio src={staticFile("sfx/swell-n.mp3")} volume={0.5} />
    </Sequence>
    <Sequence from={TAP} layout="none">
      <Audio src={staticFile("sfx/tap-n.mp3")} volume={0.8} />
    </Sequence>
  </AbsoluteFill>
);
