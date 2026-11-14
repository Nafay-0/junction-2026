"use client";

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
        <button type="button" disabled aria-disabled className="inline-flex min-h-10 items-center gap-2 border-2 border-line bg-paper px-3 font-semibold text-ink-soft">
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
        <a href={call.url} className="inline-flex min-h-11 items-center gap-2 bg-petrol px-4 font-semibold text-paper">
          <PhoneIcon /> {tx.call}
        </a>
      ) : (
        <button type="button" aria-expanded={show} onClick={() => setShow((x) => !x)} className="inline-flex min-h-11 items-center gap-2 border-2 border-petrol bg-paper px-3 font-semibold text-petrol hover:bg-petrol-soft">
          <PhoneIcon /> {tx.call}
        </button>
      )}
      {show && !phone && (
        <figure className="mt-2 w-48">
          {call.qrSvg ? <div className="aspect-square bg-paper p-2 ring-[3px] ring-petrol [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: call.qrSvg }} /> : null}
          <figcaption className="mt-1 text-[0.85rem] leading-snug">{tx.scan(kitchen.agentName)}</figcaption>
        </figure>
      )}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
      <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z" />
    </svg>
  );
}
