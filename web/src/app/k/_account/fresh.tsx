"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { api } from "../../_client/api";
import { useText } from "../../_i18n/provider";
import { Button } from "../../_ui/kit";
import { DOOR_TEXT } from "../door.text";
import { LINK_GO } from "./links";

/**
 * "Start a fresh kitchen" (server/demo/fresh.ts): one click, nothing asked, signed in and on the agent. A browser that
 * already has one is offered it back, and a new one only on "Start over".
 */
export function FreshStart({ mine }: { mine?: { slug: string; name: string } }) {
  const tx = useText(DOOR_TEXT);
  const router = useRouter();
  const [busy, setBusy] = useState<"new" | "again">();
  const [error, setError] = useState<string>();
  async function go(fresh: boolean) {
    setBusy(fresh ? "again" : "new");
    setError(undefined);
    const r = await api<{ next: string }>("POST", "/ui-api/account/fresh", fresh ? { fresh: true } : {});
    if (!r.ok) {
      setBusy(undefined);
      return setError(r.error.message);
    }
    router.push(r.data.next);
    router.refresh();
  }
  return (
    <div className="space-y-3">
      {mine ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Link href={`/k/${mine.slug}`} className={`${LINK_GO} min-h-13 text-[1.05rem]`} data-testid="fresh-back">
            {tx.freshBack(mine.name)}
            <ArrowRight aria-hidden size={18} />
          </Link>
          <Button kind="quiet" busy={busy === "again"} disabled={!!busy} onClick={() => void go(true)}>
            {busy !== "again" && <RotateCcw aria-hidden size={15} />}
            {tx.freshNew}
          </Button>
        </div>
      ) : (
        <Button kind="go" size="lg" busy={busy === "new"} disabled={!!busy} onClick={() => void go(false)} className="w-full sm:w-auto">
          {busy === "new" ? tx.freshBusy : tx.freshButton}
          {busy !== "new" && <ArrowRight aria-hidden size={18} />}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-[0.9rem] leading-snug text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
