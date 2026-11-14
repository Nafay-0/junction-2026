"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../_client/api";
import { PRODUCT_NAME } from "../_ui/brand";
import { Button } from "../_ui/kit";
import { PilotLight } from "../_ui/wordmark";

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
      <form onSubmit={enter} className="w-full max-w-[460px] rounded-2xl bg-paper/[0.05] p-7 ring-1 ring-inset ring-paper/10 sm:p-9">
        <div className="flex items-center gap-3">
          <PilotLight size="2.2rem" onDark />
          <span className="display text-[2.2rem] leading-none" style={{ fontWeight: 700, letterSpacing: "-0.03em" }}>
            {PRODUCT_NAME}
          </span>
        </div>
        <h1 className="display mt-6 text-[2.6rem] leading-none">{what}</h1>
        <p className="mt-3 text-paper/85">The show runs from the wholesaler&apos;s side: enter the operations passcode. It is never shown on screen.</p>
        <label className="mt-6 block text-[0.95rem] font-semibold" htmlFor="show-name">
          Your name, for the record
        </label>
        <input id="show-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 min-h-12 w-full rounded-md border border-paper/30 bg-paper/[0.06] px-4 text-paper transition-[border-color,box-shadow] focus:border-lime focus:shadow-[0_0_0_3px_rgb(192_224_33/0.25)] focus:outline-none" autoComplete="name" />
        {mode === "passcode" && (
          <>
            <label className="mt-4 block text-[0.95rem] font-semibold" htmlFor="show-pass">
              Operations passcode
            </label>
            <input id="show-pass" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} className="mt-1.5 min-h-12 w-full rounded-md border border-paper/30 bg-paper/[0.06] px-4 text-paper transition-[border-color,box-shadow] focus:border-lime focus:shadow-[0_0_0_3px_rgb(192_224_33/0.25)] focus:outline-none" autoComplete="current-password" required />
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-paper/[0.08] px-3 py-2 font-semibold text-safety">
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
