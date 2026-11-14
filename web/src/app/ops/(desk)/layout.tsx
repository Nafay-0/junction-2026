import type { Metadata } from "next";
import { Suspense } from "react";
import { Rail } from "../_ui/rail";

export const metadata: Metadata = { title: { template: "%s, AimoPilot operations", default: "AimoPilot operations" } };

/** The wholesaler's operations desk: the petrol-deep rail on the left, the page on mist. */
export default function DeskLayout({ children }: LayoutProps<"/ops">) {
  return (
    <div className="flex min-h-dvh flex-col bg-mist text-ink lg:flex-row">
      <div className="shrink-0 bg-petrol-deep">
        <Suspense fallback={<aside className="lg:h-dvh lg:w-[232px]" />}>
          <Rail />
        </Suspense>
      </div>
      <main id="main" className="min-w-0 flex-1 px-4 pb-16 pt-6 sm:px-6 xl:px-10">
        <div className="mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
