"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useText } from "../../_i18n/provider";
import { buttonClass } from "../../_ui/kit";
import { ACCOUNT_TEXT } from "../[kitchen]/account.text";
import { DOOR_TEXT } from "../door.text";
import { DevicePanel, MandateForm, SignUpForm } from "../_account/forms";

type Step = "account" | "rules" | "device";

/** The two steps, then the one-time offer of a signing device. A reload resumes at the right step (the session says). */
export function SignUpFlow({ signedIn }: { signedIn?: { restaurant: string; kitchen?: string; kind: string } }) {
  const tx = useText(DOOR_TEXT);
  const atx = useText(ACCOUNT_TEXT);
  const router = useRouter();
  const [step, setStep] = useState<Step>(signedIn ? (signedIn.kitchen && signedIn.kind !== "demo" ? "device" : "rules") : "account");
  const [shop, setShop] = useState(signedIn?.kitchen ? `/k/${signedIn.kitchen}` : "/k");
  return (
    <>
      <h1 className="display text-[2.4rem] sm:text-[2.8rem]">{tx.signupTitle}</h1>
      <ol className="flex flex-wrap gap-x-6 gap-y-1 text-[0.95rem]" aria-label={tx.signupTitle}>
        <li aria-current={step === "account" ? "step" : undefined} className={step === "account" ? "font-bold" : "text-ink-soft"}>
          1 {tx.step1}
        </li>
        <li aria-current={step === "rules" ? "step" : undefined} className={step === "rules" ? "font-bold" : "text-ink-soft"}>
          2 {tx.step2}
        </li>
      </ol>
      {step === "account" && (
        <section className="bg-paper p-5">
          <SignUpForm onDone={() => setStep("rules")} />
          <p className="mt-4 text-[0.95rem]">
            {tx.haveAccount}{" "}
            <Link href="/k" className="font-semibold text-petrol underline decoration-2 underline-offset-4">
              {tx.signInButton}
            </Link>
          </p>
        </section>
      )}
      {step === "rules" && (
        <section className="bg-paper p-5">
          <MandateForm
            onSigned={(r) => {
              setShop(r.next);
              setStep("device");
              router.refresh();
            }}
          />
        </section>
      )}
      {step === "device" && (
        <>
          <section className="space-y-2 bg-paper p-5">
            <h2 className="display text-[1.6rem]">{atx.offerTitle}</h2>
            <p className="max-w-[70ch] leading-snug">{atx.offerBody}</p>
          </section>
          <DevicePanel intro={false} />
          <Link href={shop} className={buttonClass("go")}>
            {tx.openShop}
          </Link>
        </>
      )}
    </>
  );
}
