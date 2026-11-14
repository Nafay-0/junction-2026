/**
 * The customer side speaks Finnish, Swedish and English (English is the default). Pure module: no React, usable from
 * server and client code. The operations portal and the wall stay in English and do not use this.
 *
 * Texts live next to the component that shows them, in a `*.text.ts` file made with `defineText`: English gives the
 * shape, and Finnish and Swedish must have exactly the same keys and the same function signatures, so a missing or
 * misnamed translation is a type error. See `web/docs/LANGUAGE.md` for the vocabulary and the review notes.
 */

export const LANGS = ["fi", "sv", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "en";

/** The cookie that remembers the choice (read by server components so the first paint is already right). */
export const LANG_COOKIE = "aimopilot-lang";
/** The older key the catalogue's product-name switch used; read once so an earlier choice carries over. */
export const LEGACY_LANG_KEY = "dock-lang";

export function isLang(v: unknown): v is Lang {
  return v === "fi" || v === "sv" || v === "en";
}

/** The language's own name, as the switch shows it. */
export const LANG_NAME: Record<Lang, string> = { fi: "Suomi", sv: "Svenska", en: "English" };
export const LANG_SHORT: Record<Lang, string> = { fi: "FI", sv: "SV", en: "EN" };
/** BCP 47 tag for `<html lang>` and `Intl`. Swedish here is Finland Swedish. */
export const LANG_TAG: Record<Lang, string> = { fi: "fi-FI", sv: "sv-FI", en: "en-GB" };

/**
 * One component's texts in all three languages. English defines the keys; Finnish and Swedish must match them.
 *
 *   export const TEXT = defineText({
 *     en: { add: "Add to basket", packs: (n: number) => `${n} pack${n === 1 ? "" : "s"}` },
 *     fi: { add: "Lisää koriin", packs: (n: number) => `${n} pakkaus${n === 1 ? "" : "ta"}` },
 *     sv: { add: "Lägg i varukorgen", packs: (n: number) => `${n} förpackning${n === 1 ? "" : "ar"}` },
 *   });
 */
export function defineText<T extends Record<string, unknown>>(t: { en: T; fi: NoInfer<T>; sv: NoInfer<T> }): Record<Lang, T> {
  return t;
}

/** Pick by language without a dictionary: `pick(lang, { en: "…", fi: "…", sv: "…" })`. For one-off strings only. */
export function pick<T>(lang: Lang, t: Record<Lang, T>): T {
  return t[lang];
}

/** Read a cookie header or `document.cookie` for the language. */
export function langFromCookie(cookieHeader: string | undefined | null): Lang | undefined {
  const m = cookieHeader ? new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=([a-z]{2})`).exec(cookieHeader) : null;
  return m && isLang(m[1]) ? m[1] : undefined;
}
