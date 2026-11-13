"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "../../_client/api";
import { Target } from "../../_ui/target";

/**
 * The door to the wholesaler's side. Steel, like the wall and the rail, so it never looks like a kitchen's portal.
 * Demo mode: one button. Passcode mode: the button asks for the passcode first.
 */
export function Entry({ mode }: { mode: "demo" | "passcode" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const next = params.get("next");
  const target = next && next.startsWith("/ops") && !next.startsWith("/ops/enter") ? next : "/ops";

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const r = await api("POST", "/ops-api/session", { name: name.trim() || undefined, passcode: mode === "passcode" ? passcode : undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    router.replace(target);
  }

  return (
    <main className="on-steel flex min-h-dvh items-center bg-steel px-4 py-10 text-chalk">
      <div className="mx-auto grid w-full max-w-[960px] gap-10 md:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <Target size={44} tone="chalk" />
            <span className="font-display text-[2.6rem] font-bold leading-none tracking-tight">Dock</span>
          </div>
          <h1 className="mt-8 font-display text-[2.3rem] font-bold leading-[1.05]">The wholesaler&apos;s operations desk</h1>
          <p className="mt-3 max-w-[46ch] text-[1.05rem] leading-relaxed text-chalk-soft">
            See every purchasing agent at the door, follow any request through the gate step by step, check what the rules refused, and stop an agent if it misbehaves.
          </p>
          <p className="mt-5 max-w-[46ch] text-[0.92rem] leading-relaxed text-chalk-soft">
            Staff here can suspend an agent. They cannot approve an order for a kitchen: only the person the kitchen&apos;s mandate names can, on their own phone.
          </p>
        </div>
        <form onSubmit={enter} className="self-center border-2 border-chalk bg-steel-2 p-6">
          <label className="block text-[0.9rem] font-semibold" htmlFor="ops-name">
            Your name, for the record
          </label>
          <input
            id="ops-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Operations desk"
            maxLength={60}
            autoComplete="name"
            className="mt-1.5 w-full border border-steel-3 bg-steel px-3 py-2 text-[1rem] text-chalk placeholder:text-chalk-soft/70"
          />
          <p className="mt-1 text-[0.8rem] text-chalk-soft">Written to the ledger with every suspension you make.</p>
          {mode === "passcode" && (
            <>
              <label className="mt-4 block text-[0.9rem] font-semibold" htmlFor="ops-passcode">
                Passcode
              </label>
              <input
                id="ops-passcode"
                type="password"
                required
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                autoComplete="current-password"
                className="mt-1.5 w-full border border-steel-3 bg-steel px-3 py-2 text-[1rem] text-chalk"
              />
            </>
          )}
          <button type="submit" disabled={busy} className="mt-5 w-full bg-chalk px-4 py-3 font-display text-[1.25rem] font-bold text-ink hover:bg-white disabled:opacity-60">
            {busy ? "Entering…" : "Enter as operations staff"}
          </button>
          {error && (
            <p role="alert" className="mt-3 bg-safety px-3 py-2 text-[0.9rem] font-semibold text-safety-ink">
              {error}
            </p>
          )}
          <p className="mt-4 text-[0.82rem] text-chalk-soft">
            {mode === "demo" ? "Demo entry: no password on this server." : "This server asks for a passcode."} Looking for a kitchen?{" "}
            <Link href="/k" className="underline underline-offset-2 hover:text-chalk">
              Kitchen portal
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
