import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DEMO_NOTE, PRODUCT_NAME } from "../../_ui/brand";
import { Wordmark } from "../../_ui/target";
import { listConsoleKitchens, resolveKitchen } from "@/server/console-kitchens";
import { Portal } from "./portal";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: kitchen shop` };

/**
 * The kitchen portal for one kitchen: /k/kaari (returning kitchen with memory), /k/laakso (the partner's example
 * org), /k/sbx_... (a visitor's own kitchen). The kitchen's mandate stays on the server; pages call /ui-api.
 */
export default function KitchenLayout(props: LayoutProps<"/k/[kitchen]">) {
  return (
    <Suspense fallback={<Shell />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params, children }: LayoutProps<"/k/[kitchen]">) {
  const { kitchen } = await params;
  await connection(); // request-time: kitchens come and go
  const [k, kitchens] = await Promise.all([resolveKitchen(kitchen), listConsoleKitchens()]);
  if (!k) return <Closed kitchens={kitchens} />;
  return (
    <Portal key={k.info.slug} kitchen={k.info} kitchens={kitchens}>
      {children}
    </Portal>
  );
}

function Shell() {
  return (
    <div className="min-h-dvh bg-concrete">
      <p className="h-6 bg-ink" />
      <div className="h-[118px] border-b-[3px] border-ink bg-paper" />
      <div className="h-[104px] border-b border-line" />
    </div>
  );
}

function Closed({ kitchens }: { kitchens: { slug: string; name: string }[] }) {
  return (
    <main className="min-h-dvh bg-concrete px-4 py-10 text-ink sm:px-10">
      <Wordmark size={30} />
      <h1 className="mt-8 font-display text-4xl font-bold">This kitchen is not open</h1>
      <p className="mt-2 max-w-prose text-[1.1rem] text-ink-soft">Visitor kitchens close after 90 minutes. Pick a kitchen that is here now:</p>
      <ul className="mt-4 space-y-2">
        {kitchens.map((k) => (
          <li key={k.slug}>
            <Link className="text-[1.1rem] font-semibold underline decoration-2 underline-offset-4" href={`/k/${k.slug}`}>
              {k.name}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-[0.9rem] text-ink-soft">{DEMO_NOTE}</p>
    </main>
  );
}
