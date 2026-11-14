import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MENU_KITCHENS } from "@/server/agent/menu/kitchens";
import { MenuPlanner } from "../../_plan/menu-planner";
import { StandaloneHeader, StandaloneNote } from "../../_plan/pages";
import { PLAN_PAGES_TEXT } from "../../_plan/pages.text";
import { LangProvider } from "../../_i18n/provider";
import { chosenLang, requestLang } from "../../_i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: PLAN_PAGES_TEXT[await requestLang()].standaloneTitle };
}

const NAMES: Record<string, string> = {
  kaari: "Ravintola Kaari",
  laakso: "Laakso Catering",
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
    <LangProvider initial={await chosenLang()}>
      <main className="min-h-dvh bg-mist text-ink">
        <StandaloneHeader kitchen={kitchen} kitchens={MENU_KITCHENS} names={NAMES} />
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
          <StandaloneNote />
          <MenuPlanner key={kitchen} kitchen={kitchen} />
        </div>
      </main>
    </LangProvider>
  );
}
