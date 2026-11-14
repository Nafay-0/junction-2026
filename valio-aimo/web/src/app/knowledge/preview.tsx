"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, Search, Shuffle, Sparkles } from "lucide-react";
import { Button, Card, Checkbox, Chip, Empty, ErrorPlate, IconDisc, Input, Panel, SectionTitle, Tag } from "../_ui/kit";

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

  const pct = (x: number) => Math.round(x * 100);

  return (
    <div className="grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Input type="search" label="Find a product" icon={<Search size={17} />} value={text} onChange={setText} placeholder="whipping cream, oat drink, emmental…" enterKeyHint="search" />
        <Card>
          <ul className="max-h-80 divide-y divide-line overflow-y-auto" aria-label="Products found">
            {found.map((f) => {
              const on = picked?.id === f.id;
              return (
                <li key={f.id}>
                  <button type="button" onClick={() => (setPicked(f), setUse(null))} aria-pressed={on} className={`flex min-h-12 w-full items-center gap-3 rounded-none px-4 py-2.5 text-left text-[0.95rem] transition-colors duration-150 ${on ? "bg-petrol-soft" : "hover:bg-mist"}`}>
                    <span className="min-w-0 flex-1">
                      <span className={`block font-semibold leading-snug ${on ? "text-petrol-deep" : ""}`}>{f.name}</span>
                      <span className="block text-[0.82rem] text-ink-soft">{f.kindLabel ?? "No profile yet"}</span>
                    </span>
                    {on && <Check aria-hidden size={17} strokeWidth={2.5} className="shrink-0 text-petrol" />}
                  </button>
                </li>
              );
            })}
            {!found.length && <li className="px-4 py-3 text-[0.92rem] text-ink-soft">Type at least two letters.</li>}
          </ul>
        </Card>
        <Card pad>
          <fieldset>
            <legend className="sr-only">The buyer&apos;s requirements</legend>
            <p className="text-[0.92rem] font-semibold">The buyer requires</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CLAIMS.map((c) => (
                <Chip key={c} on={claims.includes(c)} onClick={() => toggle(claims, c, setClaims)}>
                  {label(c)}
                </Chip>
              ))}
            </div>
            <p className="mt-4 text-[0.92rem] font-semibold">and must avoid</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ALLERGENS.map((x) => (
                <Chip key={x} on={allergens.includes(x)} onClick={() => toggle(allergens, x, setAllergens)}>
                  {x}
                </Chip>
              ))}
            </div>
          </fieldset>
          <Checkbox className="mt-4" checked={showDropped} onChange={setShowDropped} label="Show what was considered and dropped" />
        </Card>
        <Panel tone="agent" className="flex gap-2.5 px-4 py-3 text-[0.86rem] leading-snug">
          <Sparkles aria-hidden size={15} className="mt-0.5 shrink-0 text-lavender-deep" />
          <span>On lavender: what a language model read from the product text (what it is, what it is used for). Claims and allergens come only from the product data.</span>
        </Panel>
      </aside>

      <section className="min-w-0 space-y-10">
        {error && <ErrorPlate title="The knowledge map did not answer" message={error} />}
        {!picked && !error && (
          <Empty
            title="Pick a product to see what can replace it, and for which use"
            glyph={
              <IconDisc tone="muted">
                <Shuffle size={20} />
              </IconDisc>
            }
          >
            Search on the left, for example whipping cream. Each alternative is ranked good, better or best for one use, with the reason and what changes.
          </Empty>
        )}
        {result && picked && (
          <div className="space-y-8">
            <Card pad>
              <h2 className="display text-[1.75rem] leading-tight sm:text-[2rem]">{result.product.name}</h2>
              <p className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Tag tone="agent">{result.product.kindLabel ?? "No profile yet"}</Tag>
                {result.product.claims.map((c) => (
                  <Tag key={c}>{label(c)}, by its data</Tag>
                ))}
              </p>
              <nav className="mt-5 flex flex-wrap items-center gap-1.5" aria-label="Use">
                <span className="mr-1 text-[0.88rem] text-ink-soft">Used for</span>
                {result.product.uses.map((u) => {
                  const on = result.use === u;
                  return (
                    <button key={u} type="button" onClick={() => setUse(u)} aria-pressed={on} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.88rem] font-medium transition-colors duration-150 pointer-coarse:min-h-11 ${on ? "bg-lavender-deep text-paper" : "bg-lavender text-lavender-deep ring-1 ring-inset ring-lavender-mid hover:bg-lavender-mid"}`}>
                      {on && <Check aria-hidden size={14} strokeWidth={2.6} />}
                      {label(u)}
                    </button>
                  );
                })}
              </nav>
            </Card>

            <div>
              <SectionTitle>Substitutes{result.use ? ` for ${label(result.use)}` : ""}</SectionTitle>
              {result.none && <Panel className="mb-3 px-4 py-3">{result.none}</Panel>}
              {result.substitutes.length > 0 && (
                <Card>
                  <ol className="divide-y divide-line">
                    {result.substitutes.map((a) => (
                      <li key={a.productId} className="grid gap-x-5 gap-y-3 px-5 py-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:px-6">
                        <div className="flex items-center gap-3 sm:block">
                          <p className="display text-[1.35rem] leading-none">{TIER[a.tier]}</p>
                          <div className="min-w-0 flex-1 sm:mt-2">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface" role="img" aria-label={`Confidence ${pct(a.confidence)} %`}>
                              <div className="h-full rounded-full bg-petrol" style={{ width: `${pct(a.confidence)}%` }} />
                            </div>
                            <p className="mt-1 text-[0.8rem] text-ink-soft tabular">{pct(a.confidence)} % sure</p>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold leading-snug">{a.name}</p>
                          <p className="mt-1 text-[0.95rem] leading-snug text-ink-soft">{a.reason}</p>
                          <ul className="mt-2.5 flex flex-wrap gap-1.5">
                            {a.changes.map((c, i) => (
                              <li key={i}>
                                <Tag tone="muted">{c.text}</Tag>
                              </li>
                            ))}
                            <li>
                              {a.checks.allergens === "unknown" ? (
                                <Tag tone="bad">
                                  <CircleAlert aria-hidden size={13} />
                                  Allergen data missing
                                </Tag>
                              ) : (
                                <Tag tone="good">
                                  <Check aria-hidden size={13} strokeWidth={2.6} />
                                  Allergens checked against data
                                </Tag>
                              )}
                            </li>
                            {a.otherPacks.length > 0 && (
                              <li>
                                <Tag tone="muted">
                                  Also in {a.otherPacks.length} other pack{a.otherPacks.length > 1 ? "s" : ""}
                                </Tag>
                              </li>
                            )}
                            {a.partnerListed && (
                              <li>
                                <Tag tone="muted">The wholesaler also lists it</Tag>
                              </li>
                            )}
                          </ul>
                        </div>
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
            </div>
            {result.packAlternatives.length > 0 && (
              <div>
                <h3 className="display text-[1.25rem]">Same product, other pack sizes</h3>
                <ul className="mt-3 flex flex-wrap gap-2 text-[0.92rem]">
                  {result.packAlternatives.map((a) => (
                    <li key={a.productId} className="rounded-full border border-line bg-paper px-3.5 py-1.5">
                      {a.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.dropped && (
              <div>
                <h3 className="display text-[1.25rem]">Considered and not served</h3>
                <p className="mt-0.5 text-[0.88rem] text-ink-soft">Below the confidence threshold of {pct(result.threshold)} %, or ruled out by the data.</p>
                <Card className="mt-3">
                  <ul className="divide-y divide-line text-[0.92rem]">
                    {result.dropped.slice(0, 15).map((d) => (
                      <li key={d.productId} className="px-5 py-2.5 leading-snug">
                        <span className="font-semibold">{d.name}</span> <span className="text-ink-soft">{d.why}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            )}
          </div>
        )}

        <div>
          <SectionTitle>Which products fit a role?</SectionTitle>
          <form
            className="flex flex-wrap items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void askRole();
            }}
          >
            <Input className="min-w-0 flex-1 basis-64" aria-label="A role in a dish" value={role} onChange={setRole} enterKeyHint="search" />
            <Button type="submit" kind="primary">
              Find products
            </Button>
          </form>
          {roleResult && (
            <div className="mt-4">
              <p className="text-[0.92rem] text-ink-soft">
                Read as uses: {roleResult.uses.map(label).join(", ") || "none"}; kinds: {roleResult.kinds.map((k) => k.label).join(", ") || "none"}
              </p>
              {roleResult.none && <Panel className="mt-3 px-4 py-3">{roleResult.none}</Panel>}
              {roleResult.products.length > 0 && (
                <Card className="mt-3">
                  <ol className="divide-y divide-line">
                    {roleResult.products.map((p) => (
                      <li key={p.productId} className="px-5 py-3 text-[0.95rem] leading-snug">
                        <span className="font-semibold">{p.name}</span> <span className="text-ink-soft">{p.reason}</span>
                        {p.otherPacks.length ? <span className="text-ink-soft">; also in {p.otherPacks.length} other pack{p.otherPacks.length > 1 ? "s" : ""}</span> : null}
                        {p.allergens === "unknown" ? <span className="font-semibold text-bad">; allergen data missing</span> : null}
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
