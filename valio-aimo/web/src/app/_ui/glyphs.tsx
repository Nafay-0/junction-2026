/**
 * Drawn pack and department glyphs (original line drawings, no brand, no packaging artwork). The partner's data has no
 * product photographs, so the pack is the picture: a glyph for the kind of pack, and its content set large beside it.
 * 48 x 48, 2.5 px strokes, square ends, currentColor.
 */

export type GlyphKind =
  | "carton"
  | "bib"
  | "tub"
  | "block"
  | "sack"
  | "bottle"
  | "canister"
  | "case"
  | "bag"
  | "can"
  | "leaf"
  | "cup"
  | "pan"
  | "fish"
  | "sweet"
  | "frost"
  | "bread"
  | "cloth";

const PATHS: Record<GlyphKind, string> = {
  carton: "M15 18 L24 9 L33 18 V41 H15 Z M15 18 H33 M24 9 V5 M20 5 H28",
  bib: "M8 15 H40 V41 H8 Z M8 15 L13 9 H35 L40 15 M30 41 V45 H36 V41 M18 22 H30",
  tub: "M11 14 H37 L34 41 H14 Z M9 9 H39 V14 H9 Z",
  block: "M6 31 L24 15 L42 25 V37 L24 43 L6 37 Z M6 31 L24 37 L42 25 M24 37 V43 M17 33 a2 2 0 1 0 0.1 0 M30 31 a1.6 1.6 0 1 0 0.1 0",
  sack: "M15 13 C11 24 9 33 12 43 H36 C39 33 37 24 33 13 M15 13 L19 8 L24 12 L29 8 L33 13 M16 13 H32",
  bottle: "M20 4 H28 V10 C28 14 34 16 34 22 V44 H14 V22 C14 16 20 14 20 10 Z M14 28 H34 M14 36 H34",
  canister: "M10 14 H34 L38 18 V44 H10 Z M28 14 V8 H34 V14 M15 8 H23 M19 8 V14 M15 26 H33",
  case: "M6 16 H42 V40 H6 Z M6 16 L12 9 H36 L42 16 M24 9 V16 M18 26 H30",
  bag: "M11 10 H37 V44 H11 Z M11 16 H37 M17 24 H31 M17 30 H27",
  can: "M13 10 C13 6 35 6 35 10 V40 C35 44 13 44 13 40 Z M13 10 C13 14 35 14 35 10 M13 22 H35 M13 30 H35",
  leaf: "M10 40 C10 18 22 8 40 8 C40 28 30 40 10 40 Z M10 40 L30 18 M20 30 H27 M24 25 H30",
  cup: "M12 12 H36 L33 43 H15 Z M10 8 H38 V12 H10 Z M13 22 H35",
  pan: "M4 22 H32 V34 C32 39 28 41 24 41 H12 C8 41 4 39 4 34 Z M32 26 H45 M8 18 H28",
  fish: "M4 24 C12 12 30 12 38 24 C30 36 12 36 4 24 Z M38 24 L45 16 V32 Z M13 21 a1.6 1.6 0 1 0 0.1 0 M22 18 C24 22 24 26 22 30",
  sweet: "M15 16 H33 V32 H15 Z M15 16 L6 10 V38 L15 32 M33 16 L42 10 V38 L33 32 M20 22 H28 M20 27 H26",
  frost: "M24 5 V43 M7.5 14.5 L40.5 33.5 M7.5 33.5 L40.5 14.5 M19 9 L24 13 L29 9 M19 39 L24 35 L29 39",
  bread: "M7 22 C7 12 41 12 41 22 V40 H7 Z M15 18 L18 26 M23 17 L26 25 M31 18 L34 26",
  cloth: "M8 12 H40 V24 H8 Z M8 24 L12 40 H36 L40 24 M16 30 H32",
};

export function Glyph({ kind, size = 40, className = "", strokeWidth = 2.5 }: { kind: GlyphKind; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="miter" strokeLinecap="square">
      <path d={PATHS[kind]} />
    </svg>
  );
}

/** Temperature glyphs: a quiet code next to the word, so colour is never the only signal. */
export function TempGlyph({ t, size = 14 }: { t: "frozen" | "chilled" | "ambient" | string; size?: number }) {
  const d =
    t === "frozen"
      ? "M8 1 V15 M2 4.5 L14 11.5 M2 11.5 L14 4.5"
      : t === "chilled"
        ? "M6 2 H10 V9.5 A3.6 3.6 0 1 1 6 9.5 Z M8 6 V11"
        : "M2 5 H14 M2 9 H14 M2 13 H14";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square">
      <path d={d} />
    </svg>
  );
}

/** The glyph a department is drawn with. Department ids are the partner's category numbers. */
export const DEPARTMENT_GLYPH: Record<string, GlyphKind> = {
  d10: "carton",
  d41: "frost",
  d21: "sack",
  d17: "leaf",
  d22: "bottle",
  d63: "canister",
  d64: "cup",
  d20: "pan",
  d52: "sweet",
  d18: "fish",
  d90: "case",
  d11: "bread",
  d85: "bottle",
  d84: "bottle",
  d30: "cloth",
  d67: "case",
  d77: "can",
};
