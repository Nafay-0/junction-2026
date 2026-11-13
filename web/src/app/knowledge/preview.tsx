"use client";

import { useEffect, useState } from "react";

type Change = { kind: string; text: string };
type Condition = { code: string; text: string };
type Alternative = {
  productId: string;
  name: string;
  kindLabel: string;
  relation: "substitute" | "pack_alternative";
  tier: "best" | "better" | "good";
  confidence: number;
  reason: string;
  changes: Change[];
  conditions: Condition[];
  checks: { claimsKept: string[]; allergens: "verified" | "unknown" };
  otherPacks: string[];
  partnerListed: boolean;
};
type Dropped = { productId: string; name: string; confidence: number | null; why: string };
type AltResult = {
  product: { id: string; name: string; kindLabel: string | null; uses: string[]; claims: string[] };
  use: string | null;
  substitutes: Alternative[];
  packAlternatives: Alternative[];
  none?: string;
  threshold: number;
  dropped?: Dropped[];
};
type Found = { id: string; name: string; kindLabel: string | null; uses: string[] };
type RoleResult = { uses: string[]; terms: string[]; kinds: { label: string }[]; products: { productId: string; name: string; kindLabel: string; reason: string; otherPacks: string[]; allergens: string }[]; none?: string };

const CLAIMS = ["lactose_free", "gluten_free", "vegan"];
const ALLERGENS = ["milk", "gluten", "nuts", "eggs", "soy"];
const label = (s: string) => s.replace(/_/g, " ");
const TIER: Record<Alternative["tier"], string> = { best: "Best", better: "Better", good: "Good" };

async function getJson<T>(url: string): Promise<T | { error: { message: string } }> {
  const r = await fetch(url, { cache: "no-store" });
  return (await r.json()) as T | { error: { message: string } };
}

export function KnowledgePreview() {
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(null);
  const [use, setUse] = useState<string | null>(null);
  const [claims, setClaims] = useState<string[]>([]);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [showDropped, setShowDropped] = useState(false);
  const [result, setResult] = useState<AltResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("cream for carbonara");
  const [roleResult, setRoleResult] = useState<RoleResult | null>(null);

  useEffect(() => {
    if (text.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await getJson<{ products: Found[] }>(`/ui-api/knowledge/search?q=${encodeURIComponent(text)}`);
      if ("error" in r) setError(r.error.message);
      else setFound(r.products);
    }, 200);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (!picked) return;
    const p = new URLSearchParams({ product: picked.id });
    if (use) p.set("use", use);
    if (claims.length) p.set("claims", claims.join(","));
    if (allergens.length) p.set("allergens", allergens.join(","));
    if (showDropped) p.set("debug", "1");
    let live = true;
    getJson<AltResult>(`/ui-api/knowledge/alternatives?${p}`).then((r) => {
      if (!live) return;
      if ("error" in r) setError(r.error.message);
      else {
        setResult(r);
        setError(null);
      }
    });
    return () => {
      live = false;
    };
  }, [picked, use, claims, allergens, showDropped]);

  const toggle = (xs: string[], x: string, set: (v: string[]) => void) => set(xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

  const askRole = async () => {
    const p = new URLSearchParams({ q: role });
    if (claims.length) p.set("claims", claims.join(","));
    if (allergens.length) p.set("allergens", allergens.join(","));
    const r = await getJson<RoleResult>(`/ui-api/knowledge/role?${p}`);
    if ("error" in r) setError(r.error.message);
    else setRoleResult(r);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <aside className="space-y-4">
        <label className="block">
          <span className="text-sm font-semibold">Find a product</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="whipping cream, oat drink, emmental…" className="mt-1 w-full border border-ink/30 bg-paper px-3 py-2" />
        </label>
        <ul className="max-h-80 overflow-y-auto border border-ink/15 bg-paper">
          {found.map((f) => (
            <li key={f.id}>
              <button
                onClick={() => (setPicked(f), setUse(null))}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-concrete ${picked?.id === f.id ? "bg-concrete font-semibold" : ""}`}
              >
                {f.name}
                <span className="block text-xs text-ink-soft">{f.kindLabel ?? "no profile"}</span>
              </button>
            </li>
          ))}
          {!found.length && <li className="px-3 py-2 text-sm text-ink-soft">Type at least two letters.</li>}
        </ul>
        <fieldset className="border border-ink/15 bg-paper p-3 text-sm">
          <legend className="px-1 font-semibold">The buyer requires</legend>
          {CLAIMS.map((c) => (
            <label key={c} className="mr-3 inline-flex items-center gap-1">
              <input type="checkbox" checked={claims.includes(c)} onChange={() => toggle(claims, c, setClaims)} /> {label(c)}
            </label>
          ))}
          <p className="mt-2 font-semibold">and must avoid</p>
          {ALLERGENS.map((a) => (
            <label key={a} className="mr-3 inline-flex items-center gap-1">
              <input type="checkbox" checked={allergens.includes(a)} onChange={() => toggle(allergens, a, setAllergens)} /> {a}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showDropped} onChange={() => setShowDropped(!showDropped)} /> show what was considered and dropped
        </label>
      </aside>

      <section className="space-y-6">
        {error && <p className="border-l-4 border-safety bg-paper px-3 py-2">{error}</p>}
        {result && picked && (
          <div>
            <h2 className="font-display text-2xl font-semibold">{result.product.name}</h2>
            <p className="text-sm text-ink-soft">
              {result.product.kindLabel ?? "no profile"}
              {result.product.claims.length ? ` · ${result.product.claims.map(label).join(", ")} by its data` : ""}
            </p>
            <nav className="mt-3 flex flex-wrap gap-2" aria-label="Use">
              {result.product.uses.map((u) => (
                <button key={u} onClick={() => setUse(u)} className={`border px-3 py-1 text-sm ${result.use === u ? "border-ink bg-ink text-chalk" : "border-ink/30 bg-paper"}`}>
                  {label(u)}
                </button>
              ))}
            </nav>

            <h3 className="mt-5 font-semibold">Substitutes for {label(result.use ?? "")}</h3>
            {result.none && <p className="mt-2 border border-ink/15 bg-paper px-3 py-2">{result.none}</p>}
            <ol className="mt-2 space-y-2">
              {result.substitutes.map((a) => (
                <li key={a.productId} className="border border-ink/15 bg-paper p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{a.name}</span>
                    <span className="shrink-0 font-display text-sm uppercase tracking-wide">
                      {TIER[a.tier]} · {a.confidence.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{a.reason}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {a.changes.map((c) => c.text).join(" · ")}
                    {a.otherPacks.length ? ` · also in ${a.otherPacks.length} other pack${a.otherPacks.length > 1 ? "s" : ""}` : ""}
                    {a.checks.allergens === "unknown" ? " · allergen data missing" : " · allergens checked against data"}
                    {a.partnerListed ? " · the wholesaler also lists it" : ""}
                  </p>
                </li>
              ))}
            </ol>
            {result.packAlternatives.length > 0 && (
              <>
                <h3 className="mt-5 font-semibold">Same product, other pack sizes</h3>
                <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                  {result.packAlternatives.map((a) => (
                    <li key={a.productId} className="border border-ink/15 bg-paper px-3 py-1">
                      {a.name}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.dropped && (
              <>
                <h3 className="mt-5 font-semibold">Considered and not served (threshold {result.threshold})</h3>
                <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                  {result.dropped.slice(0, 15).map((d) => (
                    <li key={d.productId}>
                      {d.name}: {d.why}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="border-t border-ink/20 pt-5">
          <h2 className="font-display text-xl font-semibold">Which products fit a role?</h2>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void askRole();
            }}
          >
            <input value={role} onChange={(e) => setRole(e.target.value)} className="flex-1 border border-ink/30 bg-paper px-3 py-2" />
            <button className="bg-ink px-4 py-2 text-chalk">Ask</button>
          </form>
          {roleResult && (
            <div className="mt-3">
              <p className="text-sm text-ink-soft">
                Uses {roleResult.uses.map(label).join(", ") || "none read"} · kinds {roleResult.kinds.map((k) => k.label).join(", ") || "none"}
              </p>
              {roleResult.none && <p className="mt-2 border border-ink/15 bg-paper px-3 py-2">{roleResult.none}</p>}
              <ol className="mt-2 space-y-1">
                {roleResult.products.map((p) => (
                  <li key={p.productId} className="border border-ink/15 bg-paper px-3 py-2 text-sm">
                    <span className="font-semibold">{p.name}</span> · {p.reason}
                    {p.otherPacks.length ? ` · also in ${p.otherPacks.length} other pack${p.otherPacks.length > 1 ? "s" : ""}` : ""}
                    {p.allergens === "unknown" ? " · allergen data missing" : ""}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
