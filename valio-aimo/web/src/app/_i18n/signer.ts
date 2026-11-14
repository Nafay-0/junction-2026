import type { Lang } from "./lang";

/**
 * The person who gives the OK, as a sentence says them. The test kitchens name their signer by role ("Owner", "Food
 * service manager"): a role is said as a role, with "the" and in lower case in English ("the owner's OK"), in the
 * reader's language in Finnish and Swedish ("omistaja", "ägaren"). A person's name stays as it is ("Aino Virtanen").
 */
const ROLES: Record<string, { en: string; fi: string; sv: string }> = {
  owner: { en: "owner", fi: "omistaja", sv: "ägaren" },
  "kitchen manager": { en: "kitchen manager", fi: "keittiöpäällikkö", sv: "köksansvarige" },
  "head chef": { en: "head chef", fi: "keittiömestari", sv: "kökschefen" },
  "food service manager": { en: "food service manager", fi: "ruokapalvelupäällikkö", sv: "måltidschefen" },
  "purchasing manager": { en: "purchasing manager", fi: "hankintapäällikkö", sv: "inköpschefen" },
  "finance director": { en: "finance director", fi: "talousjohtaja", sv: "ekonomidirektören" },
  manager: { en: "manager", fi: "esihenkilö", sv: "chefen" },
  "the kitchen's signer": { en: "kitchen's signer", fi: "keittiön hyväksyjä", sv: "kökets godkännare" },
};

const roleOf = (name: string) => ROLES[name.trim().toLowerCase().replace(/^the\s+/, "")];

/** Whether the signer is named by role rather than as a person. */
export const isRole = (name: string): boolean => !!roleOf(name);

/** "the owner" / "omistaja" / "ägaren"; a person's name as it is. */
export function signerL(name: string, lang: Lang): string {
  const r = roleOf(name);
  if (!r) return name.trim();
  return lang === "en" ? `the ${r.en}` : r[lang];
}

/** English possessive: "the owner's", "Aino Virtanen's". */
export function signerPossessive(name: string): string {
  return `${signerL(name, "en")}'s`;
}
