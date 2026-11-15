import type { Caption } from "@remotion/captions";
import { FPS, PARTS } from "./timeline";

/**
 * Burned-in captions for the demo, timed from the voice itself: every word's start and end come from the ElevenLabs
 * alignment of its take (src/demo/vo.json, after pause tightening and tempo). The words shown are the written script:
 * where the voice was given words for a number, a price or an address, the written token takes the whole time span of
 * the spoken words it stands for.
 */

/** Spoken word sequences (lower case, punctuation stripped) and what is written instead. Longest first. */
const WRITTEN: [string, string][] = [
  ["seventeen thousand five hundred and forty-six", "17,546"],
  ["more than seventeen hundred", "more than 1,700"],
  ["a hundred and eighty-nine", "189"],
  ["four thousand two hundred", "4,200"],
  ["four hundred and twenty", "420"],
  ["about four hundred", "about 400"],
  ["five hundred euro", "€500"],
  ["a thousand litres", "1,000 litres"],
  ["forty percent", "40%"],
  ["seventy-two", "72%"],
  ["ninety-seven", "97%"],
  ["forty-five", "45"],
  ["nineteen", "19"],
  ["thirteen", "13"],
  ["twenty rules", "20 rules"],
  ["aimopilot dot zero anomaly dot tech", "aimopilot.zeroanomaly.tech"],
];
const RULES = WRITTEN.map(([spoken, written]) => ({ words: spoken.split(" "), written })).sort((a, b) => b.words.length - a.words.length);
const bare = (w: string) => w.toLowerCase().replace(/^[^a-z0-9€-]+|[^a-z0-9€-]+$/g, "");
/** Punctuation around a word, kept on the written token. */
const lead = (w: string) => w.match(/^[^A-Za-z0-9€]*/)?.[0] ?? "";
const trail = (w: string) => w.match(/[^A-Za-z0-9€%]*$/)?.[0] ?? "";

export type Token = Caption & { sentenceEnd: boolean; phraseEnd: boolean };

/** One token per written word, with absolute times in milliseconds. */
export const TOKENS: Token[] = PARTS.flatMap((p) => {
  const base = (p.start / FPS) * 1000;
  const out: Token[] = [];
  const ws = p.words;
  for (let i = 0; i < ws.length; ) {
    const rule = RULES.find((r) => r.words.every((w, k) => ws[i + k] && bare(ws[i + k].w) === w));
    const n = rule ? rule.words.length : 1;
    const first = ws[i];
    const last = ws[i + n - 1];
    const text = rule ? `${lead(first.w)}${rule.written}${trail(last.w)}` : first.w;
    out.push({
      text,
      startMs: Math.round(base + first.s * 1000),
      endMs: Math.round(base + last.e * 1000),
      timestampMs: Math.round(base + first.s * 1000),
      confidence: 1,
      sentenceEnd: /[.?!]["”]?$/.test(text) || i + n >= ws.length,
      phraseEnd: /[,:;]$/.test(text),
    });
    i += n;
  }
  return out;
});

export const LINE_CHARS = 42;
export type Page = { lines: Token[][]; startMs: number; endMs: number };
const len = (ts: Token[]) => ts.reduce((a, t, i) => a + t.text.length + (i ? 1 : 0), 0);

/** Words into lines of at most LINE_CHARS, breaking at a comma when the line is already well filled. */
function wrap(ts: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const t of ts) {
    const cur = lines[lines.length - 1];
    if (cur.length && len([...cur, t]) > LINE_CHARS) lines.push([t]);
    else cur.push(t);
  }
  return lines;
}

/**
 * Pages of one or two lines: a page never crosses a sentence; inside a long sentence it ends at a comma or colon when
 * that keeps both pages useful; a page is never a single orphan word (a word is borrowed from the page before).
 */
function paginate(): Page[] {
  const sentences: Token[][] = [[]];
  TOKENS.forEach((t, i) => {
    sentences[sentences.length - 1].push(t);
    if (t.sentenceEnd && i < TOKENS.length - 1) sentences.push([]);
  });
  const chunks: Token[][] = [];
  for (const s of sentences) {
    if (!s.length) continue;
    const first = chunks.length;
    let cur: Token[] = [];
    for (let i = 0; i < s.length; i++) {
      const next = [...cur, s[i]];
      if (cur.length && wrap(next).length > 2) {
        // Back up to the last comma in this page if it leaves at least a full line before it.
        const cut = cur.map((t, k) => (t.phraseEnd ? k : -1)).filter((k) => k >= 0 && len(cur.slice(0, k + 1)) >= 24).pop();
        if (cut !== undefined && cut < cur.length - 1) {
          chunks.push(cur.slice(0, cut + 1));
          cur = [...cur.slice(cut + 1), s[i]];
        } else {
          chunks.push(cur);
          cur = [s[i]];
        }
      } else cur = next;
    }
    if (cur.length) {
      const prev = chunks[chunks.length - 1];
      if (cur.length === 1 && chunks.length > first && prev.length > 3) cur.unshift(prev.pop() as Token);
      chunks.push(cur);
    }
  }
  return chunks.map((c, i) => {
    const next = chunks[i + 1];
    const end = c[c.length - 1].endMs + 260;
    return { lines: wrap(c), startMs: c[0].startMs - 80, endMs: next ? Math.min(end, next[0].startMs - 80) : end };
  });
}

export const PAGES: Page[] = paginate();
