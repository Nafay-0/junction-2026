"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "../../_client/api";
import { buttonClass, Spinner } from "../../_ui/kit";
import { Wordmark } from "../../_ui/wordmark";
import { OPS_DEMO_NOTE } from "../_ui/rail";

/**
 * The door to the wholesaler's side. Petrol-deep, like the rail and the wall, so it never looks like a kitchen's shop.
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
    <main className="grid min-h-dvh bg-mist text-ink md:grid-cols-[1.05fr_1fr]">
      <section className="on-dark flex flex-col justify-between gap-10 bg-petrol-deep px-6 py-10 text-paper sm:px-12">
        <div>
          <Wordmark tone="paper" size={40} />
        </div>
        <div>
          <h1 className="display max-w-[16ch] text-[clamp(2.6rem,4.4vw,4.2rem)] leading-[0.95]">The wholesaler&apos;s operations desk</h1>
          <p className="mt-5 max-w-[46ch] text-[1.08rem] leading-relaxed text-paper/85">
            See every purchasing agent at the door, replay any request through the gate step by step, read what the rules refused, and stop an agent that misbehaves.
          </p>
          <p className="mt-4 max-w-[46ch] text-[0.95rem] leading-relaxed text-paper/70">
            Staff here can suspend an agent. They cannot approve an order for a kitchen: only the person the kitchen&apos;s mandate names can, on their own phone.
          </p>
        </div>
        <p className="text-[0.82rem] text-paper/60">{OPS_DEMO_NOTE}</p>
      </section>
      <section className="flex items-center px-6 py-10 sm:px-12">
        <form onSubmit={enter} className="w-full max-w-[420px] bg-paper">
          <div aria-hidden className="h-[3px] bg-petrol" />
          <div className="p-6">
            <label className="block text-[0.95rem] font-semibold" htmlFor="ops-name">
              Your name, for the record
            </label>
            <input
              id="ops-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Operations desk"
              maxLength={60}
              autoComplete="name"
              className="mt-1.5 min-h-11 w-full border-2 border-line bg-paper px-3 text-[1rem] text-ink placeholder:text-ink-soft focus:border-petrol focus:outline-none"
            />
            <p className="mt-1 text-[0.84rem] text-ink-soft">Written to the ledger with every suspension you make.</p>
            {mode === "passcode" && (
              <>
                <label className="mt-4 block text-[0.95rem] font-semibold" htmlFor="ops-passcode">
                  Passcode
                </label>
                <input
                  id="ops-passcode"
                  type="password"
                  required
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  autoComplete="current-password"
                  className="mt-1.5 min-h-11 w-full border-2 border-line bg-paper px-3 text-[1rem] text-ink focus:border-petrol focus:outline-none"
                />
              </>
            )}
            <button type="submit" disabled={busy} className={buttonClass("go", "lg", "mt-5 w-full")}>
              {busy && <Spinner size={16} />}
              {busy ? "Entering…" : "Enter as operations staff"}
            </button>
            {error && (
              <p role="alert" className="mt-3 border-l-[6px] border-petrol bg-mist px-3 py-2 text-[0.92rem] font-semibold">
                {error}
              </p>
            )}
            <p className="mt-4 text-[0.86rem] text-ink-soft">
              {mode === "demo" ? "Demo entry: no password on this server." : "This server asks for a passcode."} Looking for a kitchen?{" "}
              <Link href="/k" className="font-semibold text-petrol underline underline-offset-2">
                Kitchen shop
              </Link>
            </p>
          </div>
        </form>
      </section>
    </main>
  );
}
