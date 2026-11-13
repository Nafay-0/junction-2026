import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { MENU_KITCHENS } from "@/server/agent/menu/kitchens";
import { MenuPlanner } from "../../../_plan/menu-planner";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: menu planner` };

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
        <div>
          <h1 className="display text-[2.6rem] text-ink sm:text-[3rem]">Menu planner</h1>
          <p className="max-w-[64ch] text-[1.02rem] leading-snug text-ink-soft">
            Say what you are serving and for how many. The agent drafts each dish&apos;s ingredients and amounts; plain code finds the products, checks every line against the kitchen&apos;s rules, fixes the price and sends one order through the gate.
          </p>
        </div>
      </div>
      <div className="mt-5">
        {planned ? (
          <MenuPlanner key={kitchen} kitchen={kitchen} />
        ) : (
          <div className="bg-paper p-5">
            <p className="text-[1.08rem] font-semibold">The menu planner is set up for the two demo kitchens</p>
            <p className="mt-1 max-w-[62ch] leading-snug text-ink-soft">Visitor kitchens order through the order lane and the basket. To try a menu, open one of these:</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {MENU_KITCHENS.map((k) => (
                <Link key={k} href={`/k/${k}/menu`} className="inline-flex min-h-11 items-center bg-petrol px-4 font-semibold text-paper hover:bg-petrol-deep">
                  {k === "kaari" ? "Ravintola Kaari, lunch restaurant" : k === "laakso" ? "Laakso Catering, schools and daycare" : k}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
