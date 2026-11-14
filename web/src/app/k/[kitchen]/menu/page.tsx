import type { Metadata } from "next";
import { Suspense } from "react";
import { MENU_KITCHENS } from "@/server/agent/menu/kitchens";
import { MenuPlanner } from "../../../_plan/menu-planner";
import { StorePlanIntro, StorePlanUnavailable } from "../../../_plan/pages";
import { PLAN_PAGES_TEXT } from "../../../_plan/pages.text";
import { requestLang } from "../../../_i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: PLAN_PAGES_TEXT[await requestLang()].storeTitle };
}

/** The menu planner inside the store: a dish or a menu and covers in, one checked, fixed-price order out. */
export default function MenuPage(props: PageProps<"/k/[kitchen]/menu">) {
  return (
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse bg-paper/60" />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params }: PageProps<"/k/[kitchen]/menu">) {
  const { kitchen } = await params;
  const planned = (MENU_KITCHENS as string[]).includes(kitchen);
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <StorePlanIntro />
      </div>
      <div className="mt-5">{planned ? <MenuPlanner key={kitchen} kitchen={kitchen} /> : <StorePlanUnavailable kitchens={MENU_KITCHENS} />}</div>
    </div>
  );
}
