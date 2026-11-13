"use client";

import { useState } from "react";
import { api } from "../../../_client/api";
import { country, fi, money, when } from "../../_ui/format";
import { Button, Details, KV, Panel } from "../../_ui/kit";
import { verifyToken, type TokenCheck } from "../../_ui/verify-client";

/**
 * Paste a receipt, a quote or a signed claim from anywhere (an agent's log, an e-mail, the buyer's ERP) and check
 * it against the wholesaler's published keys, in this browser. Order confirmations are also matched to the ledger.
 */
export function VerifyBox({ initial = "", title = "Check a receipt or a signed claim" }: { initial?: string; title?: string }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TokenCheck & { checkedAt?: number }>();

  async function run() {
    setBusy(true);
    const ledger = await api<{ entries: { seq: number; hash: string }[] }>("GET", "/ops-api/ledger");
    setResult({ ...(await verifyToken(text, ledger.ok ? ledger.data.entries : undefined)), checkedAt: Date.now() });
    setBusy(false);
  }

  return (
    <Panel rule className="px-4 py-4">
      <h2 className="display text-[1.3rem]">{title}</h2>
      <p className="mt-0.5 text-[0.86rem] text-ink-soft">
        An order confirmation, a fixed-price quote, or a claim about price, availability or origin. Checked here against the keys published at /.well-known/jwks.json, not against this server&apos;s word.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(undefined);
        }}
        rows={5}
        spellCheck={false}
        placeholder="eyJhbGciOiJFZDI1NTE5Ii… or the JSON holding it"
        aria-label="Receipt or signed claim"
        className="mt-2 w-full resize-y border-2 border-line bg-mist px-2 py-1.5 font-mono text-[0.75rem] leading-snug focus:border-petrol focus:outline-none"
      />
      <Button kind="primary" onClick={run} disabled={busy || !text.trim()} className="mt-2">
        {busy ? "Checking…" : "Check signature"}
      </Button>
      {result && <ResultView r={result} />}
    </Panel>
  );
}

function ResultView({ r }: { r: TokenCheck & { checkedAt?: number } }) {
  if (!r.ok) {
    return (
      <div role="status" className="mt-3 bg-safety-ink text-paper">
        <div aria-hidden className="hazard h-2" />
        <p className="display px-3 pt-2 text-[1.3rem] text-safety">Does not verify</p>
        <p className="px-3 pb-2.5 text-[0.92rem]">{r.problem}</p>
      </div>
    );
  }
  const p = r.payload;
  const exp = typeof p.exp === "number" ? p.exp * 1000 : typeof p.validUntil === "string" ? Date.parse(p.validUntil) : undefined;
  const expired = exp !== undefined && r.checkedAt !== undefined && exp < r.checkedAt;
  return (
    <div role="status" className="mt-3 border-2 border-petrol">
      <p className="flex items-center gap-2 bg-petrol px-3 py-1.5 text-[1.02rem] font-semibold text-paper">
        <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden className="shrink-0">
          <path d="M2.5 7.2 L5.6 10.2 L11.6 3.6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
        </svg>
        Valid {r.kind.toLowerCase()}, signed by the wholesaler
        {r.by === "server" && <span className="ml-2 font-sans text-[0.78rem] font-normal">(checked by the server: this browser has no Ed25519)</span>}
      </p>
      <div className="space-y-1 px-3 py-2 text-[0.88rem]">
        {r.typ === "order+jws" && <OrderLines p={p} />}
        {r.typ === "quote+jws" && <QuoteLines p={p} />}
        {r.typ === "vc+jwt" && <ClaimLines p={p} />}
        {expired && <p className="font-semibold">The signature is genuine, but this statement expired {when(new Date(exp!).toISOString())}: ask for a fresh one.</p>}
        {r.anchor && (
          <p>
            {r.anchor.matches === true
              ? `It anchors the ledger at entry ${r.anchor.seq}, and the ledger still holds that entry with the same hash: nothing before it was rewritten.`
              : r.anchor.matches === false
                ? <span className="bg-safety-ink px-1.5 font-semibold text-safety">It anchors entry {r.anchor.seq}, but the ledger here no longer matches that hash.</span>
                : `It anchors the ledger at entry ${r.anchor.seq}.`}
          </p>
        )}
        <Details summary="Signed content">
          <KV k="typ" v={r.typ} />
          <KV k="kid" v={r.kid} />
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(p, null, 2)}</pre>
        </Details>
      </div>
    </div>
  );
}

function OrderLines({ p }: { p: Record<string, unknown> }) {
  const lines = (p.lines as { name: string; quantity: number; unitPriceCents: number; deliveryDate?: string }[] | undefined) ?? [];
  const by = p.authorisedBy as { kind?: string; name?: string; signOff?: { method?: string; verified?: boolean } } | undefined;
  return (
    <>
      <p>
        <b>{money(Number(p.totalCents))}</b> committed {typeof p.committedAt === "string" ? when(p.committedAt) : ""}, {lines.length} line{lines.length === 1 ? "" : "s"}.
      </p>
      <ul className="text-[0.84rem] text-ink-soft">
        {lines.map((l, i) => (
          <li key={i}>
            {l.quantity} × {l.name} at {money(l.unitPriceCents)}
          </li>
        ))}
      </ul>
      <p>
        Authorised by {by?.kind === "approver" ? `${by.name}, ${by.signOff?.method === "passkey" ? "with a passkey" : by.signOff?.method?.replaceAll("_", " ")}${by.signOff?.verified === false ? " (not verified)" : ""}` : "the mandate alone"}.
      </p>
    </>
  );
}

function QuoteLines({ p }: { p: Record<string, unknown> }) {
  return (
    <p>
      Quote for <b>{money(Number(p.totalCents))}</b>, price fixed until {typeof p.expiresAt === "string" ? when(p.expiresAt) : "?"}
      {Array.isArray(p.evidence) ? `, resting on ${p.evidence.length} signed claims` : ""}.
    </p>
  );
}

function ClaimLines({ p }: { p: Record<string, unknown> }) {
  const subject = (p.credentialSubject ?? {}) as Record<string, unknown>;
  const ev = ((p.evidence as Record<string, unknown>[] | undefined) ?? [])[0];
  const price = subject.price as { unitPriceCents?: number; per?: string } | undefined;
  const av = subject.availability as { deliveryDate?: string; orderBy?: string; cutoffPassed?: boolean; stock?: { known?: boolean; packs?: number | null } } | undefined;
  const origin = subject.origin as { countryOfOrigin?: string | null; brand?: string | null } | undefined;
  return (
    <>
      <p>
        About product <b>{String(subject.productId ?? p.sub)}</b>:{" "}
        {price && fi(`${money(price.unitPriceCents)} per ${price.per ?? "pack"}`)}
        {av && `delivery ${av.deliveryDate ? fi(av.deliveryDate) : "not stated"}${av.orderBy ? `, order by ${when(av.orderBy)}` : ""}${av.cutoffPassed ? ", cut-off passed" : ""}, stock ${av.stock?.known ? `${av.stock.packs} packs` : "not reported"}`}
        {origin && `origin ${origin.countryOfOrigin ? country(origin.countryOfOrigin) : "not stated"}${origin.brand ? `, brand ${origin.brand}` : ""}`}.
      </p>
      <p className="text-ink-soft">
        Observed {ev && typeof ev.observedAt === "string" ? when(ev.observedAt) : "?"} from {fi(String(ev?.source ?? "?"))}
        {ev?.simulated ? " (simulated)" : ""}; valid until {typeof p.validUntil === "string" ? when(p.validUntil) : "?"}
        {typeof p.aud === "string" ? `; stated to ${p.aud}` : ""}.
      </p>
    </>
  );
}
