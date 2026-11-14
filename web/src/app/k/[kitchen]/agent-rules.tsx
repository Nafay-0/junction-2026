"use client";

import { useEffect, useState } from "react";
import { api } from "../../_client/api";
import { useFormat, useText } from "../../_i18n/provider";
import { helsinkiToday } from "../../_ui/plain";
import { AGENT_RULES_TEXT } from "./agent-rules.text";
import { familyL } from "./family.text";
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

// The choices a habit or rule can be about, as the intake asks them (labels for the buyer): `AGENT_RULES_TEXT.dimensions`.

export function AgentRules() {
  const { kitchen, overview } = usePortal();
  const tx = useText(AGENT_RULES_TEXT);
  const f = useFormat();
  const w = mandateWords(kitchen.mandate, f.lang);
  const memory = overview.data?.memory;
  return (
    <div className="mt-5 space-y-8">
      <header>
        <h1 className="display text-[2.6rem] text-ink sm:text-[3rem]">{tx.title}</h1>
        <p className="mt-1 max-w-[70ch] text-[1.02rem] leading-snug text-ink-soft">
          {tx.intro(kitchen.agentName, kitchen.name, f.day(helsinkiToday(new Date(kitchen.mandate.validUntil))))}
        </p>
      </header>

      <section aria-labelledby="may" className="grid gap-4 lg:grid-cols-3">
        <h2 id="may" className="sr-only">
          {tx.mayHidden}
        </h2>
        <RuleList title={tx.alone} items={w.alone} />
        <RuleList title={tx.person} items={w.person} tone="safety" extra={kitchen.mandate.approvers.map((a) => approverLine(a, f.lang))} />
        <RuleList title={tx.never} items={w.never} />
      </section>

      <WhoSees />
      <MemoryBook fallback={<Memory memory={memory} loading={!memory && !overview.error} error={overview.error} />} />
      <Connect />
    </div>
  );
}

function RuleList({ title, items, tone, extra }: { title: string; items: string[]; tone?: "safety"; extra?: string[] }) {
  const tx = useText(AGENT_RULES_TEXT);
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
            <h4 className="mt-3 font-semibold">{tx.who}</h4>
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
  const tx = useText(AGENT_RULES_TEXT);
  const f = useFormat();
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
          {tx.knows}
        </h2>
        <p className="max-w-[72ch] text-ink-soft">{tx.knowsIntro}</p>
      </div>
      {loading && <div className="h-48 animate-pulse bg-concrete-deep/60" />}
      {error && !memory && <ErrorPlate title={tx.memoryFailed} message={error} onRetry={overview.refresh} />}
      {problem && <ErrorPlate title={tx.changeFailed} message={problem} />}
      {memory && (
        <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Paper>
            <div className="p-4">
              <h3 className="display text-[1.5rem]">{tx.stated}</h3>
              <p className="text-[0.92rem] text-ink-soft">{tx.statedNote}</p>
              {memory.stated.length === 0 && <p className="mt-2 text-ink-soft">{tx.statedNone}</p>}
              <ul className="mt-2 divide-y divide-line">
                {memory.stated.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold">{s.text}</p>
                      <p className="text-[0.85rem]">{tx.statedShared}</p>
                      <p className="text-[0.9rem] text-ink-soft">
                        {tx.statedBy(s.statedBy, f.day(helsinkiToday(new Date(s.statedAt))))}
                        {s.family ? tx.forFamily(familyL(s.family, f.lang)) : tx.forAll}
                        {s.requestId ? tx.whileAnswering : ""}
                      </p>
                    </div>
                    <Button kind="secondary" busy={busy === s.id} disabled={!!busy} onClick={() => void change(s.id, { action: "forget", preferenceId: s.id })}>
                      {tx.forgetRule}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </Paper>
          <Paper>
            <div className="p-4">
              <h3 className="display text-[1.5rem]">{tx.habits}</h3>
              <p className="text-[0.92rem] text-ink-soft">{tx.habitsNote}</p>
              {memory.families.length === 0 && <p className="mt-2 text-ink-soft">{tx.habitsNone}</p>}
              {memory.families.map((fam) => (
                <div key={fam.family} className="mt-3 border-t border-line pt-2">
                  <p className="font-semibold capitalize">
                    {familyL(fam.family, f.lang)} <span className="font-normal normal-case text-ink-soft">{tx.familyOrders(fam.usual.text, fam.orders)}</span>
                  </p>
                  <ul className="mt-1 space-y-2">
                    {fam.learned.map((l) => {
                      const dim = l.kind === "dimension" ? tx.dimensions[l.dimension] : undefined;
                      return (
                        <li key={l.text} className="leading-snug">
                          <p>{l.text}</p>
                          <p className="text-[0.85rem] text-ink-soft">{tx.fromOrders(`${l.evidence.orderIds.slice(-3).map((id) => id.replace(/^ord_/, "")).join(", ")}${l.evidence.orderIds.length > 3 ? "…" : ""}`)}</p>
                          {dim && l.kind === "dimension" && (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <Button kind="secondary" className="min-h-9 px-2.5 text-[0.9rem]" busy={busy === `${fam.family}:${l.dimension}:${l.choice}`} disabled={!!busy} onClick={() => void change(`${fam.family}:${l.dimension}:${l.choice}`, { action: "rule", family: fam.family, dimension: l.dimension, choice: l.choice })}>
                                {tx.makeRule}
                              </Button>
                              {dim.options
                                .filter((o) => o.id !== l.choice)
                                .map((o) => (
                                  <Button key={o.id} kind="quiet" className="min-h-9 px-1.5 text-[0.9rem]" disabled={!!busy} onClick={() => void change(`${fam.family}:${l.dimension}:${o.id}`, { action: "rule", family: fam.family, dimension: l.dimension, choice: o.id })}>
                                    {tx.ruleOption(o.label)}
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
              <p className="mt-3 text-[0.85rem] leading-snug text-ink-soft">{tx.habitNote}</p>
            </div>
          </Paper>
        </div>
      )}
      {memory && (
        <p className="text-[0.95rem] text-ink-soft">
          {tx.footer(weekdaysText(memory.deliveryWeekdays, f.lang), kitchen.by)}
        </p>
      )}
    </section>
  );
}

/** Plainly, at the top: who can see what. */
function WhoSees() {
  const { kitchen } = usePortal();
  const tx = useText(AGENT_RULES_TEXT);
  return (
    <section aria-labelledby="who-sees" className="bg-paper p-5">
      <h2 id="who-sees" className="display text-[1.6rem]">
        {tx.whoSees}
      </h2>
      <ul className="mt-1 space-y-1 leading-snug">
        <li>
          <strong>{kitchen.name}</strong>
          {tx.seesKitchen}
        </li>
        <li>
          <strong>{tx.seesStaff}</strong>
          {tx.seesStaffA}
          <em>{tx.shared}</em>
          {tx.seesStaffB}
          <em>{tx.private}</em>
          {tx.seesStaffC}
        </li>
        <li>
          <strong>{tx.nobody}</strong>
          {tx.nobodyRest}
        </li>
      </ul>
    </section>
  );
}

type Connector = { url?: string; address?: string; steps?: string[]; [k: string]: unknown };

function Connect() {
  const { ui, kitchen } = usePortal();
  const tx = useText(AGENT_RULES_TEXT);
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
    ? JSON.stringify({ mcpServers: { aimopilot: { type: "http", url: c.mcpUrl, headers: { Authorization: "Bearer ${DOCK_MANDATE}", "Dock-Agent-Id": c.agentId } } } }, null, 2)
    : "";
  const cli = c ? `claude mcp add --transport http aimopilot ${c.mcpUrl} \\\n  --header "Authorization: Bearer $DOCK_MANDATE" \\\n  --header "Dock-Agent-Id: ${c.agentId}"` : "";
  return (
    <section aria-labelledby="connect" className="space-y-3">
      <div>
        <h2 id="connect" className="display text-[1.9rem]">
          {tx.connect}
        </h2>
        <p className="max-w-[72ch] text-ink-soft">{tx.connectIntro}</p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Paper>
          <div className="space-y-3 p-4">
            {!c ? (
              <div className="h-32 animate-pulse bg-mist" />
            ) : (
              <>
                <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-[0.95rem]">
                  <dt className="text-ink-soft">{tx.mcpAddress}</dt>
                  <dd className="break-all font-mono text-[0.85rem]">{c.mcpUrl}</dd>
                  <dt className="text-ink-soft">{tx.rest}</dt>
                  <dd className="break-all font-mono text-[0.85rem]">{c.openApiUrl}</dd>
                  <dt className="text-ink-soft">{tx.keys}</dt>
                  <dd className="break-all font-mono text-[0.85rem]">{c.jwksUrl}</dd>
                  <dt className="text-ink-soft">{tx.agentId}</dt>
                  <dd className="font-mono text-[0.85rem]">{c.agentId}</dd>
                </dl>
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{tx.mcpJson}</h3>
                    <Button kind="quiet" onClick={() => void copy("json", mcpJson)}>
                      {copied === "json" ? tx.copied : tx.copy}
                    </Button>
                  </div>
                  <pre className="mt-1 overflow-x-auto bg-mist p-3 font-mono text-[0.8rem] leading-snug">{mcpJson}</pre>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{tx.oneCommand}</h3>
                    <Button kind="quiet" onClick={() => void copy("cli", cli)}>
                      {copied === "cli" ? tx.copied : tx.copy}
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
            <h3 className="display text-[1.5rem]">{tx.mandateTitle}</h3>
            <p className="text-[0.95rem] leading-snug">
              <code className="font-mono">DOCK_MANDATE</code>
              {tx.mandateIs(kitchen.name)}
              {tx.mandateHead(kitchen.mandate.approvers[0]?.name)}
            </p>
            {c && (
              <>
                <Button kind="secondary" onClick={() => setShow((x) => !x)}>
                  {show ? tx.hide : tx.show}
                </Button>
                {show && (
                  <div>
                    <pre className="max-h-40 overflow-auto break-all whitespace-pre-wrap bg-mist p-3 font-mono text-[0.72rem]">{c.mandate}</pre>
                    <Button kind="quiet" onClick={() => void copy("mandate", c.mandate)}>
                      {copied === "mandate" ? tx.copied : tx.copyMandate}
                    </Button>
                    <p className="text-[0.85rem] text-ink-soft">{tx.demoNote}</p>
                  </div>
                )}
              </>
            )}
            <div className="border-t border-line pt-3">
              <h3 className="font-semibold">{tx.assistant}</h3>
              {connector === undefined ? (
                <p className="text-ink-soft">{tx.checking}</p>
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
                  {tx.noConnector}
                </p>
              )}
            </div>
          </div>
        </Paper>
      </div>
    </section>
  );
}
