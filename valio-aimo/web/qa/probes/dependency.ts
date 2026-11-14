/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: probes read untyped JSON replies. */
/**
 * When a dependency fails: the partner's API down, slow, rate-limiting, answering garbage or hostile values,
 * against a Dock whose VALIO_API_BASE points at qa/bin/fake-partner.ts (never the real partner):
 *
 *   pnpm tsx qa/bin/fake-partner.ts 4399 &
 *   VALIO_API_BASE=http://localhost:4399 qa/bin/fresh-server.sh 4315 real
 *   pnpm qa --dep-url http://localhost:4315 --fake-url http://localhost:4399 --only dependency
 *
 * Invariants: never a 5xx or a stack trace; a partner failure is reported as the partner's (retryable), not as a
 * refusal by a rule; no option, quote or order ever carries a price at or below zero, a stock figure below zero, or
 * a delivery date that is not a date; the ledger keeps verifying.
 */
import { consoleCall, Http } from "../lib/http";
import { driveIntake } from "../lib/intake";
import { kaariAgent } from "../lib/actors";
import type { Probe } from "../lib/probe";

const argOf = (name: string, envName: string) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : process.env[envName]);

const MODES = ["ok", "down", "r429", "garbage", "weird", "slow"] as const;

export const dependencyProbes: Probe[] = [
  {
    id: "dependency.partner_failures",
    area: "dependency",
    kind: "hostile",
    title: "Partner API down, 429, garbage, hostile values and 20 s slow: clear retryable errors, never a bogus price, never 5xx",
    cases: MODES.length * 2,
    findings: ["F-SLOW-PARTNER-WAIT"],
    async run({ rec, check }) {
      const depUrl = argOf("dep-url", "QA_DEP_URL");
      const fakeUrl = argOf("fake-url", "QA_FAKE_URL");
      if (!depUrl || !fakeUrl) return { skip: "needs --dep-url and --fake-url (see the file header)" };
      const http = new Http(depUrl, rec);
      for (const mode of MODES) {
        await fetch(new URL("/__mode", fakeUrl), { method: "POST", body: JSON.stringify({ mode }) });
        // A fresh agent per mode (own allowance; the client's short cache is per product and date, so vary the date).
        const a = await kaariAgent(http, { weeklyBudgetCents: 1e9, perOrderLimitCents: 1e9 });
        const deliverBy = new Date(Date.now() + (3 + MODES.indexOf(mode)) * 864e5).toISOString().slice(0, 10);
        rec.allowCodes = new Set(["live_unavailable"]);
        const t0 = Date.now();
        const t = await driveIntake((m, p, b) => (m === "GET" ? a.get(p) : a.post(p, b)), { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 40, unit: "L" }, deliverBy }, { by: "qa", onConcern: "confirm" });
        const ms = Date.now() - t0;
        const states = t.steps.map((s) => `${s.state}${s.code ? `(${s.code})` : ""}`).join(" > ");
        check.note(`${mode}: ${states} in ${ms} ms${t.final?.notes?.[0] ? ` | ${t.final.notes[0].slice(0, 140)}` : ""}`);
        for (const p of t.problems) check.expect(false, `${mode}: ${p}`);
        const cards = t.final?.options ?? [];
        for (const c of cards) for (const l of c.lines) {
          check.expect(l.unitPriceCents > 0 && Number.isFinite(l.unitPriceCents) && l.unitPriceCents < 1e9, `${mode}: card offers ${l.productId} at ${l.unitPriceCents} cents`);
          check.expect(/^\d{4}-\d{2}-\d{2}$/.test(l.deliveryDate), `${mode}: card delivery date "${l.deliveryDate}"`);
        }
        if (t.order) check.expect(t.order.lines.every((l: any) => l.unitPriceCents > 0 && l.unitPriceCents < 1e9), `${mode}: order placed at ${t.order.lines.map((l: any) => l.unitPriceCents)} cents`);
        if (mode !== "ok" && mode !== "weird") {
          const err = t.replies.find((r) => r.status >= 400)?.body?.error;
          check.expect(!err || (err.code === "live_unavailable" || /partner|wholesaler|try again/i.test(err.message)), `${mode}: error does not say it is the wholesaler's service: ${err?.code} ${err?.message?.slice(0, 120)}`);
          check.expect(ms < 15_000, `${mode}: the buyer waited ${Math.round(ms / 1000)} s before hearing the wholesaler's service is not answering`);
        }
        // the console path, as a visitor would see it
        const c = await consoleCall(http, "kaari")("POST", "/api/v1/intake", { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 30, unit: "L" }, deliverBy }, by: "visitor" });
        check.expect(c.status < 500 || c.body?.error?.code === "live_unavailable", `${mode} via console: ${c.status} ${c.body?.error?.code}`);
      }
      rec.allowCodes = new Set();
      await fetch(new URL("/__mode", fakeUrl), { method: "POST", body: JSON.stringify({ mode: "ok" }) });
      const l = await http.get("/api/v1/ledger");
      check.expect(l.body?.verification?.ok === true, "ledger does not verify after partner failures");
    },
  },
];
