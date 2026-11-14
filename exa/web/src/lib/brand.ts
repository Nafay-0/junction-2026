/**
 * The name. Beryl is a gemstone: emerald and aquamarine are both beryl, and its crystals grow as
 * six-sided columns. Clear, hard and many-faceted is what the agent should be: it shows its
 * sources, holds to its rules and turns one request into many sides of an answer.
 * Change it here and it changes everywhere in the interface and in the agent's instructions.
 *
 * Not renamed, on purpose: the storage keys in the browser ("hovi.*") keep the first working
 * title, so people's saved settings survive. It was Hovi, then Baton (until 14 Nov).
 */
export const APP_NAME = "Beryl";
export const APP_TAGLINE = "Your internet butler";
export const APP_DESCRIPTION =
  "Hand over a task. Beryl searches the live web with Exa, shows what it finds as live maps, charts and cards, and in the desktop app works in a live browser you can watch, handing the task back for the step that is yours.";

/**
 * The logo: a baton caught at the moment it changes hands. One short diagonal bar with rounded
 * ends, cut by an upright gap. The solid part is the hand that passes it on; the lighter part is
 * already on its way.
 *
 * Drawn in a 32 by 32 box. The same shapes are used by the logo in the interface
 * (components/brand/logo.tsx), the Apple touch icon (app/apple-icon.tsx) and, copied by hand
 * because it is a static file, the favicon (app/icon.svg). Change them together.
 */
export const LOGO = {
  /** The solid part, lower left. */
  near: "M14.7 13.06 7.48 20.28A3 3 0 0 0 11.72 24.52L14.7 21.54Z",
  /** The lighter part, upper right. */
  far: "M17.3 10.46 20.28 7.48A3 3 0 0 1 24.52 11.72L17.3 18.94Z",
  farOpacity: 0.6,
  /** Corner radius of the tile behind the mark. */
  radius: 9,
  /** Fixed colours for files that cannot read the theme (favicon, touch icon): the light theme's emerald and ivory. */
  tile: "#004935",
  ink: "#f5fcf8",
} as const;
