import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MENU_KITCHENS } from "@/server/agent/menu/kitchens";
import { MenuPlanner } from "../../_plan/menu-planner";

export const metadata: Metadata = { title: "Dock: menu to order" };

const NAMES: Record<string, { name: string; kind: string }> = {
  kaari: { name: "Ravintola Kaari", kind: "Lunch restaurant" },
  laakso: { name: "Laakso Catering", kind: "School and daycare kitchen, no nuts" },
};

/**
 * Preview of the menu planner components (app/_plan), as the kitchen portal will mount them: a chef states a dish or
 * a menu and covers, and gets one checked, fixed-price order through the gate.
 */
export function generateStaticParams() {
  return MENU_KITCHENS.map((kitchen) => ({ kitchen }));
}

export default function PlanPage(props: PageProps<"/plan/[kitchen]">) {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-concrete" />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params }: PageProps<"/plan/[kitchen]">) {
  const { kitchen } = await params;
  if (!(MENU_KITCHENS as string[]).includes(kitchen)) notFound();
  return (
    <main className="min-h-dvh bg-mist text-ink">
      <header className="border-b-4 border-petrol bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href={`/k/${kitchen}/menu`} className="flex items-baseline gap-2">
              <span aria-hidden className="size-3 bg-lime" />
              <span className="display text-[1.9rem] text-petrol">Dock</span>
            </Link>
            <span className="display text-[1.5rem]">Menu planner</span>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Kitchens">
            {MENU_KITCHENS.map((k) => (
              <Link key={k} href={`/plan/${k}`} aria-current={k === kitchen ? "page" : undefined} className={`border-2 px-3 py-1.5 text-[0.95rem] font-semibold ${k === kitchen ? "border-petrol bg-petrol text-paper" : "border-line hover:border-petrol"}`}>
                {NAMES[k].name}
                <span className={`block text-[0.75rem] font-medium ${k === kitchen ? "text-paper/80" : "text-ink-soft"}`}>{NAMES[k].kind}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <p className="mb-4 text-[0.85rem] text-ink-soft">Also inside each kitchen&apos;s shop, under Menu planner. Demo on synthetic kitchens and the partner&apos;s test catalogue. The model drafts dishes and amounts; plain code checks every line, the price and the mandate.</p>
        <MenuPlanner key={kitchen} kitchen={kitchen} />
      </div>
    </main>
  );
}
