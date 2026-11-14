import { createHash, randomBytes } from "node:crypto";
import { DockError } from "@/core/errors";
import { updateKitchenProfile } from "@/core/kitchen";
import { cleanRestaurantName, normaliseUsername, usernameProblem } from "../accounts/names";
import { hashPassword, passwordProblem } from "../accounts/password";
import { FREE_KITCHEN_HOURS, type SignedIn } from "../accounts/service";
import type { Account } from "../accounts/store";
import { DEFAULT_TERMS, PRODUCT_GROUPS, parseTerms, type MandateTerms } from "../accounts/terms";
import type { Runtime } from "../runtime";
import { deleteAccount } from "./service";

/**
 * A FRESH KITCHEN: the easiest way in for a judge. One click on /k, no form: an account with a generated username,
 * a generated kitchen name (renamed in one tap) and a password nobody is told (the browser's session cookie is the
 * key), signed with FREE-PLAY rules, empty memory and no history, marked demo (server/demo: the guide, staging,
 * start over) and fresh (`free`). It lives while it is used and is deleted after 24 hours without use (its ledger
 * entries stay, under the account's name, as a visitor's), unless its person keeps it with a sign-in name and a
 * password, which makes it an ordinary demo account without losing anything.
 *
 * It is an own account like any other (accounts/service.ts): the same ceiling on accounts, the same sign-ups per
 * address, the same model-spend, rate and live-call limits, private to its browser, and private on the operations
 * portal (an own account's words are hidden from viewers).
 */

/**
 * Free play: every product group, food and non-food; no diet, allergen, nutrition or label rules; per-order and weekly
 * amounts at the most the terms take, so neither binds in play; the longest lead time; substitutes inside the kitchen's
 * preferences taken without asking however much dearer (the gate still prices them from the wholesaler's signed quote).
 * What still stands: availability and cut-offs as the wholesaler states them, the mistake check (a large first order
 * is asked about once), the ledger.
 */
export const FREE_TERMS: MandateTerms = parseTerms({
  ...DEFAULT_TERMS,
  perOrderLimitEur: 50_000,
  weeklyBudgetEur: 200_000,
  groups: PRODUCT_GROUPS.map((g) => g.id),
  require: [],
  forbid: [],
  signer: "Kitchen owner",
  substitution: "within_preferences",
  maxLeadDays: 30,
  substituteMaxIncreasePct: 1000,
});

/** "Give this kitchen a limit": 250 € alone per order, so the sign-off on a phone can be seen in a fresh kitchen too. */
export const FREE_LIMIT_EUR = 250;

export const isFreePlay = (t: MandateTerms) => t.perOrderLimitEur >= FREE_TERMS.perOrderLimitEur;

const WORDS = ["Kide", "Lumi", "Aalto", "Kallio", "Sointu", "Lilja", "Pihlaja", "Tuuli", "Majakka", "Ranta", "Kuusi", "Halla", "Vire", "Usva", "Kajo", "Laine"];
const KINDS = ["Bistro", "Kitchen", "Café", "Brasserie", "Canteen"];

function generated(): { username: string; restaurant: string } {
  const b = randomBytes(4);
  const word = WORDS[b[0] % WORDS.length];
  const kind = KINDS[b[1] % KINDS.length];
  return { username: `fresh-${word.toLowerCase()}-${b.readUInt16BE(2).toString(36)}`, restaurant: `${kind} ${word}` };
}

/** Fresh kitchens not kept and not used for 24 hours go: the account, its key and signer; the ledger keeps everything. */
export async function sweepFreeKitchens(rt: Runtime, now = new Date()): Promise<string[]> {
  const gone: string[] = [];
  for (const a of await rt.accounts.store.list()) {
    if (!a.free || a.free.kept || now.getTime() - Date.parse(a.free.lastUsedAt) < FREE_KITCHEN_HOURS * 3_600_000) continue;
    rt.dock.ledger.append({ type: "intake", actor: "dock", summary: `The fresh kitchen ${a.restaurant} (${a.username}), a visitor's, was not used for ${FREE_KITCHEN_HOURS} hours and is deleted; its records stay in the ledger as a visitor's.`, data: { step: "fresh_kitchen_expired", orgId: a.kitchen?.orgId, username: a.username, visitor: true } });
    await deleteAccount(rt, a, now).catch((err: Error) => console.warn("[fresh] expiry", err.message));
    gone.push(a.username);
  }
  return gone;
}

/**
 * Start a fresh kitchen for this browser, or give back the one it already has (`fresh`: start over with a new one;
 * the old one, unless kept, is deleted). Returns the session to set when a new one was made.
 */
export async function startFreeKitchen(rt: Runtime, input: { current?: Account; address: string; fresh?: boolean; now?: Date }): Promise<{ next: string; created: boolean; signedIn?: SignedIn; username: string }> {
  const now = input.now ?? new Date();
  const cur = input.current;
  if (cur?.free && cur.kitchen && !input.fresh) return { next: `/k/${cur.username}`, created: false, username: cur.username };
  await sweepFreeKitchens(rt, now).catch(() => []);
  if (cur?.free && !cur.free.kept && input.fresh) await deleteAccount(rt, cur, now).catch(() => undefined);
  let signedIn: SignedIn | undefined;
  for (let i = 0; i < 5 && !signedIn; i++) {
    const g = generated();
    // A password nobody is told: the session is the key until its person keeps the kitchen with one of their own.
    signedIn = await rt.accounts.signUp({ restaurant: g.restaurant, username: g.username, password: randomBytes(24).toString("base64url") }, input.address).catch((err) => {
      if (err instanceof DockError && err.code === "username_taken") return undefined;
      throw err;
    });
  }
  if (!signedIn) throw new DockError(503, "fresh_kitchen_failed", "No fresh kitchen could be made just now. Try again.", "account");
  const username = signedIn.account.username;
  const a = (await rt.accounts.get(username))!;
  await rt.accounts.store.put({ ...a, free: { at: now.toISOString(), lastUsedAt: now.toISOString() }, demo: { ...(a.demo ?? { at: now.toISOString() }), start: "empty", startedAt: now.toISOString(), onboarded: FREE_TERMS, remembered: [] } });
  const signed = await rt.accounts.signKitchen(username, FREE_TERMS);
  // Deliveries on any day the wholesaler delivers: no delivery-day rule of the kitchen's own.
  await updateKitchenProfile(rt.kitchens, signed.kitchen!.orgId, (p) => (p ? { ...p, deliveryWeekdays: [1, 2, 3, 4, 5, 6, 7] } : p));
  rt.dock.ledger.append({
    type: "intake",
    actor: `account:${username}`,
    summary: `A visitor started a fresh kitchen, ${a.restaurant}: free play (every product group, no diet, allergen or nutrition rules, no spending limit of its own), empty memory, no history. It lives in that browser and goes after ${FREE_KITCHEN_HOURS} hours without use unless kept.`,
    data: { step: "fresh_kitchen", orgId: signed.kitchen!.orgId, username, visitor: true, demo: true, addressHash: createHash("sha256").update(input.address).digest("hex").slice(0, 16) },
  });
  return { next: `/k/${username}`, created: true, signedIn, username };
}

/** Rename the fresh kitchen (one tap): the name the store and its agent use. */
export async function renameFreeKitchen(rt: Runtime, a: Account, name: unknown): Promise<{ restaurant: string }> {
  if (!a.free) throw new DockError(409, "not_a_fresh_kitchen", "Only a fresh kitchen is renamed here.", "account");
  const restaurant = cleanRestaurantName(name);
  if (!restaurant) throw new DockError(400, "restaurant_invalid", "Give the kitchen a name, 2 to 80 characters.", "account");
  await rt.accounts.store.put({ ...a, restaurant });
  rt.dock.ledger.append({ type: "intake", actor: `account:${a.username}`, summary: `The fresh kitchen ${a.restaurant} is now called ${restaurant}.`, data: { step: "fresh_renamed", orgId: a.kitchen?.orgId } });
  return { restaurant };
}

/**
 * Keep it: a sign-in name and a password of the visitor's own. The kitchen, its orders, memory, conversation and
 * passkey stay exactly as they are (its address, the generated username, does not change); it no longer expires.
 */
export async function keepFreeKitchen(rt: Runtime, a: Account, input: { login?: unknown; password?: unknown }, now = new Date()): Promise<{ login: string }> {
  if (!a.free) throw new DockError(409, "not_a_fresh_kitchen", "Only a fresh kitchen is kept here.", "account");
  const login = normaliseUsername(input.login);
  const up = usernameProblem(login);
  if (up) throw new DockError(400, up, up === "username_reserved" ? "That name is used by the shop itself. Choose another." : "A sign-in name is 3 to 32 characters: letters a to z, digits, hyphen or underscore.", "account");
  const pp = passwordProblem(input.password);
  if (pp) throw new DockError(400, pp, pp === "password_too_short" ? "A password needs at least 10 characters." : "Choose a password.", "account");
  const taken = login !== a.username && (!!(await rt.accounts.store.get(login)) || (await rt.accounts.store.list()).some((x) => x.login === login && x.username !== a.username));
  if (taken) throw new DockError(409, "username_taken", "That name is taken. Choose another.", "account");
  await rt.accounts.store.put({ ...a, ...(login !== a.username ? { login } : {}), passwordHash: await hashPassword(input.password as string), free: { ...a.free, kept: now.toISOString() } });
  rt.dock.ledger.append({ type: "intake", actor: `account:${a.username}`, summary: `${a.restaurant}, a fresh kitchen, was kept as an ordinary demo account: its person set a sign-in name and a password. Nothing else changed.`, data: { step: "fresh_kept", orgId: a.kitchen?.orgId } });
  return { login };
}

/**
 * "Give this kitchen a limit": 250 € alone per order, the rest of the free-play rules as they are, so an order over it
 * waits for the kitchen's signer, whose passkey is this browser's. A narrowing, signed as the account signs its rules;
 * it needs a passkey for the signer first, so the sign-off it leads to can be given.
 */
export async function giveFreeKitchenLimit(rt: Runtime, a: Account, eur = FREE_LIMIT_EUR): Promise<{ perOrderLimitEur: number }> {
  if (!a.kitchen) throw new DockError(409, "no_kitchen_yet", "Finish setting up the kitchen first.", "account");
  const devices = await rt.accounts.devices(a);
  if (!devices.devices.length) throw new DockError(409, "device_needed", "Add this browser's passkey first: it is the one that OKs orders over the limit.", "account");
  const terms = parseTerms({ ...a.kitchen.terms, perOrderLimitEur: eur, weeklyBudgetEur: Math.max(a.kitchen.terms.weeklyBudgetEur, eur) });
  await rt.accounts.signKitchen(a.username, terms);
  rt.dock.ledger.append({ type: "intake", actor: `account:${a.username}`, summary: `${a.restaurant} gave itself a limit: its agent may now spend ${eur} € alone per order; above that ${terms.signer} OKs it with this browser's passkey.`, data: { step: "fresh_limit", orgId: a.kitchen.orgId, perOrderLimitEur: eur } });
  return { perOrderLimitEur: eur };
}

const gs = globalThis as typeof globalThis & { __dockFreeSweep?: NodeJS.Timeout };

/** The hourly sweep of fresh kitchens (not under tests or during a build). One timer per process; it never keeps it alive. */
export function scheduleFreeKitchenSweep(rt: Runtime): void {
  if (process.env.VITEST || process.env.NEXT_PHASE === "phase-production-build") return;
  if (gs.__dockFreeSweep) clearInterval(gs.__dockFreeSweep);
  gs.__dockFreeSweep = setInterval(() => void sweepFreeKitchens(rt).catch((err: Error) => console.warn("[fresh] sweep", err.message)), 60 * 60_000);
  gs.__dockFreeSweep.unref();
}
