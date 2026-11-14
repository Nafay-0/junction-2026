import type { Metadata } from "next";
import { Suspense } from "react";
import { LangProvider } from "../../_i18n/provider";
import { chosenLang } from "../../_i18n/server";
import { WorkspaceDemo } from "./workspace-demo";

export const metadata: Metadata = { title: "The agent's workspace, AimoPilot design system" };

/**
 * The agent's two sizes on sample data: /design/workspace?view=home|order|compare|menu&size=dock|workspace.
 * A reference for web/docs/DESIGN.md ("The workspace"); nothing here calls the server.
 */
export default function WorkspacePage() {
  return (
    <Suspense fallback={null}>
      <Chosen />
    </Suspense>
  );
}

async function Chosen() {
  return (
    <LangProvider initial={await chosenLang()}>
      <WorkspaceDemo />
    </LangProvider>
  );
}
