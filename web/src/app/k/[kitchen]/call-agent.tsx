"use client";

import { Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../_client/api";
import { useText } from "../../_i18n/provider";
import { CALL_AGENT_TEXT } from "./call-agent.text";
import { usePortal } from "./portal";

/**
 * "Call your agent": a voice call with the kitchen's purchasing agent, started from a QR code. The call screen
 * and the helper that returns a kitchen's call URL and QR code are built under web/src/app/_channels/ with routes
 * under /ui-api/voice. Expected: GET /ui-api/voice/{kitchen}/call -> { url, qrSvg }. On a phone the control opens
 * the call; on a laptop it shows the code to scan. Until that route answers, the control says so and does nothing.
 */
type Call = { url: string; qrSvg?: string };

export function CallAgent({ compact = false }: { compact?: boolean }) {
  const { kitchen } = usePortal();
  const tx = useText(CALL_AGENT_TEXT);
  const [call, setCall] = useState<Call | null>();
  const [show, setShow] = useState(false);
  useEffect(() => {
    let alive = true;
    void api<Call>("GET", `/ui-api/voice/${encodeURIComponent(kitchen.slug)}/call`).then((r) => alive && setCall(r.ok && typeof r.data.url === "string" ? r.data : null));
    return () => {
      alive = false;
    };
  }, [kitchen.slug]);

  if (!call) {
    return (
      <div className={`flex items-center gap-2 ${compact ? "text-[0.88rem]" : ""}`}>
        <button type="button" disabled aria-disabled className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-paper px-4 text-[0.92rem] font-semibold text-ink-soft">
          <PhoneIcon /> {tx.call}
        </button>
        <span className="text-[0.85rem] text-ink-soft">{call === undefined ? tx.checking : tx.connecting}</span>
      </div>
    );
  }
  const phone = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return (
    <div>
      {phone ? (
        <a href={call.url} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-petrol px-5 text-[0.95rem] font-semibold text-paper">
          <PhoneIcon /> {tx.call}
        </a>
      ) : (
        <button type="button" aria-expanded={show} onClick={() => setShow((x) => !x)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-paper px-4 text-[0.95rem] font-semibold text-ink transition-colors hover:border-ink-soft hover:bg-mist">
          <PhoneIcon /> {tx.call}
        </button>
      )}
      {show && !phone && (
        <figure className="mt-2 w-48">
          {call.qrSvg ? <div className="aspect-square rounded-lg border border-line bg-paper p-3 shadow-sm [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: call.qrSvg }} /> : null}
          <figcaption className="mt-1 text-[0.85rem] leading-snug">{tx.scan(kitchen.agentName)}</figcaption>
        </figure>
      )}
    </div>
  );
}

function PhoneIcon() {
  return <Phone aria-hidden size={17} />;
}
