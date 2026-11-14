"use client";

import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../_client/api";
import { useLang, useText } from "../../_i18n/provider";
import { passkeyProblemL } from "../../_ui/passkey.text";
import { PhoneNotice, PhoneProblem, bigButton } from "../../_ui/phone";
import { DOOR_TEXT } from "../../k/door.text";

type Begin = { options: PublicKeyCredentialCreationOptionsJSON; restaurant: string; signer?: string };

export function DeviceFlow() {
  const tx = useText(DOOR_TEXT);
  const { lang } = useLang();
  const link = useSearchParams().get("t") ?? "";
  const [begin, setBegin] = useState<Begin>();
  const [done, setDone] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; body: string }>();
  useEffect(() => {
    void api<Begin>("POST", "/ui-api/account/device", { step: "begin", link }).then((r) => (r.ok ? setBegin(r.data) : setProblem({ title: tx.deviceExpired, body: r.error.message })));
  }, [link, tx.deviceExpired]);
  async function create() {
    if (!begin) return;
    setBusy(true);
    setProblem(undefined);
    if (!browserSupportsWebAuthn()) {
      setBusy(false);
      return setProblem({ title: tx.failed, body: tx.deviceExpired });
    }
    try {
      const response = await startRegistration({ optionsJSON: begin.options });
      const r = await api<{ restaurant: string }>("POST", "/ui-api/account/device", { step: "verify", response, link });
      if (r.ok) setDone(r.data.restaurant);
      else setProblem({ title: tx.failed, body: r.error.message });
    } catch (err) {
      setProblem(passkeyProblemL(err, lang));
      // the prompt is used up: ask for a fresh one with the same link
      void api<Begin>("POST", "/ui-api/account/device", { step: "begin", link }).then((r) => r.ok && setBegin(r.data));
    }
    setBusy(false);
  }
  if (done)
    return (
      <PhoneNotice title={tx.deviceDone(done)}>
        <Link href="/approver" className={`mt-6 ${bigButton("go")}`}>
          {tx.deviceHome}
        </Link>
      </PhoneNotice>
    );
  if (!begin) return problem ? <PhoneNotice title={problem.title} body={problem.body} /> : <p className="mt-20 text-center text-ink-soft">…</p>;
  return (
    <div>
      <PhoneNotice title={tx.deviceTitle(begin.restaurant)} body={tx.deviceBody(begin.signer ?? "")} />
      {problem && <PhoneProblem title={problem.title} body={problem.body} />}
      <button type="button" onClick={() => void create()} disabled={busy} className={`mt-6 ${bigButton("go")}`}>
        {tx.deviceButton}
      </button>
    </div>
  );
}
