import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { crashBoard } from "../../../_wall/crash-board";
import { AgentsScreen } from "./agents";

export const metadata: Metadata = { title: "Agents" };

/** /ops/agents: every agent at this gate, its licence and record, and the crash test's ratings (read when rendered). */
export default function AgentsPage() {
  return (
    <Suspense fallback={<AgentsScreen />}>
      <WithBoard />
    </Suspense>
  );
}

async function WithBoard() {
  await connection(); // the crash test's files are read per request, so a new run shows without a rebuild
  return <AgentsScreen board={crashBoard()} />;
}
