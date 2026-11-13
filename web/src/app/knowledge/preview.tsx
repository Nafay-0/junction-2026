"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "../_ui/kit";

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

  const chip = (on: boolean) => `min-h-9 px-3 text-[0.92rem] font-semibold ${on ? "bg-petrol text-paper" : "border-2 border-line bg-paper text-ink hover:border-petrol"}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <label className="block">
          <span className="text-[0.95rem] font-semibold">Find a product</span>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="whipping cream, oat drink, emmental…"
            className="mt-1 min-h-11 w-full border-2 border-line bg-paper px-3 text-[1rem] placeholder:text-ink-soft focus:border-petrol focus:outline-none"
          />
        </label>
        <ul className="max-h-80 overflow-y-auto bg-paper" aria-label="Products found">
          {found.map((f) => {
            const on = picked?.id === f.id;
            return (
              <li key={f.id}>
                <button type="button" onClick={() => (setPicked(f), setUse(null))} aria-pressed={on} className={`relative block w-full px-3 py-2 text-left text-[0.95rem] ${on ? "bg-petrol text-paper" : "hover:bg-petrol-soft"}`}>
                  {on && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-lime" />}
                  <span className="font-semibold">{f.name}</span>
                  <span className={`block text-[0.82rem] ${on ? "text-paper/80" : "text-ink-soft"}`}>{f.kindLabel ?? "No profile yet"}</span>
                </button>
              </li>
            );
          })}
          {!found.length && <li className="px-3 py-2.5 text-[0.92rem] text-ink-soft">Type at least two letters.</li>}
        </ul>
        <fieldset className="bg-paper px-4 py-3">
          <legend className="sr-only">The buyer&apos;s requirements</legend>
          <p className="text-[0.92rem] font-semibold">The buyer requires</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {CLAIMS.map((c) => (
              <button key={c} type="button" aria-pressed={claims.includes(c)} onClick={() => toggle(claims, c, setClaims)} className={chip(claims.includes(c))}>
                {label(c)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[0.92rem] font-semibold">and must avoid</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {ALLERGENS.map((x) => (
              <button key={x} type="button" aria-pressed={allergens.includes(x)} onClick={() => toggle(allergens, x, setAllergens)} className={chip(allergens.includes(x))}>
                {x}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-[0.92rem]">
          <input type="checkbox" checked={showDropped} onChange={() => setShowDropped(!showDropped)} className="size-4 accent-[var(--color-petrol)]" /> Show what was considered and dropped
        </label>
        <p className="flex gap-2 text-[0.85rem] leading-snug text-ink-soft">
          <span aria-hidden className="mt-[0.4em] size-2 shrink-0 rotate-45 bg-lavender-deep" />
          On lavender: what a language model read from the product text (what it is, what it is used for). Claims and allergens come only from the product data.
        </p>
      </aside>

      <section className="min-w-0 space-y-8">
        {error && (
          <p role="alert" className="border-l-[6px] border-petrol bg-paper px-4 py-2.5">
            {error}
          </p>
        )}
        {!picked && !error && (
          <div className="border border-dashed border-line bg-paper/70 px-5 py-5">
            <p className="text-[1.08rem] font-semibold">Pick a product to see what can replace it, and for which use</p>
            <p className="mt-1 max-w-[62ch] text-ink-soft">Search on the left, for example whipping cream. Each alternative is ranked good, better or best for one use, with the reason and what changes.</p>
          </div>
        )}
        {result && picked && (
          <div>
            <div className="bg-paper px-5 py-4">
              <div aria-hidden className="-mx-5 -mt-4 mb-3 h-[3px] bg-petrol" />
              <h2 className="display text-[2rem] leading-tight">{result.product.name}</h2>
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.92rem]">
                <span className="bg-lavender px-1.5 text-lavender-deep">{result.product.kindLabel ?? "No profile yet"}</span>
                {result.product.claims.map((c) => (
                  <span key={c} className="border border-petrol/50 px-1.5 font-semibold text-petrol">
                    {label(c)}, by its data
                  </span>
                ))}
              </p>
              <nav className="mt-4 flex flex-wrap items-center gap-1" aria-label="Use">
                <span className="mr-1 text-[0.88rem] text-ink-soft">Used for</span>
                {result.product.uses.map((u) => (
                  <button key={u} type="button" onClick={() => setUse(u)} aria-pressed={result.use === u} className={result.use === u ? "min-h-9 bg-lavender-deep px-3 text-[0.92rem] font-semibold text-paper" : "min-h-9 border-2 border-lavender-deep/30 bg-lavender px-3 text-[0.92rem] font-semibold text-lavender-deep hover:border-lavender-deep"}>
                    {label(u)}
                  </button>
                ))}
              </nav>
            </div>

            <h3 className="display mt-6 text-[1.5rem]">Substitutes{result.use ? ` for ${label(result.use)}` : ""}</h3>
            {result.none && <p className="mt-2 border-l-[6px] border-petrol bg-paper px-4 py-2.5">{result.none}</p>}
            <ol className="mt-2 space-y-2">
              {result.substitutes.map((a) => (
                <li key={a.productId} className="grid gap-x-4 bg-paper px-4 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
                  <div>
                    <p className="display text-[1.5rem] leading-none">{TIER[a.tier]}</p>
                    <div className="mt-1.5 h-1.5 w-full bg-mist" role="img" aria-label={`Confidence ${Math.round(a.confidence * 100)} %`}>
                      <div className="h-full bg-petrol" style={{ width: `${Math.round(a.confidence * 100)}%` }} />
                    </div>
                    <p className="mt-0.5 text-[0.8rem] text-ink-soft tabular">{Math.round(a.confidence * 100)} % sure</p>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold">{a.name}</p>
                    <p className="mt-0.5 text-[0.95rem] leading-snug">{a.reason}</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1 text-[0.82rem]">
                      {a.changes.map((c, i) => (
                        <li key={i} className="border border-line px-1.5 text-ink-soft">
                          {c.text}
                        </li>
                      ))}
                      <li className={`px-1.5 ${a.checks.allergens === "unknown" ? "border border-ink font-semibold" : "border border-petrol/50 text-petrol"}`}>{a.checks.allergens === "unknown" ? "Allergen data missing" : "Allergens checked against data"}</li>
                      {a.otherPacks.length > 0 && <li className="border border-line px-1.5 text-ink-soft">Also in {a.otherPacks.length} other pack{a.otherPacks.length > 1 ? "s" : ""}</li>}
                      {a.partnerListed && <li className="border border-line px-1.5 text-ink-soft">The wholesaler also lists it</li>}
                    </ul>
                  </div>
                </li>
              ))}
            </ol>
            {result.packAlternatives.length > 0 && (
              <>
                <h3 className="display mt-6 text-[1.3rem]">Same product, other pack sizes</h3>
                <ul className="mt-2 flex flex-wrap gap-2 text-[0.92rem]">
                  {result.packAlternatives.map((a) => (
                    <li key={a.productId} className="bg-paper px-3 py-1.5">
                      {a.name}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.dropped && (
              <>
                <h3 className="display mt-6 text-[1.3rem]">Considered and not served</h3>
                <p className="text-[0.88rem] text-ink-soft">Below the confidence threshold of {Math.round(result.threshold * 100)} %, or ruled out by the data.</p>
                <ul className="mt-2 divide-y divide-line/70 bg-paper text-[0.92rem]">
                  {result.dropped.slice(0, 15).map((d) => (
                    <li key={d.productId} className="px-4 py-1.5">
                      <span className="font-semibold">{d.name}</span> <span className="text-ink-soft">{d.why}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="border-t-2 border-line pt-6">
          <h2 className="display text-[1.6rem]">Which products fit a role?</h2>
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void askRole();
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">A role in a dish</span>
              <input value={role} onChange={(e) => setRole(e.target.value)} className="min-h-11 w-full border-2 border-line bg-paper px-3 text-[1rem] focus:border-petrol focus:outline-none" />
            </label>
            <button type="submit" className={buttonClass("primary", "md")}>
              Find products
            </button>
          </form>
          {roleResult && (
            <div className="mt-3">
              <p className="text-[0.92rem] text-ink-soft">
                Read as uses: {roleResult.uses.map(label).join(", ") || "none"}; kinds: {roleResult.kinds.map((k) => k.label).join(", ") || "none"}
              </p>
              {roleResult.none && <p className="mt-2 border-l-[6px] border-petrol bg-paper px-4 py-2.5">{roleResult.none}</p>}
              <ol className="mt-2 divide-y divide-line/70 bg-paper">
                {roleResult.products.map((p) => (
                  <li key={p.productId} className="px-4 py-2 text-[0.95rem]">
                    <span className="font-semibold">{p.name}</span> <span className="text-ink-soft">{p.reason}</span>
                    {p.otherPacks.length ? <span className="text-ink-soft">; also in {p.otherPacks.length} other pack{p.otherPacks.length > 1 ? "s" : ""}</span> : null}
                    {p.allergens === "unknown" ? <span className="font-semibold">; allergen data missing</span> : null}
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
