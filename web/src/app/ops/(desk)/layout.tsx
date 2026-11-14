import type { Metadata } from "next";
import { Suspense } from "react";
import { Rail } from "../_ui/rail";

export const metadata: Metadata = { title: { template: "%s, AimoPilot operations", default: "AimoPilot operations" } };

/** The wholesaler's operations desk: the sidebar and status bar (a tab bar on a phone) around the page, on mist. */
export default function DeskLayout({ children }: LayoutProps<"/ops">) {
  return (
    <div className="min-h-dvh bg-mist text-ink lg:flex">
      <Suspense fallback={<aside className="hidden h-dvh w-[15rem] shrink-0 bg-petrol-deep lg:block" />}>
        <Rail />
      </Suspense>
      <main id="main" className="pb-tabbar min-w-0 flex-1 px-4 pt-5 sm:px-6 lg:pt-[5.25rem] xl:px-10">
        <div className="mx-auto max-w-[1500px]">{children}</div>
      </main>
    </div>
  );
}
