import type { Metadata } from "next";
import { Suspense } from "react";
import { LangProvider } from "../_i18n/provider";
import { chosenLang } from "../_i18n/server";
import { Gallery } from "./gallery";

export const metadata: Metadata = { title: "Design system, AimoPilot" };

/** The living reference for web/docs/DESIGN.md: every shared component with its states, on sample data. */
export default function DesignPage() {
  return (
    <Suspense fallback={null}>
      <Chosen />
    </Suspense>
  );
}

async function Chosen() {
  return (
    <LangProvider initial={await chosenLang()}>
      <Gallery />
    </LangProvider>
  );
}
