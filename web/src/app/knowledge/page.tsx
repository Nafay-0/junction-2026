import type { Metadata } from "next";
import { KnowledgePreview } from "./preview";

export const metadata: Metadata = { title: "Dock: product knowledge map" };

/** /knowledge: pick a product, see its alternatives by use with the reasons, or ask which products fit a role. */
export default function KnowledgePage() {
  return (
    <main className="min-h-dvh bg-concrete text-ink">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="font-display text-sm uppercase tracking-widest text-ink-soft">Dock · product knowledge map</p>
          <h1 className="font-display text-3xl font-semibold">Alternatives by use</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">
            Every relation is checked against the product data: a substitute keeps the dietary claims and adds no allergen. What a product is and what it is
            used for was read by a language model; claims and allergens never were.
          </p>
        </header>
        <KnowledgePreview />
        <footer className="mt-10 text-sm text-ink-soft">Demo on the challenge&apos;s synthetic data. Carbon figures are product-group averages.</footer>
      </div>
    </main>
  );
}
