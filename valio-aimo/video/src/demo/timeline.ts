import edit from "./edit.json";
import script from "./script.json";
import vo from "./vo.json";

/**
 * The demo's timeline: the narration drives it. Each chapter is a lead-in (its card), its parts one after another
 * (a gap between them, plus any pad from edit.json), and a tail; the last chapter adds the end card. The same
 * arithmetic is in scripts/demo-timeline.mjs for the captions and the script files.
 */
export const FPS = edit.fps;
type Word = { w: string; s: number; e: number };
const VO = vo as unknown as Record<string, { seconds: number; words: Word[] }>;
const PAD = edit.pad as Record<string, number>;

export type Part = { id: string; text: string; start: number; len: number; words: Word[] };
export type Chapter = { id: string; title: string; index: number; start: number; end: number; parts: Part[] };

let at = 0;
export const CHAPTERS: Chapter[] = script.map((c, ci) => {
  const start = at;
  let t = start + (ci === 0 ? edit.openLead : edit.lead);
  const parts = c.parts.map((text, i) => {
    const id = `${c.id}-${i + 1}`;
    const len = Math.ceil(VO[id].seconds * FPS);
    const p = { id, text, start: t, len, words: VO[id].words };
    t += len + (i < c.parts.length - 1 ? edit.gap : 0) + (PAD[id] ?? 0);
    return p;
  });
  const end = t + edit.tail + (ci === script.length - 1 ? edit.endCard : 0);
  at = end;
  return { id: c.id, title: c.title, index: ci, start, end, parts };
});
export const TOTAL = at;
export const END_CARD = edit.endCard;
export const PARTS = CHAPTERS.flatMap((c) => c.parts);
export const chapter = (id: string) => {
  const c = CHAPTERS.find((x) => x.id === id);
  if (!c) throw new Error(`No chapter ${id}`);
  return c;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The absolute frame on which `phrase` starts to be said in part `partId` (e.g. "c02-2"), shifted by `shift` seconds. */
export function cue(partId: string, phrase: string, shift = 0): number {
  const p = PARTS.find((x) => x.id === partId);
  if (!p) throw new Error(`No part ${partId}`);
  const want = phrase.split(/\s+/).map(norm).filter(Boolean);
  for (let i = 0; i + want.length <= p.words.length; i++) {
    if (want.every((w, k) => norm(p.words[i + k].w) === w)) return p.start + Math.round((p.words[i].s + shift) * FPS);
  }
  throw new Error(`Part ${partId} no longer says "${phrase}": re-time that moment.`);
}
/** The absolute frame on which part `partId` starts (or ends, with end = true), shifted by `shift` seconds. */
export const partAt = (partId: string, shift = 0, end = false) => {
  const p = PARTS.find((x) => x.id === partId);
  if (!p) throw new Error(`No part ${partId}`);
  return p.start + (end ? p.len : 0) + Math.round(shift * FPS);
};
/** `sec` seconds after chapter `id` starts. */
export const inChapter = (id: string, sec: number) => chapter(id).start + Math.round(sec * FPS);

/** Frames in which the narrator is speaking, for the music's ducking. */
export const SPEECH: [number, number][] = PARTS.map((p) => [p.start + Math.round(p.words[0].s * FPS), p.start + Math.round(p.words[p.words.length - 1].e * FPS)]);
