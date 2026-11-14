"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../_client/api";
import { PRODUCT_NAME } from "../_ui/brand";
import { Button } from "../_ui/kit";
import { Target } from "../_ui/target";

/** The show is run from the operations side: the same passcode as /ops. */
export function ShowSignIn({ mode, what }: { mode: "demo" | "passcode"; what: string }) {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api("POST", "/ops-api/session", { passcode: mode === "passcode" ? passcode : undefined, name: name.trim() || "Presenter" });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    router.refresh();
  }
  return (
    <main className="on-dark flex min-h-dvh items-center justify-center bg-petrol-deep px-4 text-paper">
      <form onSubmit={enter} className="w-full max-w-[440px]">
        <div className="flex items-center gap-3">
          <Target size={40} tone="chalk" />
          <span className="display text-[2.4rem]">{PRODUCT_NAME}</span>
        </div>
        <h1 className="display mt-6 text-[2.6rem] leading-none">{what}</h1>
        <p className="mt-3 text-paper/85">The show runs from the wholesaler&apos;s side: enter the operations passcode. It is never shown on screen.</p>
        <label className="mt-6 block text-[0.95rem] font-semibold" htmlFor="show-name">
          Your name, for the record
        </label>
        <input id="show-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 min-h-11 w-full border-2 border-paper/60 bg-transparent px-3 text-paper" autoComplete="name" />
        {mode === "passcode" && (
          <>
            <label className="mt-4 block text-[0.95rem] font-semibold" htmlFor="show-pass">
              Operations passcode
            </label>
            <input id="show-pass" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} className="mt-1 min-h-11 w-full border-2 border-paper/60 bg-transparent px-3 text-paper" autoComplete="current-password" required />
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 font-semibold text-safety">
            {error}
          </p>
        )}
        <Button type="submit" kind="go" size="lg" busy={busy} className="mt-6 w-full">
          Enter
        </Button>
      </form>
    </main>
  );
}
