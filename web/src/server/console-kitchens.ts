import { decodeJwt } from "jose";
import { signMandate, type Mandate } from "@/core/mandate";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "./demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { getRuntime } from "./runtime";
import { USERNAME_RE } from "./accounts/names";

/**
 * Which kitchen a buyer console at /k/[kitchen] speaks for, and the credentials its agent presents.
 *
 * The console's server side plays the kitchen's purchasing agent: it holds the kitchen's signed mandate and
 * calls Dock's public REST API with it, exactly as an outside agent would. The browser never sees a mandate.
 *
 *   kaari      Ravintola Kaari: the returning kitchen with six weeks of history (demo-kitchen.ts)
 *   laakso     Laakso Catering: the partner's example org, no history (dev-fixtures.ts)
 *   sbx_...    a visitor's own kitchen, made by scanning the join QR code (sandboxes.ts)
 *   <username> a restaurant's own kitchen, behind its account (accounts/service.ts); private to that account
 *
 * Who may use a console is decided in server/authz.ts (consoleKitchen): the two demo kitchens are open to anyone at
 * the table; a visitor's kitchen only from the phone that joined it. Anyone at a demo kitchen can make its agent ask for things. The agent still
 * cannot approve anything: sign-off needs the named person (their passkey, or the one-time link for the two
 * demo kitchens, which have no real person behind them).
 */
export type KitchenKind = "demo" | "visitor" | "account";

export type ConsoleKitchenInfo = {
  slug: string;
  kind: KitchenKind;
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
  /** Account kitchens: the restaurant's username, and whether it is a shared test account (reset on a schedule). */
  account?: { username: string; shared: boolean };
};

type Resolved = { info: ConsoleKitchenInfo; mandateToken: string; agentId: string };

export type DemoSlug = "kaari" | "laakso";

const TOKEN_TTL_MS = 60 * 60 * 1000; // re-sign the demo mandates hourly; they are valid for a week
const g = globalThis as typeof globalThis & { __dockConsoleTokens?: Map<DemoSlug, { token: string; at: number; mandateId: string }> };

/**
 * A built-in demo kitchen's current mandate: today's terms, with everything the kitchen added through a reissue
 * and that reissue's id (server/mandates.ts). Before any reissue it is the template.
 */
export async function currentDemoMandate(slug: DemoSlug, now = new Date()): Promise<Mandate> {
  const { mandates } = await getRuntime();
  return mandates.restrict(slug === "kaari" ? demoKitchenMandate(now) : demoMandate(now), { current: true });
}

async function demoToken(slug: DemoSlug): Promise<string> {
  g.__dockConsoleTokens ??= new Map();
  const mandate = await currentDemoMandate(slug);
  const hit = g.__dockConsoleTokens.get(slug);
  // A reissue changes the mandate's id: the token signed before it is not presented again.
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS && hit.mandateId === mandate.mandateId) return hit.token;
  const token = await signMandate(mandate, slug === "kaari" ? await demoKitchenKeyPair() : await demoOrgKeyPair());
  g.__dockConsoleTokens.set(slug, { token, at: Date.now(), mandateId: mandate.mandateId });
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
    const m = await currentDemoMandate("kaari");
    return {
      mandateToken: await demoToken("kaari"),
      agentId: KITCHEN_ORG.agentId,
      info: { slug, kind: "demo", name: KITCHEN_ORG.name, orgId: KITCHEN_ORG.orgId, agentName: "Kaari's buyer agent", by: "Kitchen staff at Ravintola Kaari", mandate: summary(m), examples: EXAMPLES.kaari },
    };
  }
  if (slug === "laakso") {
    const m = await currentDemoMandate("laakso");
    return {
      mandateToken: await demoToken("laakso"),
      agentId: DEMO_ORG.agentId,
      info: { slug, kind: "demo", name: DEMO_ORG.name, orgId: DEMO_ORG.orgId, agentName: "Laakso's buyer agent", by: "Kitchen staff at Laakso Catering", mandate: summary(m), examples: EXAMPLES.laakso },
    };
  }
  if (USERNAME_RE.test(slug) && !slug.startsWith("sbx")) return accountKitchen(slug);
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

const ACCOUNT_EXAMPLES = ["100 litres of lactose-free milk for Thursday", "Same as last time, for Friday", "20 kg of wheat flour for Monday, cheapest"];

async function accountKitchen(slug: string): Promise<Resolved | undefined> {
  const { accounts } = await getRuntime();
  const found = await accounts.kitchenOf(slug);
  if (!found) return undefined;
  const { account: a, kitchen: k } = found;
  return {
    mandateToken: k.mandateToken,
    agentId: k.agentId,
    info: {
      slug,
      kind: "account",
      name: a.restaurant,
      orgId: k.orgId,
      agentName: `${a.restaurant}'s buyer agent`,
      by: `${a.restaurant} (signed in as ${a.username})`,
      mandate: summary(k.mandate),
      examples: ACCOUNT_EXAMPLES,
      account: { username: a.username, shared: a.kind === "test" },
    },
  };
}

/**
 * Kitchens a console can switch to right now: the signed-in account's own kitchen (a stage kitchen's too, when
 * signed in to it), then this phone's own visitor kitchen (pass the org of its approver session). Nobody else's
 * kitchen is listed, the stage kitchens included (server/authz.ts).
 */
export async function listConsoleKitchens(viewerOrgId?: string, viewerAccount?: { kitchen?: string; restaurant: string; kind: string }): Promise<{ slug: string; name: string; kind: KitchenKind; approverName?: string }[]> {
  const { sandboxes } = await getRuntime();
  const visitors = (await sandboxes.list())
    .filter((s) => viewerOrgId !== undefined && s.orgId === viewerOrgId)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => ({ slug: s.sandboxId, name: `${s.kitchenName}, ${s.city}`, kind: "visitor" as const, approverName: s.approverName }));
  const own = viewerAccount?.kitchen ? [{ slug: viewerAccount.kitchen, name: viewerAccount.restaurant, kind: viewerAccount.kind === "demo" ? ("demo" as const) : ("account" as const) }] : [];
  return [...own, ...visitors];
}
