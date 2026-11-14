import type { Metadata } from "next";
import { DEMO_NOTE } from "../_ui/brand";
import { PageHeader } from "../_ui/kit";
import { Wordmark } from "../_ui/wordmark";
import { KnowledgePreview } from "./preview";

export const metadata: Metadata = { title: "AimoPilot: product knowledge map" };

/** /knowledge: pick a product, see its alternatives by use with the reasons, or ask which products fit a role. */
export default function KnowledgePage() {
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <p className="on-dark bg-petrol-deep px-4 py-1.5 text-center text-[0.78rem] leading-snug text-paper/80">{DEMO_NOTE} Carbon figures are product-group averages.</p>
      <header className="border-b border-line bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          <p className="flex min-h-11 items-center">
            <Wordmark size={26} />
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <PageHeader
          title="Alternatives by use"
          lead="The product knowledge map: pick a product, see what can replace it for each use and why, or ask which products fit a role in a dish. Every relation is checked against the product data: a substitute keeps the dietary claims and adds no allergen."
        />
        <KnowledgePreview />
      </main>
    </div>
  );
}
