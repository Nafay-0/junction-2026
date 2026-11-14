/**
 * Link classes that look like the kit's buttons, for server components (kit.tsx is a client module, so its
 * buttonClass() cannot be called on the server). Same values as kit.tsx.
 */
const BASE = "relative inline-flex items-center justify-center gap-2 font-semibold leading-tight transition-colors min-h-11 px-4 text-[1rem]";
export const LINK_GO = `${BASE} bg-lime text-ink hover:bg-lime-hover`;
export const LINK_PRIMARY = `${BASE} bg-petrol text-paper hover:bg-petrol-deep`;
