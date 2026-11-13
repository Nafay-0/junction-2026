"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { IntakeView } from "@/core/intake";
import type { NeedUnit } from "@/core/need";
import type { PublicOrder } from "@/core/orders";
import type { LineStatus, ScanLine } from "@/server/channels/scan/lines";
import type { ScanResult } from "@/server/channels/scan/read";
import type { StepReply } from "@/server/channels/scan/door";
import { OrderCard, StepCards, type Act } from "./cards";

/**
 * The photo door: a photo of a whiteboard or a handwritten list, an image, a PDF or a pasted email becomes
 * lines to review (what was read, amount, unit, how sure the reading is, where on the image), editable before
 * anything happens. Reviewed lines go one at a time through the same intake as typing, the rest queued in view.
 *
 *   <ScanDoor kitchen="kaari" onStep={...} onOrder={...} renderSignOff={...} />
 */

export type ScanDoorProps = {
  kitchen: string;
  onStep?: (step: IntakeView) => void;
  onOrder?: (order: PublicOrder) => void;
  renderSignOff?: (order: PublicOrder) => ReactNode;
};

type Row = ScanLine & { include: boolean; edited: boolean; original: { item: string | null; amount: number | null; unit: NeedUnit | null } };
type QueueItem = { row: Row; state: "waiting" | "active" | "done" | "skipped" | "failed"; step?: IntakeView; order?: PublicOrder; problem?: string };

const STATUS: Record<LineStatus, { label: string; tone: "ok" | "warn" | "off" }> = {
  ready: { label: "Read clearly", tone: "ok" },
  check: { label: "Check this", tone: "warn" },
  needs_amount: { label: "Amount or unit missing", tone: "warn" },
  illegible: { label: "Could not read", tone: "warn" },
  instruction: { label: "Not acted on", tone: "off" },
  not_an_item: { label: "Not an item", tone: "off" },
};
const UNITS: NeedUnit[] = ["L", "kg", "pcs", "pack"];
const UNIT_TEXT: Record<NeedUnit, string> = { L: "litres", kg: "kilos", pcs: "pieces", pack: "packs" };

/** Re-encode a photo upright (EXIF orientation applied) and at most 2000 px, so the reader and the boxes agree. */
async function normalise(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.85));
  } catch {
    return file; // HEIC on a browser that cannot decode it: the server says what it accepts
  }
}

async function postJson<T>(path: string, body: unknown): Promise<{ ok: boolean; data: T & { error?: { message: string; code: string } } }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && !data.error, data };
  } catch {
    return { ok: false, data: { error: { code: "network", message: "No connection to Dock." } } as never };
  }
}

export function ScanDoor({ kitchen, onStep, onOrder, renderSignOff }: ScanDoorProps) {
  const base = `/ui-api/scan/${encodeURIComponent(kitchen)}`;
  const [preview, setPreview] = useState<{ url: string; kind: "image" | "pdf" } | null>(null);
  const [paste, setPaste] = useState("");
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<(Omit<ScanResult, "lines"> & { rows: Row[] }) | null>(null);
  const [deliverBy, setDeliverBy] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview.url)), [preview]);

  const accept = useCallback((r: ScanResult) => {
    setResult({
      ...r,
      rows: r.lines.map((l) => ({ ...l, include: l.status === "ready", edited: false, original: { item: l.item, amount: l.amount, unit: l.unit } })),
    });
    setDeliverBy(r.deliverByAsWritten ?? "");
    setQueue([]);
  }, []);

  async function readFile(file: File) {
    setError(null);
    setResult(null);
    setReading(true);
    const blob = await normalise(file);
    const kind = blob.type === "application/pdf" || file.type === "application/pdf" ? "pdf" : "image";
    setPreview({ url: URL.createObjectURL(blob), kind });
    const form = new FormData();
    form.append("file", blob, kind === "pdf" ? "list.pdf" : "list.jpg");
    try {
      const res = await fetch(base, { method: "POST", body: form, cache: "no-store" });
      const data = await res.json();
      if (!res.ok || data.error) setError(data.error?.message ?? `Dock answered ${res.status}.`);
      else accept(data);
    } catch {
      setError("No connection to Dock.");
    }
    setReading(false);
  }

  async function readText() {
    const text = paste.trim();
    if (!text) return;
    setError(null);
    setResult(null);
    setPreview(null);
    setReading(true);
    const r = await postJson<ScanResult>(base, { text });
    if (r.ok) accept(r.data);
    else setError(r.data.error?.message ?? "The text could not be read.");
    setReading(false);
  }

  const edit = (id: string, patch: Partial<Row>) =>
    setResult((r) =>
      r && {
        ...r,
        rows: r.rows.map((x) => {
          if (x.id !== id) return x;
          const next = { ...x, ...patch };
          next.edited = next.item !== x.original.item || next.amount !== x.original.amount || next.unit !== x.original.unit;
          // A line becomes includable once it has an item, an amount and a unit.
          if (("amount" in patch || "unit" in patch || "item" in patch) && next.item && next.amount && next.unit && x.status !== "instruction" && x.status !== "not_an_item") next.include = true;
          return next;
        }),
      },
    );

  const sendable = (result?.rows ?? []).filter((r) => r.include && r.item && r.amount && r.unit && r.status !== "instruction");

  // ---------- the queue: one line at a time through the intake ----------

  const run = useCallback(
    async (q: QueueItem[], index: number) => {
      const item = q[index];
      if (!item) return;
      setBusy(true);
      setQueue((xs) => xs.map((x, i) => (i === index ? { ...x, state: "active" } : x)));
      const r = await postJson<StepReply>(`${base}/step`, {
        action: "open",
        line: { id: item.row.id, read: item.row.read, item: item.row.item, amount: item.row.amount, unit: item.row.unit, confidence: item.row.confidence, edited: item.row.edited },
        deliverBy: deliverBy.trim() || undefined,
        source: result?.kind ?? "image",
        scanModel: result?.model,
      });
      setBusy(false);
      const problem = r.data.problem?.message ?? r.data.error?.message;
      setQueue((xs) => xs.map((x, i) => (i === index ? { ...x, step: r.data.step, state: problem && !r.data.step ? "failed" : "active", problem } : x)));
      if (r.data.step) onStep?.(r.data.step);
    },
    [base, deliverBy, onStep, result],
  );

  function start() {
    const q: QueueItem[] = sendable.map((row) => ({ row, state: "waiting" }));
    setQueue(q);
    void run(q, 0);
  }

  const activeIndex = queue.findIndex((x) => x.state === "active");
  const active = activeIndex >= 0 ? queue[activeIndex] : undefined;

  const next = (state: QueueItem["state"]) => {
    const q = queue.map((x, i) => (i === activeIndex ? { ...x, state } : x));
    setQueue(q);
    const n = q.findIndex((x) => x.state === "waiting");
    if (n >= 0) void run(q, n);
  };

  const act: Act = async (name, args) => {
    if (!active?.step) return;
    const action = { respond_to_check: "respond", answer_question: "answer", choose_option: "choose", place_order: "place" }[name];
    if (!action) return;
    setBusy(true);
    const r = await postJson<StepReply>(`${base}/step`, { action, requestId: active.step.requestId, ...args });
    setBusy(false);
    const problem = r.data.problem?.message ?? r.data.error?.message;
    setQueue((xs) => xs.map((x, i) => (i === activeIndex ? { ...x, step: r.data.step ?? x.step, order: r.data.order ?? x.order, problem } : x)));
    if (r.data.step) onStep?.(r.data.step);
    if (r.data.order) onOrder?.(r.data.order);
  };

  // Poll an order that waits for sign-off.
  const waitingOrder = active?.order?.status === "pending_approval" ? active.order.orderId : undefined;
  useEffect(() => {
    if (!waitingOrder) return;
    const t = window.setInterval(async () => {
      const r = await postJson<StepReply>(`${base}/step`, { action: "order", orderId: waitingOrder });
      const o = r.data.order;
      if (o && o.status !== "pending_approval") {
        setQueue((xs) => xs.map((x) => (x.order?.orderId === o.orderId ? { ...x, order: o } : x)));
        onOrder?.(o);
      }
    }, 3000);
    return () => window.clearInterval(t);
  }, [waitingOrder, base, onOrder]);

  const focused = result?.rows.find((r) => r.id === focus);
  const settled = active && (active.order || active.step?.state === "no_options" || active.step?.state === "cancelled");

  return (
    <div className="space-y-4 text-ink">
      {!result && !reading && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => cameraRef.current?.click()} className="min-h-12 rounded-lg bg-ink px-4 font-semibold text-paper">
              Take a photo
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} className="min-h-12 rounded-lg border-2 border-ink bg-paper px-4 font-semibold">
              Choose image or PDF
            </button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void readFile(f);
              else {
                const t = e.dataTransfer.getData("text/plain");
                if (t) setPaste(t);
              }
            }}
            className="rounded-xl border-2 border-dashed border-ink-soft bg-paper p-3"
          >
            <label htmlFor="scan-paste" className="text-sm font-semibold text-ink-soft">
              Or drop a file here, or paste an email or a list
            </label>
            <textarea id="scan-paste" value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} className="mt-1 w-full rounded border border-concrete-deep p-2 text-[1rem]" placeholder={"Hei, torstaille 2 laatikkoa maitoa ja 15 kg rahkaa…"} />
            <button type="button" disabled={!paste.trim()} onClick={() => void readText()} className="mt-2 min-h-11 rounded-lg bg-ink px-4 font-semibold text-paper disabled:opacity-40">
              Read the text
            </button>
          </div>
          <p className="text-sm text-ink-soft">Photos up to 8 MB, PDFs up to 10 MB and 5 pages. Read in memory and not kept.</p>
        </div>
      )}

      {reading && <p className="text-[1.1rem]" role="status">Reading the list…</p>}
      {error && (
        <p role="alert" className="rounded-lg border-2 border-ink bg-paper p-3">
          {error}{" "}
          <button type="button" className="underline" onClick={() => setError(null)}>
            OK
          </button>
        </p>
      )}

      {result && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {preview?.kind === "image" ? (
            <div className="relative self-start overflow-hidden rounded-xl border-2 border-ink bg-paper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt="The list as photographed" className="block w-full" />
              {result.rows.map((r) =>
                r.box ? (
                  <button
                    key={r.id}
                    type="button"
                    aria-label={`Line: ${r.read}`}
                    onClick={() => setFocus(r.id)}
                    className={`absolute rounded border-2 ${focus === r.id ? "border-ink bg-safety/30" : r.status === "ready" ? "border-ink/40" : "border-safety bg-safety/10"}`}
                    style={{ left: `${r.box.x * 100}%`, top: `${r.box.y * 100}%`, width: `${r.box.w * 100}%`, height: `${r.box.h * 100}%` }}
                  />
                ) : null,
              )}
            </div>
          ) : (
            <div className="self-start rounded-xl border-2 border-ink bg-paper p-3 text-sm text-ink-soft">{result.kind === "pdf" ? "PDF read; positions are not shown for PDFs." : "Pasted text."}</div>
          )}

          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              {result.rows.length} line{result.rows.length === 1 ? "" : "s"} read by {result.model} in {(result.ms / 1000).toFixed(1)} s{result.costUsd !== null ? `, $${result.costUsd.toFixed(4)}` : ""}. {result.isOrderList ? "" : "This does not look like an order list."}
            </p>
            <label className="block text-sm font-semibold">
              Delivery, as written
              <input value={deliverBy} onChange={(e) => setDeliverBy(e.target.value)} placeholder="none written" className="mt-1 block min-h-11 w-full rounded border-2 border-ink bg-paper px-2 text-[1rem]" />
            </label>
            <ul className="space-y-2">
              {result.rows.map((r) => {
                const s = STATUS[r.status];
                const off = s.tone === "off";
                return (
                  <li key={r.id} onFocus={() => setFocus(r.id)} onMouseEnter={() => setFocus(r.id)} className={`rounded-lg border-2 bg-paper p-3 ${focus === r.id ? "border-ink" : "border-concrete-deep"} ${off ? "opacity-70" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[1.05rem] ${r.status === "instruction" ? "line-through" : ""}`}>
                        <span className="text-xs font-bold uppercase text-ink-soft">Read: </span>“{r.read}”
                      </p>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${s.tone === "warn" ? "bg-safety text-safety-ink" : s.tone === "ok" ? "bg-ink text-paper" : "bg-concrete-deep"}`}>
                        {s.label} · {r.confidence}
                      </span>
                    </div>
                    {r.notes.map((n) => (
                      <p key={n} className="mt-1 text-sm">
                        {n}
                      </p>
                    ))}
                    {!off && (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <label className="flex min-w-0 flex-[2_1_10rem] flex-col text-xs font-semibold">
                          Item
                          <input value={r.item ?? ""} onChange={(e) => edit(r.id, { item: e.target.value || null })} className="min-h-11 rounded border-2 border-ink px-2 text-[1rem] font-normal" />
                        </label>
                        <label className="flex w-24 flex-col text-xs font-semibold">
                          Amount
                          <input type="number" inputMode="decimal" min={0} value={r.amount ?? ""} onChange={(e) => edit(r.id, { amount: e.target.value ? Number(e.target.value) : null })} className="min-h-11 rounded border-2 border-ink px-2 text-[1rem] font-normal tabular" />
                        </label>
                        <label className="flex w-28 flex-col text-xs font-semibold">
                          Unit
                          <select value={r.unit ?? ""} onChange={(e) => edit(r.id, { unit: (e.target.value || null) as NeedUnit | null })} className="min-h-11 rounded border-2 border-ink px-1 text-[1rem] font-normal">
                            <option value="">choose</option>
                            {UNITS.map((u) => (
                              <option key={u} value={u}>
                                {UNIT_TEXT[u]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                          <input type="checkbox" checked={r.include} disabled={!r.item || !r.amount || !r.unit} onChange={(e) => edit(r.id, { include: e.target.checked })} className="size-5" />
                          Order
                        </label>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {queue.length === 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!sendable.length} onClick={start} className="min-h-12 rounded-lg bg-ink px-4 font-semibold text-paper disabled:opacity-40">
                  Send {sendable.length} line{sendable.length === 1 ? "" : "s"} to the agent
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setPreview(null);
                  }}
                  className="min-h-12 rounded-lg border-2 border-ink px-4 font-semibold"
                >
                  Start over
                </button>
              </div>
            )}
            {focused?.box && <p className="sr-only">Highlighted on the image: {focused.read}</p>}
          </div>
        </div>
      )}

      {queue.length > 0 && (
        <section className="space-y-3" aria-label="Lines going through the agent">
          <ol className="flex flex-wrap gap-2 text-sm">
            {queue.map((x, i) => (
              <li key={x.row.id} className={`rounded-full border-2 px-3 py-1 ${x.state === "active" ? "border-ink bg-ink text-paper" : "border-concrete-deep bg-paper"}`}>
                {i + 1}. {x.row.amount} {x.row.unit} {x.row.item} · {x.state === "done" ? (x.order ? (x.order.status === "pending_approval" ? "waiting for sign-off" : x.order.status) : "done") : x.state}
              </li>
            ))}
          </ol>
          {active && (
            <div className="space-y-3">
              {active.problem && (
                <p role="alert" className="rounded-lg border-2 border-ink bg-paper p-3">
                  {active.problem}
                </p>
              )}
              {active.order ? <OrderCard order={active.order} signOff={renderSignOff?.(active.order)} /> : active.step && <StepCards step={active.step} act={(n, a, l) => void act(n, a, l)} busy={busy} />}
              <div className="flex flex-wrap gap-2">
                {queue.some((x) => x.state === "waiting") && (
                  <button type="button" onClick={() => next(settled ? "done" : "skipped")} className="min-h-11 rounded-lg border-2 border-ink px-4 font-semibold">
                    {settled ? "Next line" : "Skip this line"}
                  </button>
                )}
              </div>
            </div>
          )}
          {!active && queue.every((x) => x.state !== "waiting") && <p className="text-[1.05rem]">All lines handled.</p>}
        </section>
      )}
    </div>
  );
}
