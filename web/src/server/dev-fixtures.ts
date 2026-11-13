import { createPrivateKey } from "node:crypto";
import type { JWK } from "jose";
import { importEd25519KeyPair, type KeyPair } from "@/core/keys";
import type { Mandate } from "@/core/mandate";
import { addDays, sha256Hex } from "@/core/util";

/**
 * DEV ONLY. A fictional buyer organisation for demos and local runs.
 *
 * Its signing key is derived from a public string, so anyone with this repo can sign mandates for it.
 * That is fine for a keyless local demo and wrong for anything public: set DOCK_DEMO_ORG_JWK
 * (a private Ed25519 JWK) on a deployed instance, and give the same value to the demo script.
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
  const fromEnv = process.env.DOCK_DEMO_ORG_JWK;
  const jwk = fromEnv ? (JSON.parse(fromEnv) as JWK) : devJwkFromSeed(PUBLIC_DEV_SEED);
  return importEd25519KeyPair(DEMO_ORG.kid, jwk);
}

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
    weeklyBudgetCents: 200_000, // €2,000 hard cap per 7 days
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
    approvers: [{ role: SANDBOX_ROLE.id, name: input.approverName, maxApprovalCents: 1_000_000 }],
  });
}
