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
        <form onSubmit={enter} className="w-full max-w-[440px] rounded-2xl border border-line bg-paper shadow-sm">
          <div className="p-6 sm:p-8">
            <h2 className="display mb-5 text-[1.5rem]">Enter the operations desk</h2>
            <label className="block text-[0.875rem] font-medium" htmlFor="ops-name">
              Your name, for the record
            </label>
            <input
              id="ops-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Operations desk"
              maxLength={60}
              autoComplete="name"
              className="field mt-1.5"
            />
            <p className="mt-1.5 text-[0.84rem] text-ink-soft">Written to the ledger with every suspension you make.</p>
            {mode === "passcode" && (
              <>
                <label className="mt-5 block text-[0.875rem] font-medium" htmlFor="ops-passcode">
                  Passcode
                </label>
                <input
                  id="ops-passcode"
                  type="password"
                  required
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  autoComplete="current-password"
                  className="field mt-1.5"
                />
              </>
            )}
            <button type="submit" disabled={busy} className={buttonClass("go", "lg", "mt-6 w-full")}>
              {busy && <Spinner size={16} />}
              {busy ? "Entering…" : "Enter as operations staff"}
            </button>
            {error && (
              <p role="alert" className="mt-4 rounded-lg border border-bad/20 bg-bad-soft px-4 py-3 text-[0.92rem] font-semibold">
                {error}
              </p>
            )}
            <p className="mt-5 border-t border-line pt-4 text-[0.86rem] text-ink-soft">
              {mode === "demo" ? "Demo entry: no password on this server." : "This server asks for a passcode."} Looking for a kitchen?{" "}
              <Link href="/k" className="font-medium text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                Kitchen shop
              </Link>
            </p>
          </div>
        </form>
      </section>
    </main>
  );
}
