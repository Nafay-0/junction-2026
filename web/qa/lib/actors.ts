 
/**
 * The actors a probe can play: the two demo organisations (mandates minted with their keys, so a probe can try
 * any mandate shape), a visitor who joins by QR code with a software passkey, and the console's own back end.
 *
 * Keys come from the environment (DOCK_DEMO_ORG_JWK, DOCK_DEMO_KITCHEN_JWK), as the server reads them; when
 * they are unset both sides fall back to the public dev seed. Against a server whose keys differ, the
 * mandate-minting probes report "skipped: keys do not match" instead of failing.
 */
import { signMandate, type Mandate } from "@/core/mandate";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { generateEd25519KeyPair } from "@/core/keys";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";
import { agent, type Http } from "./http";

export const LAAKSO = DEMO_ORG;
export const KAARI = KITCHEN_ORG;

let counter = 0;
/** A unique mandate id per probe, so probes do not share quote bindings by accident. */
const uniqueId = (prefix: string) => `${prefix}_qa_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export async function laaksoMandate(overrides: Partial<Mandate> = {}, now = new Date()): Promise<string> {
  return signMandate(demoMandate(now, { mandateId: uniqueId("mnd_laakso"), ...overrides }), await demoOrgKeyPair());
}

export async function kaariMandate(overrides: Partial<Mandate> = {}, now = new Date()): Promise<string> {
  return signMandate(demoKitchenMandate(now, { mandateId: uniqueId("mnd_kaari"), ...overrides }), await demoKitchenKeyPair());
}

/**
 * An agent of the org with its own agent id, so each probe gets its own live-lookup allowance (counted per
 * org and agent). Pass `agentId` to act as the demo kitchen's own agent (the one its console uses).
 */
export async function laaksoAgent(http: Http, overrides: Partial<Mandate> = {}): Promise<Http> {
  const agentId = overrides.agentId ?? uniqueId("agent_laakso");
  return agent(http, await laaksoMandate({ ...overrides, agentId }), agentId);
}
export async function kaariAgent(http: Http, overrides: Partial<Mandate> = {}): Promise<Http> {
  const agentId = overrides.agentId ?? uniqueId("agent_kaari");
  return agent(http, await kaariMandate({ ...overrides, agentId }), agentId);
}

/** A mandate signed by a key Dock has never seen, claiming to be Laakso. */
export async function forgedLaaksoMandate(overrides: Partial<Mandate> = {}): Promise<string> {
  const k = await generateEd25519KeyPair("laakso-catering-2026"); // same kid as the real one
  return signMandate(demoMandate(new Date(), overrides), k);
}

export type Visitor = { http: Http; sandboxId: string; orgId: string; approverName: string; auth: SoftwareAuthenticator; cookie: string };

/** Join by QR code as a phone would: registration options, a software passkey, verify. Returns the session cookie. */
export async function joinAsVisitor(http: Http): Promise<Visitor | { error: string; status: number }> {
  const begin = await http.post("/api/v1/join", {});
  if (begin.status !== 200) return { error: `join: ${begin.status} ${begin.text.slice(0, 200)}`, status: begin.status };
  const origin = new URL(http.base).origin;
  const auth = new SoftwareAuthenticator(origin);
  const response = auth.register(begin.body.options, origin);
  const verify = await http.post("/api/v1/join/verify", { response });
  if (verify.status !== 201) return { error: `verify: ${verify.status} ${verify.text.slice(0, 200)}`, status: verify.status };
  const setCookie = verify.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  const s = verify.body.sandbox;
  return { http: http.with({ cookie }), sandboxId: s.sandboxId, orgId: s.orgId, approverName: s.approverName, auth, cookie };
}

/** Approve (or decline) one approval with the visitor's passkey, the way the phone page does. */
export async function passkeyDecide(v: Visitor, approvalId: string, decision: "approve" | "decline", note?: string) {
  const ch = await v.http.post(`/api/v1/approvals/${approvalId}/challenge`, { decision });
  if (ch.status !== 200) return ch;
  const response = v.auth.assert(ch.body.options, { origin: new URL(v.http.base).origin });
  return v.http.post(`/api/v1/approvals/${approvalId}`, { decision, note, proof: { kind: "webauthn", response } });
}
