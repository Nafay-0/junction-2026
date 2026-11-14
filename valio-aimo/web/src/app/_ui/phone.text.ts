import type { Lang } from "../_i18n/lang";
import { roleLabelL } from "../_i18n/format";

/**
 * A clock time the server wrote as "14:05" (en-GB), the way each language says it: "14:05" in English as it came,
 * "klo 14.05", "kl. 14.05".
 */
export function serverClock(t: string, lang: Lang): string {
  if (lang === "en") return t;
  const hm = /^\d{1,2}:\d{2}$/.test(t) ? t.replace(":", ".") : t;
  return lang === "fi" ? `klo ${hm}` : `kl. ${hm}`;
}

/**
 * A role label the server wrote in English ("Purchasing manager"), in the buyer's language when the role is one the
 * gate knows; otherwise as it came. English stays exactly as the server wrote it.
 */
export function serverRole(label: string, lang: Lang): string {
  if (lang === "en") return label;
  const code = label.trim().toLowerCase().replaceAll(" ", "_");
  const r = roleLabelL(code, lang);
  if (r === code.replaceAll("_", " ")) return label;
  return /^[A-Z]/.test(label) ? r.charAt(0).toUpperCase() + r.slice(1) : r;
}
