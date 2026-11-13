import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Wordmark } from "../../_ui/target";
import { listConsoleKitchens, resolveKitchen } from "@/server/console-kitchens";
import { Console } from "./console";

export const metadata: Metadata = { title: "Dock: buyer console" };

/**
 * The buyer console for one kitchen: one request field, then the request's stages as they happen.
 * /k/kaari (returning kitchen with memory), /k/laakso (the partner's example org), /k/sbx_... (a visitor's kitchen).
 */
export default function KitchenPage(props: PageProps<"/k/[kitchen]">) {
  return (
    <Suspense fallback={<Shell />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params }: PageProps<"/k/[kitchen]">) {
  const { kitchen } = await params;
  await connection(); // request-time: kitchens come and go
  const [k, kitchens] = await Promise.all([resolveKitchen(kitchen), listConsoleKitchens()]);
  if (!k) return <Closed kitchens={kitchens} />;
  return <Console key={k.info.slug} kitchen={k.info} kitchens={kitchens} />;
}

function Shell() {
  return (
    <div className="min-h-dvh bg-concrete">
      <div className="h-[76px] border-b-[3px] border-ink bg-paper" />
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
    </main>
  );
}
