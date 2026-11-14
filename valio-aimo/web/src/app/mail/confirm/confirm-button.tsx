"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { api } from "../../_client/api";
import { useText } from "../../_i18n/provider";
import { Button, Panel } from "../../_ui/kit";
import { MAIL_PAGES_TEXT } from "../mail-pages.text";

export function ConfirmButton({ token, masked }: { token: string; masked: string }) {
  const tx = useText(MAIL_PAGES_TEXT);
  const [state, setState] = useState<"idle" | "busy" | "done" | "bad">("idle");
  async function confirm() {
    setState("busy");
    const r = await api<{ ok: boolean }>("POST", "/ui-api/mail/confirm", { t: token });
    setState(r.ok ? "done" : "bad");
  }
  if (state === "done")
    return (
      <Panel tone="good" className="flex items-center gap-2 px-4 py-3 text-good">
        <Check aria-hidden size={17} strokeWidth={2.5} />
        <p role="status">{tx.confirmed(masked)}</p>
      </Panel>
    );
  if (state === "bad") return <p role="alert" className="text-bad">{tx.bad}</p>;
  return (
    <Button kind="primary" busy={state === "busy"} onClick={() => void confirm()}>
      {tx.confirmButton}
    </Button>
  );
}
