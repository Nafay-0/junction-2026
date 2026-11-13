"use client";

import { useEffect, useState } from "react";
import { api } from "../../_client/api";
import { attr, day, helsinkiToday } from "../../_ui/plain";
import { usePortal, weekdaysText } from "./portal";
import { MemoryBook } from "./memory-book";
import { approverLine, mandateWords } from "./rules";
import { Button, ErrorPlate, Paper } from "./ui";
import type { ConnectReply, KitchenMemory } from "./types";

/**
 * Agent and rules, the transparency page: the kitchen's signed mandate in plain words, the approvers, everything
 * the agent has learned or been told about the kitchen (with where it came from, and a way to correct or forget
 * it), and how to connect another agent to the same gate.
 */

// The choices a habit or rule can be about, as the intake asks them (labels for the buyer).
const DIMENSIONS: Record<string, { label: string; options: { id: string; label: string }[] }> = {
  lactose: { label: "Lactose", options: [{ id: "lactose_free", label: "Lactose-free" }, { id: "none", label: "Regular (contains lactose)" }, { id: "no_preference", label: "No preference" }] },
  fat: { label: "Fat content", options: [{ id: "fat_free", label: "Fat-free" }, { id: "fat_1_5", label: "Semi-skimmed 1.5 %" }, { id: "fat_3_5", label: "Whole 3.5 %" }, { id: "no_preference", label: "No preference" }] },
  organic: { label: "Organic", options: [{ id: "organic", label: "Organic" }, { id: "none", label: "Not organic" }, { id: "no_preference", label: "No preference" }] },
};

export function AgentRules() {
  const { kitchen, overview } = usePortal();
  const w = mandateWords(kitchen.mandate);
  const memory = overview.data?.memory;
  return (
    <div className="mt-5 space-y-8">
      <header>
        <h1 className="display text-[2.6rem] text-ink sm:text-[3rem]">Agent and rules</h1>
        <p className="mt-1 max-w-[70ch] text-[1.02rem] leading-snug text-ink-soft">
          What {kitchen.agentName} may do for {kitchen.name}, who signs off the rest, and everything it knows about the kitchen. The rules below are read from the mandate the kitchen signed, valid until {day(helsinkiToday(new Date(kitchen.mandate.validUntil)))}; the gate checks every order against exactly these.
        </p>
      </header>

      <section aria-labelledby="may" className="grid gap-4 lg:grid-cols-3">
        <h2 id="may" className="sr-only">
          What the agent may do
        </h2>
        <RuleList title="The agent may, alone" items={w.alone} />
        <RuleList title="A person signs off" items={w.person} tone="safety" extra={kitchen.mandate.approvers.map(approverLine)} />
        <RuleList title="Never, whoever asks" items={w.never} />
      </section>

      <WhoSees />
      <MemoryBook fallback={<Memory memory={memory} loading={!memory && !overview.error} error={overview.error} />} />
      <Connect />
    </div>
  );
}

function RuleList({ title, items, tone, extra }: { title: string; items: string[]; tone?: "safety"; extra?: string[] }) {
  return (
    <Paper safety={tone === "safety"}>
      <div className="p-4">
        <h3 className="display text-[1.6rem]">{title}</h3>
        <ul className="mt-2 space-y-1.5 leading-snug">
          {items.map((t) => (
            <li key={t} className="grid grid-cols-[1.1rem_1fr]">
              <span aria-hidden className="mt-[0.5em] size-1.5 bg-petrol" />
              {t}
            </li>
          ))}
        </ul>
        {extra && extra.length > 0 && (
          <>
            <h4 className="mt-3 font-semibold">Who</h4>
            <ul className="mt-1 space-y-1">
              {extra.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Paper>
  );
}

function Memory({ memory, loading, error }: { memory?: KitchenMemory; loading: boolean; error?: string }) {
  const { ui, overview, kitchen } = usePortal();
  const [busy, setBusy] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const change = async (key: string, body: Record<string, string>) => {
    setBusy(key);
    setProblem(undefined);
    const r = await ui("POST", "memory", body);
    setBusy(undefined);
    if (!r.ok) setProblem(r.error.message);
    overview.refresh();
  };
  return (
    <section aria-labelledby="knows" className="space-y-3">
      <div>
        <h2 id="knows" className="display text-[1.9rem]">
          What the agent knows about this kitchen
        </h2>
        <p className="max-w-[72ch] text-ink-soft">Two kinds, kept apart: a rule a person stated always constrains what the agent may offer; a habit it learned from orders only pre-selects an answer, which the buyer sees and can change.</p>
      </div>
      {loading && <div className="h-48 animate-pulse bg-concrete-deep/60" />}
      {error && !memory && <ErrorPlate title="The kitchen's memory did not load" message={error} onRetry={overview.refresh} />}
      {problem && <ErrorPlate title="That change did not go through" message={problem} />}
      {memory && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Paper>
            <div className="p-4">
              <h3 className="display text-[1.5rem]">Rules a person stated</h3>
              <p className="text-[0.92rem] text-ink-soft">Always applied. Products against a rule are not offered at all.</p>
              {memory.stated.length === 0 && <p className="mt-2 text-ink-soft">None yet. Ticking “remember this answer” on a question adds one.</p>}
              <ul className="mt-2 divide-y divide-line">
                {memory.stated.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold">{s.text}</p>
                      <p className="text-[0.85rem]">Shared with the wholesaler&apos;s staff: the gate applies it, so it shows in the audit trail.</p>
                      <p className="text-[0.9rem] text-ink-soft">
                        Stated by {s.statedBy}, {day(helsinkiToday(new Date(s.statedAt)))}
                        {s.family ? `, for ${attr(s.family)}` : ", for everything"}
                        {s.requestId ? ", while answering a question on an order" : ""}
                      </p>
                    </div>
                    <Button kind="secondary" busy={busy === s.id} disabled={!!busy} onClick={() => void change(s.id, { action: "forget", preferenceId: s.id })}>
                      Forget this rule
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </Paper>
          <Paper>
            <div className="p-4">
              <h3 className="display text-[1.5rem]">Habits learned from orders</h3>
              <p className="text-[0.92rem] text-ink-soft">Pre-select only. Learned after at least three orders, when most of them agree.</p>
              {memory.families.length === 0 && <p className="mt-2 text-ink-soft">Nothing learned yet: the kitchen has no order history here.</p>}
              {memory.families.map((f) => (
                <div key={f.family} className="mt-3 border-t border-line pt-2">
                  <p className="font-semibold capitalize">
                    {attr(f.family)} <span className="font-normal normal-case text-ink-soft">{f.usual.text}, {f.orders} orders</span>
                  </p>
                  <ul className="mt-1 space-y-2">
                    {f.learned.map((l) => {
                      const dim = l.kind === "dimension" ? DIMENSIONS[l.dimension] : undefined;
                      return (
                        <li key={l.text} className="leading-snug">
                          <p>{l.text}</p>
                          <p className="text-[0.85rem] text-ink-soft">From orders {l.evidence.orderIds.slice(-3).map((id) => id.replace(/^ord_/, "")).join(", ")}{l.evidence.orderIds.length > 3 ? "…" : ""}</p>
                          {dim && l.kind === "dimension" && (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <Button kind="secondary" className="min-h-9 px-2.5 text-[0.9rem]" busy={busy === `${f.family}:${l.dimension}:${l.choice}`} disabled={!!busy} onClick={() => void change(`${f.family}:${l.dimension}:${l.choice}`, { action: "rule", family: f.family, dimension: l.dimension, choice: l.choice })}>
                                Make it a rule
                              </Button>
                              {dim.options
                                .filter((o) => o.id !== l.choice)
                                .map((o) => (
                                  <Button key={o.id} kind="quiet" className="min-h-9 px-1.5 text-[0.9rem]" disabled={!!busy} onClick={() => void change(`${f.family}:${l.dimension}:${o.id}`, { action: "rule", family: f.family, dimension: l.dimension, choice: o.id })}>
                                    Rule: {o.label}
                                  </Button>
                                ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              <p className="mt-3 text-[0.85rem] leading-snug text-ink-soft">A habit cannot be erased without erasing the orders it was learned from; state a rule to override it.</p>
            </div>
          </Paper>
        </div>
      )}
      {memory && (
        <p className="text-[0.95rem] text-ink-soft">
          Deliveries {weekdaysText(memory.deliveryWeekdays)}. Every change here is written to the ledger as made by {kitchen.by}.
        </p>
      )}
    </section>
  );
}

/** Plainly, at the top: who can see what. */
function WhoSees() {
  const { kitchen } = usePortal();
  return (
    <section aria-labelledby="who-sees" className="bg-paper p-5">
      <h2 id="who-sees" className="display text-[1.6rem]">
        Who can see what
      </h2>
      <ul className="mt-1 space-y-1 leading-snug">
        <li>
          <strong>{kitchen.name}</strong> sees everything on these pages: its orders, the agent&apos;s steps, and all it remembers.
        </li>
        <li>
          <strong>The wholesaler&apos;s staff</strong> see the orders, the agent&apos;s steps and the rules the gate applied, in the same audit trail. Memory items marked <em>shared</em> help them serve the kitchen; items marked <em>private</em> stay with the kitchen&apos;s agent.
        </li>
        <li>
          <strong>Nobody else.</strong> Another kitchen never sees these, and an outside agent sees only what its mandate lets it ask for.
        </li>
      </ul>
    </section>
  );
}

type Connector = { url?: string; address?: string; steps?: string[]; [k: string]: unknown };

function Connect() {
  const { ui, kitchen } = usePortal();
  const [c, setC] = useState<ConnectReply>();
  const [connector, setConnector] = useState<Connector | null>();
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<string>();
  useEffect(() => {
    void ui<ConnectReply>("GET", "connect").then((r) => r.ok && setC(r.data));
    // Per-kitchen connector addresses for consumer assistants, when that service is deployed.
    void api<Connector>("GET", `/ui-api/connect/${encodeURIComponent(kitchen.slug)}`).then((r) => setConnector(r.ok ? r.data : null));
  }, [ui, kitchen.slug]);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(undefined), 1500);
    } catch {
      setCopied(undefined);
    }
  };
  const mcpJson = c
    ? JSON.stringify({ mcpServers: { dock: { type: "http", url: c.mcpUrl, headers: { Authorization: "Bearer ${DOCK_MANDATE}", "Dock-Agent-Id": c.agentId } } } }, null, 2)
    : "";
  const cli = c ? `claude mcp add --transport http dock ${c.mcpUrl} \\\n  --header "Authorization: Bearer $DOCK_MANDATE" \\\n  --header "Dock-Agent-Id: ${c.agentId}"` : "";
  return (
    <section aria-labelledby="connect" className="space-y-3">
      <div>
        <h2 id="connect" className="display text-[1.9rem]">
          Connect your own agent
        </h2>
        <p className="max-w-[72ch] text-ink-soft">
          The agent in this shop is one client of an open interface. Any agent the kitchen trusts can order the same way, with the same mandate, and meets the same gate: the same limits, the same mistake checks, the same sign-off by a person.
        </p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Paper>
          <div className="space-y-3 p-4">
            {!c ? (
              <div className="h-32 animate-pulse bg-mist" />
            ) : (
              <>
                <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-[0.95rem]">
                  <dt className="text-ink-soft">MCP address</dt>
                  <dd className="break-all font-mono text-[0.85rem]">{c.mcpUrl}</dd>
                  <dt className="text-ink-soft">REST (OpenAPI)</dt>
                  <dd className="break-all font-mono text-[0.85rem]">{c.openApiUrl}</dd>
                  <dt className="text-ink-soft">Wholesaler keys</dt>
                  <dd className="break-all font-mono text-[0.85rem]">{c.jwksUrl}</dd>
                  <dt className="text-ink-soft">Agent id</dt>
                  <dd className="font-mono text-[0.85rem]">{c.agentId}</dd>
                </dl>
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Claude Code, or any MCP client (.mcp.json)</h3>
                    <Button kind="quiet" onClick={() => void copy("json", mcpJson)}>
                      {copied === "json" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <pre className="mt-1 overflow-x-auto bg-mist p-3 font-mono text-[0.8rem] leading-snug">{mcpJson}</pre>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Or in one command</h3>
                    <Button kind="quiet" onClick={() => void copy("cli", cli)}>
                      {copied === "cli" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <pre className="mt-1 overflow-x-auto bg-mist p-3 font-mono text-[0.8rem] leading-snug">{cli}</pre>
                </div>
              </>
            )}
          </div>
        </Paper>
        <Paper>
          <div className="space-y-3 p-4">
            <h3 className="display text-[1.5rem]">The kitchen&apos;s mandate</h3>
            <p className="text-[0.95rem] leading-snug">
              <code className="font-mono">DOCK_MANDATE</code> is the mandate {kitchen.name} signed for its agent: a JWT signed with the kitchen&apos;s own key. Whoever holds it can ask for anything within it; nothing beyond it, and nothing over {kitchen.mandate.approvers[0]?.name ?? "the approver"}&apos;s head.
            </p>
            {c && (
              <>
                <Button kind="secondary" onClick={() => setShow((x) => !x)}>
                  {show ? "Hide the mandate" : "Show this kitchen's mandate"}
                </Button>
                {show && (
                  <div>
                    <pre className="max-h-40 overflow-auto break-all whitespace-pre-wrap bg-mist p-3 font-mono text-[0.72rem]">{c.mandate}</pre>
                    <Button kind="quiet" onClick={() => void copy("mandate", c.mandate)}>
                      {copied === "mandate" ? "Copied" : "Copy the mandate"}
                    </Button>
                    <p className="text-[0.85rem] text-ink-soft">Demo kitchen: shown to anyone with this page. A real shop shows it only to the kitchen&apos;s administrator.</p>
                  </div>
                )}
              </>
            )}
            <div className="border-t border-line pt-3">
              <h3 className="font-semibold">For a personal assistant</h3>
              {connector === undefined ? (
                <p className="text-ink-soft">Checking for a connector address…</p>
              ) : connector ? (
                <div className="text-[0.95rem]">
                  {(connector.address ?? connector.url) && <p className="break-all font-mono text-[0.85rem]">{String(connector.address ?? connector.url)}</p>}
                  {Array.isArray(connector.steps) && (
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                      {connector.steps.map((s) => (
                        <li key={String(s)}>{String(s)}</li>
                      ))}
                    </ol>
                  )}
                </div>
              ) : (
                <p className="text-[0.95rem] text-ink-soft">
                  A per-kitchen connector address for consumer assistants (with setup steps, revoke and reissue) is being added; until then, use the MCP address and mandate above.
                </p>
              )}
            </div>
          </div>
        </Paper>
      </div>
    </section>
  );
}
