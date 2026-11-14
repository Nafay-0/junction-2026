import type { KitchenProfile, KitchenRepository } from "@/core/kitchen";
import { generateEd25519KeyPair, type KeyPair } from "@/core/keys";
import { signMandate, type Mandate, type createTrustRegistry } from "@/core/mandate";

/**
 * Making a kitchen: a buyer organisation with its own Ed25519 signing key that Dock trusts, its first signed
 * mandate for its agent, and the kitchen's memory profile. One path for both kinds of kitchen made at run time:
 * a visitor's (sandboxes.ts, from the QR code) and an account's (accounts/service.ts, from sign-up).
 */
export type TrustRegistryHandle = ReturnType<typeof createTrustRegistry>;

export async function openKitchenOrg(input: {
  registry: TrustRegistryHandle;
  kitchens?: KitchenRepository;
  kid: string;
  mandate: Mandate;
  profile?: KitchenProfile;
}): Promise<{ key: KeyPair; mandateToken: string }> {
  const key = await generateEd25519KeyPair(input.kid);
  input.registry.add({ kid: key.kid, orgId: input.mandate.issuer.orgId, publicKey: key.publicKey });
  const mandateToken = await signMandate(input.mandate, key);
  if (input.kitchens && input.profile) await input.kitchens.saveProfile(input.profile);
  return { key, mandateToken };
}
