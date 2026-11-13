import type { Metadata } from "next";
import { Suspense } from "react";
import { Rail } from "../_ui/rail";

export const metadata: Metadata = { title: { template: "%s · Dock operations", default: "Dock operations" } };

/** The wholesaler's operations desk: the rail on the left, the page on concrete. Dense type, 14–15 px body. */
export default function DeskLayout({ children }: LayoutProps<"/ops">) {
  return (
    <div className="flex min-h-dvh flex-col bg-concrete text-ink lg:flex-row">
      <Suspense fallback={<aside className="shrink-0 bg-steel lg:h-dvh lg:w-[212px]" />}>
        <Rail />
      </Suspense>
      <main className="min-w-0 flex-1 px-4 pb-16 pt-5 sm:px-6 xl:px-8">
        <div className="mx-auto max-w-[1560px]">{children}</div>
      </main>
    </div>
  );
}
