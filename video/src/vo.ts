import cfg from "./extra.json";
import vo from "./vo.json";

/**
 * The narration drives the timeline. src/vo.json holds, per scene, the clip's length and the second each word is
 * spoken (scripts/vo.mjs). A scene lasts its lead-in, its narration, its tail and whatever its picture needs after
 * the last word; a moment inside a scene is placed with cue(): the frame its word is spoken on.
 */
export const FPS = 30;
export const LEAD = cfg.lead;
export const TAIL = cfg.tail;
export const FADE = cfg.fade;
export type SceneId = keyof typeof cfg.extra;
export const SCENES = Object.keys(cfg.extra) as SceneId[];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The frame, counted from the scene's start, on which `phrase` begins to be spoken. Throws when the script no longer has it. */
export function cue(scene: SceneId, phrase: string, shift = 0): number {
  const words = vo[scene].words;
  const want = phrase.split(/\s+/).map(norm).filter(Boolean);
  for (let i = 0; i + want.length <= words.length; i++) {
    if (want.every((w, k) => norm(words[i + k].w) === w)) return LEAD + Math.round(words[i].s * FPS) + shift;
  }
  throw new Error(`The narration of "${scene}" no longer says "${phrase}": re-time that moment.`);
}

export const voFrames = (scene: SceneId) => Math.ceil(vo[scene].seconds * FPS);
export const sceneFrames = (scene: SceneId) => LEAD + voFrames(scene) + TAIL + cfg.extra[scene];
