import { createHash, timingSafeEqual } from "node:crypto";
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { DockError } from "@/core/errors";
import type { Mandate } from "@/core/mandate";
import { PasskeyError, type RelyingParty } from "@/core/passkeys";
import { newId } from "@/core/util";
import { KITCHEN_ORG, demoKitchenMandate } from "./demo-kitchen";
import { DEMO_ORG, demoMandate } from "./dev-fixtures";
import { opsPasscode } from "./ops/access";
import type { Runtime } from "./runtime";

/**
 * A presenter becomes a built-in demo kitchen's approver on their own phone.
 *
 * The two demo kitchens (/k/kaari, /k/laakso) name fictional approvers (Sanna Koskinen, Aino Virtanen, ...), so
 * nobody holds their passkey and a production build has no way to sign their orders. A person who knows the
 * operations passcode (DOCK_OPS_PASSCODE) can take one of those approver roles with a passkey made on their own
 * phone: one enrolment ceremony, after which sign-off works exactly as for a visitor (passkey bound to the order's
 * digest; the phone's session can only decline). There is no tap-to-approve shortcut.
 *
 * - The passcode is checked before any passkey prompt is issued; wrong guesses are limited per client address.
 * - Enrolling again for the same kitchen and role replaces the earlier presenter (lost phone, next presenter);
 *   both enrolments are written to the ledger with the name the presenter gave.
 * - Without DOCK_OPS_PASSCODE, enrolment is open outside production (local demos) and refused in production.
 */

export const PRESENTER_HOURS = 48;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 10 * 60_000;

export type DemoKitchenSlug = "kaari" | "laakso";

export type PresenterRole = { slug: DemoKitchenSlug; kitchenName: string; orgId: string; role: string; name: string; maxApprovalCents: number };

function demoMandateOf(slug: DemoKitchenSlug, now: Date): Mandate {
  return slug === "kaari" ? demoKitchenMandate(now) : demoMandate(now);
}

/** The approver roles of a built-in demo kitchen a presenter can take. Undefined for any other slug. */
export function presenterRoles(slug: string, now = new Date()): PresenterRole[] | undefined {
  if (slug !== "kaari" && slug !== "laakso") return undefined;
  const m = demoMandateOf(slug, now);
  return m.approvers.map((a) => ({ slug, kitchenName: slug === "kaari" ? KITCHEN_ORG.name : DEMO_ORG.name, orgId: m.issuer.orgId, role: a.role, name: a.name, maxApprovalCents: a.maxApprovalCents }));
}

export function isDemoKitchenOrg(orgId: string): boolean {
  return orgId === KITCHEN_ORG.orgId || orgId === DEMO_ORG.orgId;
}

const g = globalThis as typeof globalThis & { __dockPresenterFailures?: Map<string, number[]> };
const failures = (g.__dockPresenterFailures ??= new Map<string, number[]>());
const digest = (s: string) => createHash("sha256").update(s).digest();

/** Check the operations passcode for an enrolment. Throws 401 (wrong), 429 (too many wrong) or 503 (not configured). */
export function checkPresenterPasscode(passcode: unknown, client: string, now = Date.now()): void {
  const recent = (failures.get(client) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
  failures.set(client, recent);
  if (recent.length >= MAX_FAILURES) {
    const wait = Math.ceil((recent[0] + FAILURE_WINDOW_MS - now) / 60_000);
    throw new DockError(429, "passcode_attempts_exceeded", `Too many wrong passcodes from this address. Try again in ${wait} min.`, "approver_identity");
  }
  const required = opsPasscode();
  if (!required) {
    if (process.env.NODE_ENV === "production") {
      throw new DockError(503, "presenter_enrolment_off", "Presenter enrolment needs DOCK_OPS_PASSCODE set on this server.", "approver_identity");
    }
    return; // local demo: the operations portal is open too
  }
  if (typeof passcode !== "string" || !timingSafeEqual(digest(passcode), digest(required))) {
    recent.push(now);
    throw new DockError(401, "ops_passcode_wrong", "That passcode is not right. Ask the person running the demo.", "approver_identity");
  }
}

/** Tests only. */
export function resetPresenterFailures(): void {
  failures.clear();
}

export type PresenterContext = { kind: "presenter"; slug: DemoKitchenSlug; orgId: string; role: string; name: string; presenter: string };

/** Step 1, after the passcode: the passkey prompt for this kitchen role. Nothing changes until step 2. */
export async function beginPresenterEnrolment(
  rt: Runtime,
  rp: RelyingParty,
  input: { kitchen?: unknown; role?: unknown; passcode?: unknown; presenter?: unknown; client: string },
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; approver: PresenterRole; replaces?: string }> {
  checkPresenterPasscode(input.passcode, input.client);
  const roles = typeof input.kitchen === "string" ? presenterRoles(input.kitchen) : undefined;
  if (!roles) throw new DockError(404, "kitchen_not_found", "Presenters can only enrol for the built-in demo kitchens (kaari, laakso).");
  const r = roles.find((x) => x.role === input.role) ?? (input.role === undefined ? roles[0] : undefined);
  if (!r) throw new DockError(400, "role_unknown", `No approver role ${String(input.role)} at ${roles[0].kitchenName}; roles: ${roles.map((x) => x.role).join(", ")}.`);
  const presenter = typeof input.presenter === "string" && input.presenter.trim() ? input.presenter.trim().slice(0, 60) : "Presenter";
  const ctx: PresenterContext = { kind: "presenter", slug: r.slug, orgId: r.orgId, role: r.role, name: r.name, presenter };
  const { options } = await rt.passkeys.registrationOptions(rp, { name: `${r.name} · ${r.kitchenName} (demo)`, displayName: `${r.name} (${presenter})` }, { presenter: ctx });
  const existing = await rt.passkeys.store.findApprover(r.orgId, r.role);
  return { options, approver: r, replaces: existing?.name };
}

/** Step 2: the phone made a passkey. Store it as this demo kitchen role's approver and sign the phone in. */
export async function completePresenterEnrolment(rt: Runtime, response: RegistrationResponseJSON, now = new Date()): Promise<{ approver: PresenterRole; sessionToken: string; expiresAt: string }> {
  const reg = await rt.passkeys.verifyRegistration(response);
  const ctx = reg.context.presenter as PresenterContext | undefined;
  if (!ctx || ctx.kind !== "presenter") throw new PasskeyError(400, "registration_unknown", "This passkey prompt was not for a presenter enrolment.");
  const role = presenterRoles(ctx.slug, now)?.find((r) => r.role === ctx.role);
  if (!role) throw new PasskeyError(400, "registration_unknown", "That demo kitchen role no longer exists.");
  const existing = await rt.passkeys.store.findApprover(ctx.orgId, ctx.role);
  if (existing) await rt.passkeys.store.deleteAccount(existing.approverId);
  const expiresAt = new Date(now.getTime() + PRESENTER_HOURS * 3600_000).toISOString();
  const approverId = newId("apv");
  await rt.passkeys.enrol({ approverId, orgId: ctx.orgId, role: ctx.role, name: ctx.name, userHandle: reg.userHandle, createdAt: now.toISOString(), expiresAt }, reg.credential);
  rt.dock.ledger.append({
    type: "approval",
    actor: `approver:${ctx.role}`,
    summary: `${ctx.presenter} enrolled a passkey to sign for ${ctx.name} (${ctx.role.replaceAll("_", " ")}) at the demo kitchen ${role.kitchenName}, authorised by the operations passcode${existing ? `; this replaces the earlier presenter's passkey` : ""}. Sign-off from now on needs this passkey.`,
    data: { step: "presenter_enrolled", orgId: ctx.orgId, role: ctx.role, approverId, credentialId: reg.credential.credentialId, presenter: ctx.presenter, replaced: existing?.approverId, expiresAt },
  });
  const sessionToken = await rt.passkeys.newSession(approverId, new Date(expiresAt));
  return { approver: role, sessionToken, expiresAt };
}
