/**
 * Which key signs the demo organisations' mandates on the server a script talks to. A script loads web/.env.local
 * (the deployment's keys) for convenience; a local or hermetic test server (no public address, no JWK configured)
 * trusts only the repository's public dev key instead, and mandates signed with the deployment's key fail there
 * ("mandate_signature_invalid"). So ask the server (GET /api/health `settings.demoOrgKey`, which names the source,
 * never the key) and sign the same way:
 *   "public dev key"  sign with the repository's public dev key (the script drops the JWKs it loaded)
 *   "fixed"           sign with the configured JWK, which the script has from the same environment
 *   "process key"     a public site with no JWK: nobody outside can sign; the script's mandate probes are skipped
 * This only chooses what the script signs with. What the server trusts is unchanged.
 */
export async function matchServerKeys(baseUrl: string): Promise<{ org?: string; kitchen?: string }> {
  let settings: { demoOrgKey?: string; demoKitchenKey?: string } | undefined;
  try {
    const r = await fetch(new URL("/api/health", baseUrl), { signal: AbortSignal.timeout(10_000) });
    settings = ((await r.json()) as { settings?: typeof settings }).settings;
  } catch {
    return {};
  }
  const pairs: [string | undefined, string][] = [
    [settings?.demoOrgKey, "DOCK_DEMO_ORG_JWK"],
    [settings?.demoKitchenKey, "DOCK_DEMO_KITCHEN_JWK"],
  ];
  for (const [source, name] of pairs) if (source === "public dev key") process.env[name] = "";
  // The script itself is never a public site: its own key choice must not turn into a process key.
  if (pairs.some(([source]) => source === "public dev key")) process.env.DOCK_PUBLIC_URL = "";
  return { org: settings?.demoOrgKey, kitchen: settings?.demoKitchenKey };
}
