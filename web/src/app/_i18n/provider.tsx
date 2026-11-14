"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { actorLabelL, agoL, attrL, dayL, measureL, packWord, roleLabelL, ruleTitleL, weekdayL, weekdaysL } from "./format";
import { DEFAULT_LANG, LANG_COOKIE, LANG_NAME, LANG_SHORT, LANG_TAG, LANGS, LEGACY_LANG_KEY, isLang, langFromCookie, type Lang } from "./lang";
import { clock, fullDate, money, moneyShort, num } from "../_ui/plain";

type Ctx = { lang: Lang; setLang: (l: Lang) => void };

/** Outside a provider (the operations portal, the wall) everything reads English. */
const LangContext = createContext<Ctx>({ lang: DEFAULT_LANG, setLang: () => {} });

function remember(l: Lang) {
  try {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    localStorage.setItem(LEGACY_LANG_KEY, l);
  } catch {
    // storage blocked: the choice lasts as long as the page
  }
}

/**
 * The buyer's language for everything under it. `initial` comes from the cookie on the server, so a Finnish buyer's
 * first paint is already Finnish; without a cookie, an earlier choice in local storage is picked up after mount.
 */
export function LangProvider({ initial, children }: { initial?: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial ?? DEFAULT_LANG);
  useEffect(() => {
    if (initial) return;
    queueMicrotask(() => {
      try {
        const fromCookie = langFromCookie(document.cookie);
        const saved = fromCookie ?? localStorage.getItem(LEGACY_LANG_KEY);
        if (isLang(saved)) {
          setLangState(saved);
          if (!fromCookie) remember(saved);
        }
      } catch {
        // storage blocked: English
      }
    });
  }, [initial]);
  useEffect(() => {
    document.documentElement.lang = LANG_TAG[lang];
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    remember(l);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  return useContext(LangContext);
}

/** This component's texts in the buyer's language: `const tx = useText(TEXT)`. */
export function useText<T>(dict: Record<Lang, T>): T {
  return dict[useContext(LangContext).lang];
}

/** Formatters bound to the buyer's language. Money and numbers are the same in all three. */
export function useFormat() {
  const { lang } = useContext(LangContext);
  return useMemo(
    () => ({
      lang,
      day: (iso: string) => dayL(iso, lang),
      weekday: (iso: string) => weekdayL(iso, lang),
      weekdays: (days: number[]) => weekdaysL(days, lang),
      measure: (n: number, unit: string) => measureL(n, unit, lang),
      packs: (n: number) => packWord(n, lang),
      ago: (iso: string, now?: number) => agoL(iso, lang, now),
      ruleTitle: (rule: string | undefined) => ruleTitleL(rule, lang),
      role: (role: string) => roleLabelL(role, lang),
      attr: (a: string) => attrL(a, lang),
      actor: (actor: string, names?: { agent?: string }) => actorLabelL(actor, lang, names),
      clock,
      fullDate,
      money,
      moneyShort,
      num,
    }),
    [lang],
  );
}

/**
 * The language switch: three square buttons, the active one filled. Each button names its language in that language
 * for screen readers ("Suomi"), and shows the short code.
 */
export function LangSwitch({ tone = "light", className = "" }: { tone?: "light" | "dark"; className?: string }) {
  const { lang, setLang } = useLang();
  const dark = tone === "dark";
  return (
    <div role="group" aria-label="Kieli, språk, language" className={`inline-flex shrink-0 border-2 ${dark ? "border-paper/60" : "border-petrol"} ${className}`}>
      {LANGS.map((l) => {
        const on = l === lang;
        return (
          <button
            key={l}
            type="button"
            lang={LANG_TAG[l]}
            aria-pressed={on}
            aria-label={LANG_NAME[l]}
            title={LANG_NAME[l]}
            onClick={() => setLang(l)}
            className={`min-h-9 min-w-10 px-2 text-[0.85rem] font-bold tabular ${
              on ? (dark ? "bg-paper text-petrol-deep" : "bg-petrol text-paper") : dark ? "text-paper hover:bg-paper/15" : "text-petrol hover:bg-petrol-soft"
            }`}
          >
            {LANG_SHORT[l]}
          </button>
        );
      })}
    </div>
  );
}
