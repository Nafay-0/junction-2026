import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DockError } from "@/core/orders";

/**
 * Connector addresses: Dock reachable with nothing but a URL.
 *
 * Consumer assistants (the Claude apps, ChatGPT) let a user add a remote MCP server by URL, with OAuth or with no
 * sign-in, but not with custom request headers, so they cannot present a mandate the way /api/mcp expects. A
 * connector address is a per-kitchen URL, `/api/mcp/c/<token>`, whose token is an unguessable, revocable
 * credential bound on the server to that kitchen's signed mandate and agent id. A call through it is exactly a
 * call to /api/mcp with that mandate in the headers: the same mandate verification, the same gate, limits and
 * human sign-off. It grants nothing more: there is no approval tool, and the token is no approval proof.
 *
 *   token       `dk_` + 43 base64url characters (256 bits). Held only by the kitchen and the assistant it set up.
 *   visitor     random at first request; lives exactly as long as the visitor's sandbox kitchen.
 *   demo        with DOCK_CONNECTOR_SECRET set: HMAC(secret, kitchen), so the address is the same on every
 *               restart and deploy; without it: random, for the life of the process.
 *   revoke      the old token stops at once (404). Reissue = revoke + a new random token.
 *
 * In memory, per server process, like the rest of the runtime. A revoked demo address comes back after a restart
 * (it is derived from configuration); to retire it for good, change DOCK_CONNECTOR_SECRET.
 * In production the server would keep only the token's hash; it keeps the token here so the portal can show the
 * address again.
 */

export type ConnectorKitchen = {
  slug: string;
  kind: "demo" | "visitor" | "account";
  name: string;
  mandateToken: string;
  agentId: string;
  /** Who uses this kitchen's connector, for the audit trail when the assistant does not say. */
  by: string;
  /** Visitor kitchens: when the sandbox closes. */
  expiresAt?: string;
};

export type Connector = {
  connectorId: string;
  kitchen: string;
  token: string;
  source: "configured" | "issued";
  createdAt: string;
  expiresAt?: string;
};

export type ConnectorResolution =
  | { ok: true; connector: Connector; kitchen: ConnectorKitchen }
  | { ok: false; reason: "unknown" | "revoked" | "expired"; connectorId?: string; kitchen?: string };

export type ConnectorDeps = {
  resolveKitchen: (slug: string) => Promise<ConnectorKitchen | undefined>;
  /** Kitchens whose first address is derived from the secret (stable across restarts). */
  demoKitchens: readonly string[];
  secret?: () => string | undefined;
  now?: () => Date;
  limits?: ConnectorLimits;
};

const TOKEN_RE = /^dk_[A-Za-z0-9_-]{43}$/;
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const idOf = (token: string) => `con_${hashOf(token).slice(0, 12)}`;
const b64url = (buf: Buffer) => buf.toString("base64url");

export function connectorSecret(): string | undefined {
  const s = process.env.DOCK_CONNECTOR_SECRET?.trim();
  return s && s.length >= 16 ? s : undefined;
}

export class ConnectorService {
  private readonly byHash = new Map<string, Connector>();
  private readonly active = new Map<string, Connector>();
  private readonly revoked = new Map<string, { connectorId: string; kitchen: string; at: string }>();
  /** Kitchens whose address was revoked without a new one: GET shows none until someone issues one. */
  private readonly closed = new Set<string>();
  private readonly now: () => Date;
  readonly limiter: ConnectorLimiter;

  constructor(private readonly deps: ConnectorDeps) {
    this.now = deps.now ?? (() => new Date());
    this.limiter = new ConnectorLimiter(deps.limits, this.now);
  }

  private configuredToken(kitchen: string): string | undefined {
    const secret = this.deps.secret?.();
    if (!secret || !this.deps.demoKitchens.includes(kitchen)) return undefined;
    return `dk_${b64url(createHmac("sha256", secret).update(`dock-connector:v1:${kitchen}`).digest())}`;
  }

  private store(kitchen: ConnectorKitchen, token: string, source: Connector["source"]): Connector {
    const c: Connector = { connectorId: idOf(token), kitchen: kitchen.slug, token, source, createdAt: this.now().toISOString(), expiresAt: kitchen.expiresAt };
    this.byHash.set(hashOf(token), c);
    this.active.set(kitchen.slug, c);
    this.closed.delete(kitchen.slug);
    return c;
  }

  private create(kitchen: ConnectorKitchen): Connector {
    const configured = this.configuredToken(kitchen.slug);
    if (configured && !this.revoked.has(hashOf(configured))) return this.store(kitchen, configured, "configured");
    return this.store(kitchen, `dk_${b64url(randomBytes(32))}`, "issued");
  }

  private live(c: Connector | undefined): c is Connector {
    return !!c && (!c.expiresAt || Date.parse(c.expiresAt) > this.now().getTime());
  }

  /** The kitchen's current address, issuing the first one on demand. Null once revoked; undefined: no such kitchen. */
  async current(slug: string): Promise<Connector | null | undefined> {
    const kitchen = await this.deps.resolveKitchen(slug);
    if (!kitchen) return undefined;
    const c = this.active.get(slug);
    if (this.live(c)) return c;
    if (this.closed.has(slug)) return null;
    return this.create(kitchen);
  }

  /** Stop the current address at once and leave the kitchen with none. */
  async revoke(slug: string): Promise<Connector | undefined> {
    const kitchen = await this.deps.resolveKitchen(slug);
    if (!kitchen) return undefined;
    const c = this.active.get(slug) ?? (this.configuredToken(slug) ? this.create(kitchen) : undefined);
    if (c) {
      const h = hashOf(c.token);
      this.revoked.set(h, { connectorId: c.connectorId, kitchen: slug, at: this.now().toISOString() });
      this.byHash.delete(h);
      this.active.delete(slug);
    }
    this.closed.add(slug);
    return c;
  }

  /** Revoke the current address (if any) and issue a new random one. */
  async reissue(slug: string): Promise<Connector | undefined> {
    const kitchen = await this.deps.resolveKitchen(slug);
    if (!kitchen) return undefined;
    await this.revoke(slug);
    return this.store(kitchen, `dk_${b64url(randomBytes(32))}`, "issued");
  }

  /** What a presented token stands for. Constant-time where it compares secrets. */
  async resolve(token: string): Promise<ConnectorResolution> {
    if (!TOKEN_RE.test(token)) return { ok: false, reason: "unknown" };
    const h = hashOf(token);
    const gone = this.revoked.get(h);
    if (gone) return { ok: false, reason: "revoked", connectorId: gone.connectorId, kitchen: gone.kitchen };
    let c = this.byHash.get(h);
    if (!c) {
      // A configured demo address after a restart: derived, not stored. Recognise it and make it current.
      const slug = this.deps.demoKitchens.find((k) => {
        const t = this.configuredToken(k);
        return !!t && t.length === token.length && timingSafeEqual(Buffer.from(t), Buffer.from(token));
      });
      if (!slug || this.active.has(slug) || this.closed.has(slug)) return { ok: false, reason: "unknown" };
      const kitchen = await this.deps.resolveKitchen(slug);
      if (!kitchen) return { ok: false, reason: "unknown" };
      c = this.store(kitchen, token, "configured");
    }
    const kitchen = await this.deps.resolveKitchen(c.kitchen);
    if (!kitchen || !this.live(c)) return { ok: false, reason: "expired", connectorId: c.connectorId, kitchen: c.kitchen };
    return { ok: true, connector: c, kitchen };
  }
}

// ---------- per-address limits ----------

/**
 * A leaked address must not allow unbounded load or spend. Spend is already bounded by the mandate itself (the
 * per-order limit above which a person signs off, and the hard weekly budget no sign-off lifts) and live lookups
 * by the per-agent allowance in the core. On top, per address:
 *   http       every HTTP request (tools/list, calls, handshakes): load
 *   requests   new purchase requests (submit_need, open_request): ledger growth
 *   orders     place_order calls: each one that needs sign-off pings a person's phone
 */
export const CONNECTOR_LIMITS = {
  http: { max: 120, windowMinutes: 1 },
  requests: { max: 20, windowMinutes: 60 },
  orders: { max: 6, windowMinutes: 60 },
};
export type ConnectorLimits = typeof CONNECTOR_LIMITS;
export type ConnectorLimitKind = keyof ConnectorLimits;

const WHAT: Record<ConnectorLimitKind, string> = { http: "requests", requests: "new purchase requests", orders: "orders" };

export class ConnectorLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    readonly limits: ConnectorLimits = CONNECTOR_LIMITS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Count one use, or throw a 429 refusal (rule connector_rate_limit) saying when to try again. */
  hit(connectorId: string, kind: ConnectorLimitKind): void {
    const { max, windowMinutes } = this.limits[kind];
    const key = `${connectorId}:${kind}`;
    const t = this.now().getTime();
    const since = t - windowMinutes * 60_000;
    const kept = (this.hits.get(key) ?? []).filter((x) => x > since);
    if (kept.length >= max) {
      this.hits.set(key, kept);
      const retryAfterSeconds = Math.max(1, Math.ceil((kept[0] + windowMinutes * 60_000 - t) / 1000));
      throw new DockError(
        429,
        "connector_rate_limited",
        `This connector address already made ${kept.length} ${WHAT[kind]} in the last ${windowMinutes === 1 ? "minute" : `${windowMinutes} minutes`}; the limit is ${max}. Try again in ${retryAfterSeconds} seconds.`,
        "connector_rate_limit",
        { kind, max, windowMinutes, retryAfterSeconds },
      );
    }
    kept.push(t);
    this.hits.set(key, kept);
  }
}
