import { INTO, sceneFrames, SCENES, type SceneId } from "./vo";

/** Scene lengths in frames, from the narration (src/vo.ts). Each scene shares INTO[scene] frames with the one before. */
export const D = Object.fromEntries(SCENES.map((s) => [s, sceneFrames(s)])) as Record<SceneId, number>;
export const TOTAL = SCENES.reduce((a, s) => a + D[s] - INTO[s], 0);
/** The frame each scene starts on in the film. */
export const START = SCENES.reduce<Record<string, number>>((m, s, i) => ((m[s] = i === 0 ? 0 : m[SCENES[i - 1]] + D[SCENES[i - 1]] - INTO[s]), m), {}) as Record<SceneId, number>;
