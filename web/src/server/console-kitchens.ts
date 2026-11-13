import { decodeJwt } from "jose";
import { signMandate, type Mandate } from "@/core/mandate";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "./demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { getRuntime } from "./runtime";

/**
 * Which kitchen a buyer console at /k/[kitchen] speaks for, and the credentials its agent presents.
 *
 * The console's server side plays the kitchen's purchasing agent: it holds the kitchen's signed mandate and
 * calls Dock's public REST API with it, exactly as an outside agent would. The browser never sees a mandate.
 *
 *   kaari      Ravintola Kaari: the returning kitchen with six weeks of history (demo-kitchen.ts)
 *   laakso     Laakso Catering: the partner's example org, no history (dev-fixtures.ts)
 *   sbx_...    a visitor's own kitchen, made by scanning the join QR code (sandboxes.ts)
 *
 * DEMO NOTE: anyone who can open the console URL can make that kitchen's agent ask for things. The agent still
 * cannot approve anything: sign-off needs the named person (their passkey, or the one-time link for the two
 * demo kitchens, which have no real person behind them).
 */
export type ConsoleKitchenInfo = {
  slug: string;
  kind: "demo" | "visitor";
  name: string;
  orgId: string;
  agentName: string;
  /** Who the console relays for, recorded in the ledger with every answer and confirmation. */
  by: string;
  mandate: {
    perOrderLimitCents: number;
    weeklyBudgetCents: number;
    allowedCategories: string[];
    requiredAttributes: string[];
    forbiddenAllergens: string[];
    maxLeadDays: number;
    substitution: Mandate["substitution"];
    approvers: { name: string; role: string; maxApprovalCents: number }[];
    validUntil: string;
  };
  /** Sentences worth trying here, shown under the request field. */
  examples: string[];
  expiresAt?: string;
};

type Resolved = { info: ConsoleKitchenInfo; mandateToken: string; agentId: string };

type DemoSlug = "kaari" | "laakso";

const TOKEN_TTL_MS = 60 * 60 * 1000; // re-sign the demo mandates hourly; they are valid for a week
const g = globalThis as typeof globalThis & { __dockConsoleTokens?: Map<DemoSlug, { token: string; at: number }> };

async function demoToken(slug: DemoSlug): Promise<string> {
  g.__dockConsoleTokens ??= new Map();
  const hit = g.__dockConsoleTokens.get(slug);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
  const now = new Date();
  const token = slug === "kaari" ? await signMandate(demoKitchenMandate(now), await demoKitchenKeyPair()) : await signMandate(demoMandate(now), await demoOrgKeyPair());
  g.__dockConsoleTokens.set(slug, { token, at: Date.now() });
  return token;
}

function summary(m: Mandate): ConsoleKitchenInfo["mandate"] {
  return {
    perOrderLimitCents: m.perOrderLimitCents,
    weeklyBudgetCents: m.weeklyBudgetCents,
    allowedCategories: m.allowedCategories,
    requiredAttributes: m.requiredAttributes,
    forbiddenAllergens: m.forbiddenAllergens,
    maxLeadDays: m.delivery.maxLeadDays,
    substitution: m.substitution,
    approvers: m.approvers.map((a) => ({ name: a.name, role: a.role, maxApprovalCents: a.maxApprovalCents })),
    validUntil: m.validUntil,
  };
}

const EXAMPLES: Record<DemoSlug, string[]> = {
  kaari: ["1,000 litres of lactose-free milk by Monday", "100 litres of milk for Thursday", "Same as last time, for Friday", "100 L milk for Wednesday, lowest CO2"],
  laakso: ["I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.", "200 litres of lactose-free milk for Wednesday, cheapest", "60 litres of oat drink for Tuesday"],
};

export async function resolveKitchen(slug: string): Promise<Resolved | undefined> {
  if (slug === "kaari") {
    const m = demoKitchenMandate(new Date());
    return {
      mandateToken: await demoToken("kaari"),
      agentId: KITCHEN_ORG.agentId,
      info: { slug, kind: "demo", name: KITCHEN_ORG.name, orgId: KITCHEN_ORG.orgId, agentName: "Kaari's buyer agent", by: "Kitchen staff at Ravintola Kaari", mandate: summary(m), examples: EXAMPLES.kaari },
    };
  }
  if (slug === "laakso") {
    const m = demoMandate(new Date());
    return {
      mandateToken: await demoToken("laakso"),
      agentId: DEMO_ORG.agentId,
      info: { slug, kind: "demo", name: DEMO_ORG.name, orgId: DEMO_ORG.orgId, agentName: "Laakso's buyer agent", by: "Kitchen staff at Laakso Catering", mandate: summary(m), examples: EXAMPLES.laakso },
    };
  }
  if (!/^sbx_[a-z0-9]+$/i.test(slug)) return undefined;
  const { sandboxes } = await getRuntime();
  const [s, creds] = [await sandboxes.get(slug), await sandboxes.agentCredentials(slug)];
  if (!s || !creds) return undefined;
  const m = (decodeJwt(creds.mandateToken) as { mandate: Mandate }).mandate;
  return {
    mandateToken: creds.mandateToken,
    agentId: creds.agentId,
    info: {
      slug,
      kind: "visitor",
      name: `${s.kitchenName}, ${s.city}`,
      orgId: s.orgId,
      agentName: s.agentName,
      by: `${s.approverName} (${s.roleLabel.toLowerCase()})`,
      mandate: summary(m),
      examples: EXAMPLES.laakso,
      expiresAt: s.expiresAt,
    },
  };
}

/** Kitchens a console can switch to right now: the two demo kitchens, then visitors' kitchens, newest first. */
export async function listConsoleKitchens(): Promise<{ slug: string; name: string; kind: "demo" | "visitor"; approverName?: string }[]> {
  const { sandboxes } = await getRuntime();
  const visitors = (await sandboxes.list())
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => ({ slug: s.sandboxId, name: `${s.kitchenName}, ${s.city}`, kind: "visitor" as const, approverName: s.approverName }));
  return [{ slug: "kaari", name: KITCHEN_ORG.name, kind: "demo" }, { slug: "laakso", name: DEMO_ORG.name, kind: "demo" }, ...visitors];
}
