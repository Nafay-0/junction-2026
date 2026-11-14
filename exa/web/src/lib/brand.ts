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
  "Tell Beryl what you need. It searches the live web, shows you the answer, and can finish the job in a browser while you watch.";

/**
 * The logo: a cut beryl seen from above. Beryl crystals are six-sided, so the stone is a hexagon:
 * a flat table in the middle and six facets round it, lit from the upper left. The two facets
 * that face the light are brightest, the two that face away are darkest.
 *
 * Drawn in a 32 by 32 box. The same shapes are used by the logo in the interface
 * (components/brand/logo.tsx), the Apple touch icon (app/apple-icon.tsx), the installed app's
 * icons (scripts/make-icons.cjs) and, copied by hand because they are static files, the favicon
 * (app/icon.svg) and the desktop app's "cannot reach the server" page. Change them together.
 */
export const LOGO = {
  /** The six facets, clockwise from the upper right, each with how much light it catches. */
  facets: [
    { d: "M16.42 5.81 24.62 10.55 21.01 12.62 16.42 9.97Z", opacity: 0.62 },
    { d: "M25.03 11.27 25.03 20.73 21.43 18.66 21.43 13.34Z", opacity: 0.4 },
    { d: "M24.62 21.45 16.42 26.19 16.42 22.03 21.01 19.38Z", opacity: 0.4 },
    { d: "M15.58 26.19 7.38 21.45 10.99 19.38 15.58 22.03Z", opacity: 0.62 },
    { d: "M6.97 20.73 6.97 11.27 10.57 13.34 10.57 18.66Z", opacity: 0.92 },
    { d: "M7.38 10.55 15.58 5.81 15.58 9.97 10.99 12.62Z", opacity: 0.92 },
  ],
  /** The table: the flat top of the stone. */
  table: "M16.00 11.60 19.81 13.80 19.81 18.20 16.00 20.40 12.19 18.20 12.19 13.80Z",
  /** Corner radius of the tile behind the mark. */
  radius: 9,
  /** Fixed colours for files that cannot read the theme (favicon, touch icon, app icons): the light theme's emerald and ivory. */
  tile: "#004935",
  ink: "#f5fcf8",
} as const;
