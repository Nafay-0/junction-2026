import { createPrivateKey } from "node:crypto";
import type { JWK } from "jose";
import { generateEd25519KeyPair, importEd25519KeyPair, type KeyPair } from "@/core/keys";
import type { Mandate } from "@/core/mandate";
import { addDays, sha256Hex } from "@/core/util";

/**
 * DEV ONLY. A fictional buyer organisation for demos and local runs.
 *
 * Without DOCK_DEMO_ORG_JWK its signing key is derived from a public string, so anyone with this repo can sign
 * mandates for it. That is fine for a keyless local demo and never trusted on a public site (see demoKey below):
 * set DOCK_DEMO_ORG_JWK (a private Ed25519 JWK) on a deployed instance, and give the same value to the demo script.
 */
export const DEMO_ORG = {
  orgId: "org_laakso_catering",
  name: "Laakso Catering Oy",
  kid: "laakso-catering-2026",
  agentId: "agent_laakso_buyer_01",
};

const PUBLIC_DEV_SEED = "dock demo buyer org key v1 - public, not a secret";

function devJwkFromSeed(seedText: string): JWK {
  const seed = Buffer.from(sha256Hex(seedText), "hex"); // 32 bytes
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }).export({ format: "jwk" }) as JWK;
}

export async function demoOrgKeyPair(): Promise<KeyPair> {
  return demoKey("DOCK_DEMO_ORG_JWK", DEMO_ORG.kid, PUBLIC_DEV_SEED);
}

/**
 * Does this process serve a public address? DOCK_PUBLIC_URL names a host other than this machine (the deployed
 * site sets it, for links and passkeys; local runs and the test servers leave it empty or on localhost).
 */
export function servesPublicSite(): boolean {
  const url = process.env.DOCK_PUBLIC_URL?.trim();
  if (!url) return false;
  try {
    return !/^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export type DemoKeySource = "fixed" | "public dev key" | "process key";

/** Where a demo organisation's key comes from in this process (shown on /api/health). */
export function demoKeySource(envName: string): DemoKeySource {
  return process.env[envName]?.trim() ? "fixed" : servesPublicSite() ? "process key" : "public dev key";
}

const g = globalThis as typeof globalThis & { __dockProcessKeys?: Map<string, Promise<KeyPair>> };

/**
 * A demo organisation's signing key:
 *   fixed            the private JWK in the environment (what a deployment sets, and gives to its own scripts)
 *   public dev key   derived from a string in this repository, so anyone can sign mandates with it: for keyless
 *                    local runs and tests only
 *   process key      on a public site with no JWK configured, the repository's key is NOT trusted: the
 *                    organisation gets a random key that lives in this process. Its own store keeps working (the
 *                    server signs its mandates); nobody outside can mint a mandate for it.
 * So nothing on a public site can be ordered with a mandate signed by a key that sits in a public repository.
 */
export async function demoKey(envName: string, kid: string, publicSeed: string): Promise<KeyPair> {
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return importEd25519KeyPair(kid, JSON.parse(fromEnv) as JWK);
  if (!servesPublicSite()) return importEd25519KeyPair(kid, devJwkFromSeed(publicSeed));
  const keys = (g.__dockProcessKeys ??= new Map());
  let key = keys.get(kid);
  if (!key) keys.set(kid, (key = generateEd25519KeyPair(kid)));
  return key;
}

/** The key anyone can derive from this repository, for tests of the rule above. */
export function publicDevKeyPair(kid: string, publicSeed: string = PUBLIC_DEV_SEED): Promise<KeyPair> {
  return importEd25519KeyPair(kid, devJwkFromSeed(publicSeed));
}

/**
 * The weekly budget of the built-in demo kitchens (Laakso, Kaari, and their menu agents: the budget counts every
 * order of the organisation, so all four mandates carry the same figure). Sized for a full day of demonstrations
 * on one deployment without a reset: about 40 runs of the 1,000-litre example (EUR 1,400 to 1,600 each on the
 * partner's prices and the seed) and about 40 menu orders (EUR 300 to 2,500), roughly EUR 125,000, plus headroom.
 * The per-order limits are what make the 1,000-litre order go to a person, and they stay low (EUR 1,000 for Laakso,
 * EUR 100 for Kaari). Visitor kitchens are fresh organisations and keep their own EUR 10,000 cap.
 * To start a demo day with an empty week anyway, see infra/RUNBOOK.md ("Reset the demo kitchens").
 */
export const DEMO_WEEKLY_BUDGET_CENTS = 15_000_000;

/** The demo mandate: lactose-free milk and plant drinks for a catering kitchen. */
export function demoMandate(now: Date, overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandateId: `mnd_laakso_${now.toISOString().slice(0, 10).replaceAll("-", "")}`,
    issuer: { orgId: DEMO_ORG.orgId, name: DEMO_ORG.name },
    agentId: DEMO_ORG.agentId,
    validFrom: new Date(now.getTime() - 60_000).toISOString(),
    validUntil: addDays(now, 7).toISOString(),
    currency: "EUR",
    perOrderLimitCents: 100_000, // €1,000 alone
    weeklyBudgetCents: DEMO_WEEKLY_BUDGET_CENTS, // hard cap per 7 days, sized for a day of demos (see above)
    allowedCategories: ["milk", "plant_drink"],
    requiredAttributes: ["lactose_free"],
    forbiddenAllergens: ["gluten", "nuts"],
    requiredCertificates: [],
    delivery: { maxLeadDays: 5 },
    substitution: { rule: "needs_approval", maxPriceIncreasePct: 10 },
    approvers: [
      { role: "kitchen_manager", name: "Aino Virtanen", maxApprovalCents: 250_000 },
      { role: "finance_director", name: "Mikko Laine", maxApprovalCents: 1_000_000 },
    ],
    ...overrides,
  };
}

// ---------- visitor kitchens (the "scan the QR code" demo) ----------

/** The mandate role a visitor fills when they join. */
export const SANDBOX_ROLE = { id: "purchasing_manager", label: "Purchasing manager" };
/** What a visitor kitchen's agent may spend per order without asking: €500. */
export const SANDBOX_PER_ORDER_LIMIT_CENTS = 50_000;

const KITCHENS = ["Hotel Kaleva", "Hotel Aurora", "Hotel Saimaa", "Hotel Lumo", "Hotel Pohjola", "Hotel Revontuli", "Hotel Merikatu", "Hotel Tammi", "Hotel Kuura", "Hotel Ilves"];
const CITIES = ["Helsinki", "Espoo", "Tampere", "Turku", "Oulu", "Jyväskylä", "Lahti", "Kuopio"];
const FIRST = ["Aino", "Eero", "Helmi", "Juho", "Lumi", "Onni", "Sanna", "Veera", "Mikael", "Iida", "Leevi", "Ella"];
const LAST = ["Virtanen", "Korhonen", "Mäkinen", "Nieminen", "Heikkinen", "Koskinen", "Järvinen", "Lehtonen", "Saarinen", "Salo"];

export type SandboxIdentity = { kitchenName: string; city: string; approverName: string; agentName: string };

/** A fictional hotel kitchen and its purchasing manager, for one visitor. Names are made up. */
export function sandboxIdentity(seq: number, random = Math.random): SandboxIdentity {
  const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const kitchenName = `${KITCHENS[seq % KITCHENS.length]} kitchen`;
  return { kitchenName, city: pick(CITIES), approverName: `${pick(FIRST)} ${pick(LAST)}`, agentName: `${KITCHENS[seq % KITCHENS.length]} buyer agent` };
}

/**
 * The visitor kitchen's mandate: the demo mandate with a €500 per-order limit, so the 1,000 L milk order
 * needs the visitor's sign-off, and the visitor as the only approver. Valid only while the sandbox lives.
 */
export function sandboxMandate(input: {
  now: Date;
  expiresAt: Date;
  orgId: string;
  orgName: string;
  agentId: string;
  approverName: string;
}): Mandate {
  return demoMandate(input.now, {
    mandateId: `mnd_${input.orgId}`,
    issuer: { orgId: input.orgId, name: input.orgName },
    agentId: input.agentId,
    validFrom: new Date(input.now.getTime() - 60_000).toISOString(),
    validUntil: input.expiresAt.toISOString(),
    perOrderLimitCents: SANDBOX_PER_ORDER_LIMIT_CENTS,
    weeklyBudgetCents: 1_000_000, // €10,000 hard cap, so a visitor can try a few orders
    substitution: { rule: "within_preferences", maxPriceIncreasePct: 10 }, // like for like alone; anything else to the visitor
    approvers: [{ role: SANDBOX_ROLE.id, name: input.approverName, maxApprovalCents: 1_000_000 }],
  });
}
