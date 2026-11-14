/**
 * The name. A baton is what a relay runner passes on: you pass a task, the agent runs with it and
 * hands it back for the step that is yours (an approval, a sign-in, a payment). It is also what a
 * conductor holds: the agent directs searches, sub-agents and a live browser.
 * Change it here and it changes everywhere in the interface and in the agent's instructions.
 *
 * Not renamed, on purpose: the storage keys ("hovi.*"), the IndexedDB database ("hovi"), the
 * environment variables (HOVI_*) and the server globals (__hovi*) keep the old working title.
 * Renaming them would lose people's saved conversations, settings and sign-ins.
 */
export const APP_NAME = "Baton";
export const APP_TAGLINE = "Your internet butler";
export const APP_DESCRIPTION =
  "Pass over a task. Baton searches the live web with Exa, shows what it finds as live maps, charts and cards, works in a live browser you can watch, and hands the task back for the step that is yours.";

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
