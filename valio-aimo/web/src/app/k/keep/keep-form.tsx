"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "../../_client/api";
import { useText } from "../../_i18n/provider";
import { CircleAlert } from "lucide-react";
import { Button } from "../../_ui/kit";
import { DOOR_TEXT } from "../door.text";
import { TextField } from "../_account/forms";

export function KeepForm() {
  const tx = useText(DOOR_TEXT);
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const r = await api<{ next: string }>("POST", "/ui-api/account/keep", { username, password });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    router.push(r.data.next);
    router.refresh();
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <TextField id="keep-username" name="username" labelText={tx.username} hintText={tx.usernameHint} autoComplete="username" value={username} onChange={(v) => setUsername(v.toLowerCase())} minLength={3} maxLength={32} />
      <TextField id="keep-password" name="password" labelText={tx.password} hintText={tx.passwordHint} type="password" autoComplete="new-password" value={password} onChange={setPassword} minLength={10} maxLength={200} />
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-bad/20 bg-bad-soft px-3.5 py-2.5 text-[0.95rem] leading-snug">
          <CircleAlert aria-hidden size={18} className="mt-0.5 shrink-0 text-bad" />
          <span>{error}</span>
        </p>
      )}
      <Button kind="go" type="submit" size="lg" busy={busy} className="w-full sm:w-auto">
        {tx.keepButton}
      </Button>
    </form>
  );
}
