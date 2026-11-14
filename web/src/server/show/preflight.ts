import { generateText } from "ai";
import { createModel } from "../agent/models";
import { launcherStatus } from "../aiven/showcase/launcher";
import { opsMode } from "../ops/access";
import { suspensions } from "../ops/suspensions";
import { serviceHealth } from "../health";
import type { Runtime } from "../runtime";
import { sandboxLimits } from "../config";
import { ShowAgent } from "./agent";
import { deliveryDates } from "./cast";
import { OUTSIDE_LIMITS, availableModels, outsideSpend } from "./outside";
import { recordingIndex } from "./recordings";
import { SHOW_LIMITS, resolveKitchen, showCounts } from "./registry";
import type { PreflightCheck, Spend } from "./types";

/**
 * Five minutes before going on: everything the three minutes need, each with what is wrong and what to do.
 * It makes one live price call (to know the partner's service answers now) and, with `model`, one tiny model call
 * (well under a cent). It never starts a week or places an order.
 */
export async function preflight(rt: Runtime, opts: { sandboxId?: string; model?: boolean; origin?: string }): Promise<PreflightCheck[]> {
  const out: PreflightCheck[] = [];
  const add = (c: PreflightCheck) => out.push(c);

  // Who may run the show.
  add(opsMode() === "passcode" ? { id: "passcode", label: "Operations passcode", state: "ok", detail: "Set: only someone with the passcode can run the show or suspend agents." } : { id: "passcode", label: "Operations passcode", state: process.env.NODE_ENV === "production" ? "fail" : "warn", detail: "Not set: anyone can open /present and the operations desk.", fix: "Set DOCK_OPS_PASSCODE on the server." });

  // Phones need a public https address for the QR code and passkeys.
  const pub = process.env.DOCK_PUBLIC_URL?.trim();
  if (pub && pub.startsWith("https://")) add({ id: "url", label: "Address for phones", state: "ok", detail: `${pub}: the QR code and passkeys use it.` });
  else add({ id: "url", label: "Address for phones", state: opts.origin?.startsWith("https://") ? "warn" : "fail", detail: pub ? `${pub} is not https: phones cannot make passkeys there.` : `DOCK_PUBLIC_URL is not set; the QR code uses this page's address (${opts.origin ?? "unknown"}).`, fix: "Set DOCK_PUBLIC_URL to the public https address, or present from the deployed site." });

  // The catalogue and the partner's live service.
  const src = rt.catalogSource;
  add(src.kind === "valio" ? { id: "catalogue", label: "Partner catalogue", state: "ok", detail: `${src.products.toLocaleString("en-US")} real products loaded.` } : { id: "catalogue", label: "Partner catalogue", state: "warn", detail: "Running on the 12-product sample catalogue, not the partner's.", fix: "Set VALIO_API_KEY and build the index (pnpm index:build), then restart." });

  try {
    const k = await resolveKitchen(rt, opts.sandboxId);
    const agent = new ShowAgent({ mandateToken: k.token, agentId: k.ref.agentId }, { kitchen: k.ref.sandboxId, share: "show-preflight" });
    const t0 = Date.now();
    const req = await agent.openRequest("Preflight: is the partner's live service answering?");
    const milk = await rt.catalog.searchProducts({ category: "milk", attributes: ["lactose_free"], limit: 1 });
    const live = await agent.availability(String(req.body.request?.requestId), milk.map((p) => p.id));
    const ms = Date.now() - t0;
    if (live.status === 200) add({ id: "partner", label: "Partner's live prices", state: ms > 4000 ? "warn" : "ok", detail: `Answered in ${(ms / 1000).toFixed(1)} s.`, ...(ms > 4000 ? { fix: "Slow: keep the recording ready (F)." } : {}) });
    else add({ id: "partner", label: "Partner's live prices", state: "fail", detail: live.body.error?.message ?? `HTTP ${live.status}`, fix: "Switch the week to its recording (F) until it answers again." });

    // The phone that must sign.
    const minutes = Math.round((Date.parse(k.ref.expiresAt) - Date.now()) / 60_000);
    if (k.ref.house) add({ id: "phone", label: "Phone that signs", state: "fail", detail: "No phone has joined: the sign-off will time out and the agent will withdraw the order.", fix: "Scan the QR code with the presenter's phone and make the passkey, then pick that kitchen (K)." });
    else if (!k.ref.passkey) add({ id: "phone", label: "Phone that signs", state: "warn", detail: `${k.ref.approverName} joined without a passkey (demo tap).`, fix: "Join again with a passkey." });
    else add({ id: "phone", label: "Phone that signs", state: minutes < 15 ? "warn" : "ok", detail: `${k.ref.approverName}'s passkey, ${k.ref.name}; the kitchen closes in ${minutes} min.`, ...(minutes < 15 ? { fix: "Join again just before going on: kitchens live 90 minutes." } : {}) });

    // Orders the agent placed alone today count together against its limit (order splitting): a second week in the
    // same kitchen within a day sends some routine orders to the person. Say so before the pitch, not during it.
    const dayAgo = Date.now() - 24 * 3600_000;
    const alone = (await rt.dock.listOrders({ orgId: k.ref.orgId })).filter((o) => o.status === "committed" && o.decision.outcome === "auto_approve" && Date.parse(o.createdAt) > dayAgo);
    if (alone.length && !k.ref.house) add({ id: "fresh", label: "A fresh kitchen", state: "warn", detail: `${k.ref.name}'s agent already placed ${alone.length} order${alone.length === 1 ? "" : "s"} alone today; the gate counts them together with the week's, so a routine order may go to the person.`, fix: "Scan the QR code again with the approver's phone for a fresh kitchen, then pick it (K)." });
    const susp = suspensions(rt.dock).find(k.ref.agentId, k.ref.orgId);
    if (susp) add({ id: "suspended", label: "Agent suspended", state: "fail", detail: `${susp.label} is suspended since the last demo.`, fix: "Press R (resume)." });
  } catch (err) {
    add({ id: "partner", label: "Partner's live prices", state: "fail", detail: err instanceof Error ? err.message : String(err), fix: "Switch to the recordings (F)." });
  }

  // Days to play the week on.
  const days = deliveryDates(new Date(), [1, 2, 3, 4, 5, 6], 5, src.kind === "seed");
  add(days.length >= 4 ? { id: "days", label: "Delivery days ahead", state: "ok", detail: `${days.length} days inside the mandate's window.` } : { id: "days", label: "Delivery days ahead", state: "warn", detail: `Only ${days.length}: some days of the week will be shown but not ordered.` });

  // The database and the other services.
  try {
    const s = await serviceHealth();
    const bad = Object.entries(s).filter(([, v]) => v === "unreachable").map(([k]) => k);
    const on = Object.entries(s).filter(([, v]) => v === "ok").map(([k]) => k);
    add(bad.length ? { id: "database", label: "Database and services", state: "warn", detail: `Unreachable: ${bad.join(", ")}.`, fix: "The show runs in memory; the Aiven platform section of the operations desk will show the gap." } : { id: "database", label: "Database and services", state: "ok", detail: on.length ? `Answering: ${on.join(", ")}.` : "In memory (no Aiven services configured)." });
  } catch (err) {
    add({ id: "database", label: "Database and services", state: "warn", detail: err instanceof Error ? err.message : String(err) });
  }

  // The model for act three.
  const models = availableModels();
  const aiven = launcherStatus();
  if (!models.length && !aiven.configured) add({ id: "model", label: "Model for the outside agent", state: "fail", detail: "No model key and no Aiven launcher configured.", fix: "Play the outside agent's recording (F)." });
  else if (opts.model && models[0]) {
    try {
      const t0 = Date.now();
      const { model } = createModel(models[0]);
      await generateText({ model, prompt: "Reply with OK.", maxOutputTokens: 5 });
      add({ id: "model", label: "Model for the outside agent", state: "ok", detail: `${models[0]} answered in ${((Date.now() - t0) / 1000).toFixed(1)} s.${aiven.configured ? " The Aiven agent is configured too." : ""}` });
    } catch (err) {
      add({ id: "model", label: "Model for the outside agent", state: "fail", detail: `${models[0]}: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`, fix: "Play the outside agent's recording (F)." });
    }
  } else add({ id: "model", label: "Model for the outside agent", state: "ok", detail: `${aiven.configured ? "Aiven agent configured; " : ""}${models.length ? `reference buyer on ${models[0]}` : ""} (not called: run preflight with the model check to call it once).` });

  // Fallbacks.
  const recs = await recordingIndex();
  for (const kind of ["week", "attacks", "outside"] as const) {
    const r = recs.find((x) => x.kind === kind);
    add(r ? { id: `rec_${kind}`, label: `Recording: ${kind}`, state: "ok", detail: `Captured ${r.capturedAt.slice(0, 16).replace("T", " ")} UTC (${r.where}).` } : { id: `rec_${kind}`, label: `Recording: ${kind}`, state: "warn", detail: "No recording to fall back to.", fix: kind === "week" ? "Play the week once in presenter mode and press C to keep it." : "Run the act once live; it is kept automatically." });
  }

  // Room for visitors and today's caps.
  const open = (await rt.sandboxes.list()).length;
  const { max } = sandboxLimits();
  add(open < max - 5 ? { id: "room", label: "Room for visitors", state: "ok", detail: `${open} of ${max} visitor kitchens open.` } : { id: "room", label: "Room for visitors", state: "warn", detail: `${open} of ${max} visitor kitchens open.`, fix: "Kitchens close after 90 minutes; raise DOCK_SANDBOX_MAX if needed." });
  const spend = showSpend(rt);
  add({ id: "caps", label: "Today's caps", state: spend.weeks.used < spend.weeks.cap && spend.modelUsd.used < spend.modelUsd.cap ? "ok" : "warn", detail: `Weeks ${spend.weeks.used} of ${spend.weeks.cap}; outside-agent runs ${spend.outsideRuns.used} of ${spend.outsideRuns.cap}; model $${spend.modelUsd.used.toFixed(2)} of $${spend.modelUsd.cap.toFixed(2)}.` });
  return out;
}

export function showSpend(rt: Runtime): Spend {
  const c = showCounts();
  const o = outsideSpend();
  return {
    day: c.day,
    weeks: { used: c.started, cap: SHOW_LIMITS.perDay },
    outsideRuns: { used: o.used, cap: OUTSIDE_LIMITS.runsPerDay },
    modelUsd: { used: o.usd, cap: OUTSIDE_LIMITS.usdPerDay },
    partnerCalls: { byShow: c.liveCalls, byDock: rt.dock.stats().liveCalls, dailyCeiling: rt.dock.liveAllowance.limits.maxCallsPerDay },
    callsPerWeek: c.finished ? Math.round((c.liveCalls / c.finished) * 10) / 10 : null,
  };
}
