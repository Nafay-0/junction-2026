import { cookies } from "next/headers";
import { DEFAULT_LANG, LANG_COOKIE, isLang, type Lang } from "./lang";

/**
 * The buyer's language from the cookie, for server components and `generateMetadata`. Reading cookies makes the
 * route dynamic: use it only on routes that already render per request (the store, the phone pages).
 */
export async function requestLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : DEFAULT_LANG;
}

/** The cookie's language, or undefined when the buyer never chose (the client then checks local storage). */
export async function chosenLang(): Promise<Lang | undefined> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : undefined;
}
