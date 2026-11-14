/**
 * Link classes that look like the kit's buttons, for server components (kit.tsx is a client module, so its
 * buttonClass() cannot be called on the server). Same values as kit.tsx: pills, lime for the one main action.
 */
const BASE =
  "relative inline-flex items-center justify-center gap-2 rounded-full font-semibold leading-tight transition-[background-color,border-color,color] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 min-h-11 px-5 text-[0.95rem]";
export const LINK_GO = `${BASE} bg-lime text-ink shadow-xs hover:bg-lime-hover`;
export const LINK_PRIMARY = `${BASE} bg-petrol text-paper hover:bg-petrol-deep`;
export const LINK_SECONDARY = `${BASE} border border-line-strong bg-paper text-ink hover:border-ink-soft hover:bg-mist`;
