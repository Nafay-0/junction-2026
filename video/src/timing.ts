import { FADE, sceneFrames, SCENES, type SceneId } from "./vo";

/** Scene lengths in frames, from the narration (src/vo.ts). Scenes cross-fade over FADE frames. */
export const D = Object.fromEntries(SCENES.map((s) => [s, sceneFrames(s)])) as Record<SceneId, number>;
export const TOTAL = SCENES.reduce((a, s) => a + D[s], 0) - (SCENES.length - 1) * FADE;
/** The frame each scene starts on in the film. */
export const START = SCENES.reduce<Record<string, number>>((m, s, i) => ((m[s] = i === 0 ? 0 : m[SCENES[i - 1]] + D[SCENES[i - 1]] - FADE), m), {}) as Record<SceneId, number>;
