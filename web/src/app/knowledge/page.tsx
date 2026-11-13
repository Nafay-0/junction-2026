import type { Metadata } from "next";
import { DEMO_NOTE } from "../_ui/brand";
import { Wordmark } from "../_ui/target";
import { KnowledgePreview } from "./preview";

export const metadata: Metadata = { title: "Dock: product knowledge map" };

/** /knowledge: pick a product, see its alternatives by use with the reasons, or ask which products fit a role. */
export default function KnowledgePage() {
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <p className="bg-petrol-deep px-4 py-1.5 text-center text-[0.82rem] text-paper/85">{DEMO_NOTE} Carbon figures are product-group averages.</p>
      <header className="bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-6 sm:px-6">
          <div>
            <Wordmark size={26} />
            <h1 className="display mt-4 text-[clamp(2.2rem,4vw,3rem)]">Alternatives by use</h1>
            <p className="mt-2 max-w-[66ch] leading-snug text-ink-soft">
              The product knowledge map: pick a product, see what can replace it for each use and why, or ask which products fit a role in a dish. Every relation is checked against the product data: a substitute keeps the dietary claims and adds no allergen.
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <KnowledgePreview />
      </main>
    </div>
  );
}
