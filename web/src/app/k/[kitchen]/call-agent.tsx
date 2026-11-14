"use client";

import { Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../_client/api";
import { useText } from "../../_i18n/provider";
import { VOICE_MODE_TEXT } from "../../_channels/voice-mode.text";
import { usePortal } from "./portal";

/**
 * "Talk on your phone": on a laptop, a code the phone scans to open this same conversation (signed in once, by a
 * one-time link), where its microphone starts the same hands-free mode (GET /ui-api/voice/{kitchen}/call -> { url,
 * qrSvg }). On a phone it is not shown: the composer's own microphone is the way to talk.
 */
type Link = { url: string; qrSvg?: string };

export function CallAgent({ compact = false }: { compact?: boolean }) {
  const { kitchen } = usePortal();
  const tx = useText(VOICE_MODE_TEXT);
  const [link, setLink] = useState<Link | null>();
  const [show, setShow] = useState(false);
  const [phone, setPhone] = useState(true);
  useEffect(() => {
    queueMicrotask(() => setPhone(window.matchMedia("(pointer: coarse)").matches));
  }, []);
  useEffect(() => {
    if (!show || link !== undefined) return;
    let alive = true;
    void api<Link>("GET", `/ui-api/voice/${encodeURIComponent(kitchen.slug)}/call`).then((r) => alive && setLink(r.ok && typeof r.data.url === "string" ? r.data : null));
    return () => {
      alive = false;
    };
  }, [kitchen.slug, show, link]);
  if (phone) return null;
  return (
    <div className={compact ? "text-[0.88rem]" : ""}>
      <button type="button" aria-expanded={show} onClick={() => setShow((x) => !x)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-paper px-4 text-[0.95rem] font-semibold text-ink transition-colors hover:border-ink-soft hover:bg-mist">
        <Smartphone aria-hidden size={17} /> {tx.phone}
      </button>
      {show && link?.qrSvg && (
        <figure className="mt-2 w-48">
          <div className="aspect-square rounded-lg border border-line bg-paper p-3 shadow-sm [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
          <figcaption className="mt-1 text-[0.85rem] leading-snug">{tx.phoneScan(kitchen.agentName)}</figcaption>
        </figure>
      )}
    </div>
  );
}
