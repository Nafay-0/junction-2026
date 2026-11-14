import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/** The product's own tokens (web/src/app/globals.css) and typefaces (web/src/app/layout.tsx). */
export const C = {
  petrol: "#005670",
  petrolDeep: "#003646",
  petrolSoft: "#e2eef1",
  ink: "#15242b",
  inkSoft: "#55666e",
  inkFaint: "#8a999f",
  paper: "#ffffff",
  mist: "#f4f8f8",
  surface: "#ecf3f4",
  line: "#dde7ea",
  lineStrong: "#b9c8cd",
  lime: "#c0e021",
  limeSoft: "#f1f8cf",
  lavender: "#f1ecf8",
  lavenderDeep: "#5b4a7a",
  good: "#1c6b4a",
  goodSoft: "#e2f3ea",
  bad: "#a3312b",
  badSoft: "#fbe9e6",
  notice: "#96501d",
  safety: "#ffc20e",
  safetySoft: "#fff5d1",
  slab: "#1a1d21",
  slab2: "#262e36",
  chalk: "#eef1f0",
  chalkSoft: "#a9b3bb",
} as const;

export const SANS = "Figtree";
export const DISPLAY = "Bricolage Grotesque";

loadFont({ family: SANS, url: staticFile("fonts/figtree-latin.woff2"), weight: "300 900" });
loadFont({ family: DISPLAY, url: staticFile("fonts/bricolage-latin.woff2"), weight: "200 800", stretch: "75% 100%" });

/** The product's `.display` class: a little narrow, confident, never heavy. */
export const display = {
  fontFamily: `"${DISPLAY}", "${SANS}", sans-serif`,
  fontWeight: 650,
  fontStretch: "86%",
  fontVariationSettings: '"wdth" 86',
  letterSpacing: "-0.022em",
  lineHeight: 1.08,
} as const;

export const sans = { fontFamily: `"${SANS}", sans-serif` } as const;

export const SHADOW = {
  md: "0 2px 4px rgb(0 54 70 / 0.05), 0 12px 28px -12px rgb(0 54 70 / 0.18)",
  lg: "0 24px 60px -20px rgb(0 54 70 / 0.35)",
  xl: "0 40px 100px -30px rgb(0 30 40 / 0.55)",
} as const;
