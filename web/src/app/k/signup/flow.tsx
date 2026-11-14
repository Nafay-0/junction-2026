"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useText } from "../../_i18n/provider";
import { ArrowRight, Check } from "lucide-react";
import { Card, IconDisc, Steps, buttonClass, type StepState } from "../../_ui/kit";
import { ACCOUNT_TEXT } from "../[kitchen]/account.text";
import { DOOR_TEXT } from "../door.text";
import { DevicePanel, SignUpForm } from "../_account/forms";
import { SetUpInterview } from "./thread-interview";

type Step = "account" | "rules" | "device";

/**
 * The two steps: the account, then the set-up interview that ends in the kitchen's rules confirmed and this device
 * added to OK orders (thread-interview.tsx). A reload after the rules were confirmed lands on the one-time offer of a
 * signing device (the session says).
 */
export function SignUpFlow({ signedIn }: { signedIn?: { restaurant: string; kitchen?: string; kind: string } }) {
  const tx = useText(DOOR_TEXT);
  const atx = useText(ACCOUNT_TEXT);
  const router = useRouter();
  const [step, setStep] = useState<Step>(signedIn ? (signedIn.kitchen && signedIn.kind !== "demo" ? "device" : "rules") : "account");
  const shop = signedIn?.kitchen ? `/k/${signedIn.kitchen}` : "/k";
  const steps: { key: string; label: string; state: StepState }[] = [
    { key: "account", label: tx.step1, state: step === "account" ? "current" : "done" },
    { key: "rules", label: tx.step2, state: step === "rules" ? "current" : step === "device" ? "done" : "pending" },
  ];
  return (
    <>
      <div className="space-y-5">
        <h1 className="display text-[2.1rem] leading-[1.05] sm:text-[2.6rem]">{tx.signupTitle}</h1>
        <div className="max-w-md">
          <Steps label={tx.signupTitle} steps={steps} />
          <p className="mt-2 text-[0.95rem] font-semibold sm:hidden">
            <span className="tabular text-ink-soft">{step === "account" ? 1 : 2}/2 </span>
            {step === "account" ? tx.step1 : tx.step2}
          </p>
        </div>
      </div>
      {step === "account" && (
        <>
          <Card pad>
            <SignUpForm onDone={() => setStep("rules")} />
          </Card>
          <p className="text-center text-[0.95rem] text-ink-soft sm:text-left">
            {tx.haveAccount}{" "}
            <Link href="/k" className="inline-flex min-h-11 items-center font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
              {tx.signInButton}
            </Link>
          </p>
        </>
      )}
      {step === "rules" && (
        <SetUpInterview
          onFinished={(next) => {
            // Signed, and this device added (or offered on the done screen): straight into the agent.
            router.push(next);
            router.refresh();
          }}
        />
      )}
      {step === "device" && (
        <>
          <section className="flex items-start gap-4">
            <IconDisc tone="good">
              <Check size={22} strokeWidth={2.4} />
            </IconDisc>
            <div className="min-w-0">
              <h2 className="display text-[1.5rem] leading-tight">{atx.offerTitle}</h2>
              <p className="mt-1.5 max-w-[64ch] leading-relaxed text-ink-soft">{atx.offerBody}</p>
            </div>
          </section>
          <DevicePanel intro={false} />
          <Link href={shop} className={buttonClass("go", "lg", "w-full sm:w-auto")}>
            {tx.openShop}
            <ArrowRight aria-hidden size={18} />
          </Link>
        </>
      )}
    </>
  );
}
