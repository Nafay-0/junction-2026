"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Ban, Check, ChefHat, ChevronDown, Copy, Eye, EyeOff, KeyRound, Lock, PenLine, Warehouse, X } from "lucide-react";
import { api } from "../../_client/api";
import { useFormat, useText } from "../../_i18n/provider";
import { helsinkiToday, moneyShort } from "../../_ui/plain";
import { roleLabelL } from "../../_i18n/format";
import { Avatar, Button, Card, ErrorPlate, FactList, IconButton, IconDisc, PageHeader, Panel, SectionTitle, Skeleton, Tag } from "../../_ui/kit";
import { Target } from "../../_ui/target";
import { AGENT_RULES_TEXT } from "./agent-rules.text";
import { familyL } from "./family.text";
import { usePortal, weekdaysText } from "./portal";
import { MemoryBook } from "./memory-book";
import { MailPanel } from "./mail-panel";
import { StartOver } from "./start-over";
import { ACCOUNT_TEXT } from "./account.text";
import { DevicePanel, MandateForm } from "../_account/forms";
import { mandateWords } from "./rules";
import type { ConnectReply, KitchenMemory } from "./types";
import type { ConnectorSetup } from "@/server/mcp/connector-setup";

/**
 * Agent and rules, the transparency page: the kitchen's signed mandate in plain words, the approvers, everything
 * the agent has learned or been told about the kitchen (with where it came from, and a way to correct or forget
 * it), and how to connect another agent to the same gate.
 */

// The choices a habit or rule can be about, as the intake asks them (labels for the buyer): `AGENT_RULES_TEXT.dimensions`.

export function AgentRules() {
  const { kitchen, overview, account } = usePortal();
  const own = !!account && account.kitchen === kitchen.slug;
  const tx = useText(AGENT_RULES_TEXT);
  const f = useFormat();
  const m = kitchen.mandate;
  const w = mandateWords(m, f.lang);
  const memory = overview.data?.memory;
  const until = f.day(helsinkiToday(new Date(m.validUntil)));
  return (
    <div className="mt-6 space-y-10 sm:mt-8 sm:space-y-12">
      <PageHeader title={tx.title} lead={tx.intro(kitchen.agentName, kitchen.name, until)} />

      <section aria-labelledby="may" className="space-y-4">
        <h2 id="may" className="sr-only">
          {tx.mayHidden}
        </h2>
        {/* The mandate's limits at a glance: the figures the gate checks every order against. */}
        <Panel className="grid grid-cols-2 gap-x-4 gap-y-5 p-5 sm:p-6 md:grid-cols-4">
          <Figure label={tx.figAlone} value={moneyShort(m.perOrderLimitCents)} strong />
          <Figure label={tx.figWeek} value={moneyShort(m.weeklyBudgetCents)} />
          <Figure label={tx.figLead} value={tx.figLeadValue(m.maxLeadDays)} />
          <Figure label={tx.figValid} value={until} />
        </Panel>
        <Card className="grid divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <RuleList title={tx.alone} items={w.alone} mark="alone" />
          <RuleList title={tx.person} items={w.person} mark="person">
            {m.approvers.length > 0 && (
              <>
                <h4 className="mt-5 text-[0.86rem] font-medium text-ink-soft">{tx.who}</h4>
                <ul className="mt-2 space-y-3">
                  {m.approvers.map((a) => (
                    <li key={`${a.name}-${a.role}`} className="flex items-center gap-3">
                      <Avatar name={a.name} size={38} />
                      <span className="min-w-0">
                        <span className="block font-semibold leading-snug">{a.name}</span>
                        <span className="block text-[0.88rem] leading-snug text-ink-soft">{tx.signsUpTo(roleLabelL(a.role, f.lang), moneyShort(a.maxApprovalCents))}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </RuleList>
          <RuleList title={tx.never} items={w.never} mark="never" />
        </Card>
      </section>

      {own && <DevicePanel />}
      {own && <ChangeMandate />}
      <MailPanel own={own} />
      <WhoSees />
      <MemoryBook fallback={<Memory memory={memory} loading={!memory && !overview.error} error={overview.error} />} />
      <Connect />
      {own && account?.demo && <StartOver sample={account.start === "sample"} />}
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <p className="text-[0.84rem] leading-snug text-ink-soft hyphens-manual">{label}</p>
      <p className={`display mt-auto break-words pt-1 tabular ${strong ? "text-[1.9rem] text-petrol-deep sm:text-[2.2rem]" : "text-[1.45rem] text-ink sm:text-[1.7rem]"}`}>{value}</p>
    </div>
  );
}

/** Only the kitchen's own signed-in account sees this: a new mandate, signed with the key held for it; the old one retires. */
function ChangeMandate() {
  const atx = useText(ACCOUNT_TEXT);
  const [open, setOpen] = useState(false);
  const [signed, setSigned] = useState(false);
  return (
    <section aria-labelledby="change-mandate">
      <Card pad>
        <h2 id="change-mandate" className="flex items-center gap-3">
          <IconDisc size={40}>
            <PenLine size={19} />
          </IconDisc>
          <span className="display text-[1.4rem] leading-tight">{atx.mandateTitle}</span>
        </h2>
        <p className="mt-3 max-w-[68ch] leading-relaxed text-ink-soft">{atx.mandateIntro}</p>
        {signed && (
          <Panel tone="good" className="mt-4 flex items-center gap-2 px-4 py-3 text-good">
            <Check aria-hidden size={17} strokeWidth={2.5} />
            <p role="status">{atx.mandateSigned}</p>
          </Panel>
        )}
        <div className="mt-5">
          {open ? (
            <MandateForm
              change
              onSigned={() => {
                setSigned(true);
                setOpen(false);
                window.location.reload(); // the store shows the new mandate everywhere
              }}
            />
          ) : (
            <Button kind="secondary" onClick={() => setOpen(true)}>
              {atx.mandateChange}
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}

const MARK = {
  alone: { icon: <Check size={19} strokeWidth={2.5} />, disc: "bg-good-soft text-good", bullet: <Check aria-hidden size={15} strokeWidth={2.6} className="text-good" /> },
  person: { icon: <Target size={20} tone="safety" />, disc: "bg-safety-soft", bullet: <span aria-hidden className="block size-1.5 rounded-full bg-safety-ink/70" /> },
  never: { icon: <Ban size={18} strokeWidth={2.2} />, disc: "bg-surface text-ink-soft", bullet: <X aria-hidden size={14} strokeWidth={2.6} className="text-ink-soft" /> },
} as const;

/** One line of the mandate in words. A very long one (a kitchen allowed hundreds of categories) folds to three lines. */
function RuleItem({ text, bullet }: { text: string; bullet: ReactNode }) {
  const tx = useText(AGENT_RULES_TEXT);
  const [open, setOpen] = useState(false);
  const long = text.length > 180;
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1.5">
      <span className="flex h-[1.375em] items-center">{bullet}</span>
      <span className="min-w-0">
        <span className={`break-words ${long && !open ? "line-clamp-3" : "block"}`}>{text}</span>
        {long && (
          <Button kind="quiet" className="text-[0.9rem]" onClick={() => setOpen((x) => !x)}>
            {open ? tx.showLess : tx.showAll}
          </Button>
        )}
      </span>
    </li>
  );
}

function RuleList({ title, items, mark, children }: { title: string; items: string[]; mark: keyof typeof MARK; children?: ReactNode }) {
  const k = MARK[mark];
  return (
    <div className="min-w-0 p-5 sm:p-6">
      <h3 className="flex items-center gap-3">
        <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full ${k.disc}`}>
          {k.icon}
        </span>
        <span className="display text-[1.3rem] leading-tight text-ink">{title}</span>
      </h3>
      <ul className="mt-4 space-y-2.5 leading-snug">
        {items.map((t) => (
          <RuleItem key={t} text={t} bullet={k.bullet} />
        ))}
      </ul>
      {children}
    </div>
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
    <section aria-labelledby="knows">
      <SectionTitle id="knows">{tx.knows}</SectionTitle>
      <p className="-mt-2 mb-5 max-w-[68ch] leading-relaxed text-ink-soft">{tx.knowsIntro}</p>
      {loading && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48 !rounded-[20px]" />
          <Skeleton className="h-48 !rounded-[20px]" />
        </div>
      )}
      {error && !memory && <ErrorPlate title={tx.memoryFailed} message={error} onRetry={overview.refresh} />}
      {problem && <ErrorPlate title={tx.changeFailed} message={problem} />}
      {memory && (
        <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <div className="px-5 pb-3 pt-5 sm:px-6">
              <h3 className="display text-[1.3rem]">{tx.stated}</h3>
              <p className="mt-0.5 text-[0.92rem] text-ink-soft">{tx.statedNote}</p>
            </div>
            {memory.stated.length === 0 && <p className="px-5 pb-5 text-ink-soft sm:px-6">{tx.statedNone}</p>}
            <ul className="divide-y divide-line border-t border-line">
              {memory.stated.map((s) => (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 sm:px-6">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-semibold">{s.text}</p>
                    <p className="mt-0.5 text-[0.9rem] leading-snug text-ink-soft">
                      {tx.statedBy(s.statedBy, f.day(helsinkiToday(new Date(s.statedAt))))}
                      {s.family ? tx.forFamily(familyL(s.family, f.lang)) : tx.forAll}
                      {s.requestId ? tx.whileAnswering : ""}
                    </p>
                    <p className="mt-1 text-[0.85rem] text-ink-soft">{tx.statedShared}</p>
                  </div>
                  <Button kind="secondary" size="sm" busy={busy === s.id} disabled={!!busy} onClick={() => void change(s.id, { action: "forget", preferenceId: s.id })}>
                    {tx.forgetRule}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <div className="px-5 pb-3 pt-5 sm:px-6">
              <h3 className="display text-[1.3rem]">{tx.habits}</h3>
              <p className="mt-0.5 text-[0.92rem] text-ink-soft">{tx.habitsNote}</p>
            </div>
            {memory.families.length === 0 && <p className="px-5 pb-5 text-ink-soft sm:px-6">{tx.habitsNone}</p>}
            <ul className="divide-y divide-line border-t border-line">
              {memory.families.map((fam) => (
                <li key={fam.family} className="px-5 py-4 sm:px-6">
                  <p className="font-semibold capitalize">
                    {familyL(fam.family, f.lang)} <span className="font-normal normal-case text-ink-soft">{tx.familyOrders(fam.usual.text, fam.orders)}</span>
                  </p>
                  <ul className="mt-2 space-y-3">
                    {fam.learned.map((l) => {
                      const dim = l.kind === "dimension" ? tx.dimensions[l.dimension] : undefined;
                      return (
                        <li key={l.text} className="leading-snug">
                          <p>{l.text}</p>
                          <p className="mt-0.5 text-[0.85rem] text-ink-soft">{tx.fromOrders(`${l.evidence.orderIds.slice(-3).map((id) => id.replace(/^ord_/, "")).join(", ")}${l.evidence.orderIds.length > 3 ? "…" : ""}`)}</p>
                          {dim && l.kind === "dimension" && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                              <Button kind="secondary" size="sm" busy={busy === `${fam.family}:${l.dimension}:${l.choice}`} disabled={!!busy} onClick={() => void change(`${fam.family}:${l.dimension}:${l.choice}`, { action: "rule", family: fam.family, dimension: l.dimension, choice: l.choice })}>
                                {tx.makeRule}
                              </Button>
                              {dim.options
                                .filter((o) => o.id !== l.choice)
                                .map((o) => (
                                  <Button key={o.id} kind="quiet" className="text-[0.9rem]" disabled={!!busy} onClick={() => void change(`${fam.family}:${l.dimension}:${o.id}`, { action: "rule", family: fam.family, dimension: l.dimension, choice: o.id })}>
                                    {tx.ruleOption(o.label)}
                                  </Button>
                                ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
            <p className="border-t border-line bg-mist/60 px-5 py-3.5 text-[0.85rem] leading-snug text-ink-soft sm:px-6">{tx.habitNote}</p>
          </Card>
        </div>
      )}
      {memory && <p className="mt-4 text-[0.9rem] text-ink-soft">{tx.footer(weekdaysText(memory.deliveryWeekdays, f.lang), kitchen.by)}</p>}
    </section>
  );
}

/** Plainly, near the top: who can see what. */
function WhoSees() {
  const { kitchen } = usePortal();
  const tx = useText(AGENT_RULES_TEXT);
  const row = "flex items-start gap-4 px-5 py-4 sm:px-6";
  return (
    <section aria-labelledby="who-sees">
      <SectionTitle id="who-sees">{tx.whoSees}</SectionTitle>
      <Card>
        <ul className="divide-y divide-line leading-normal">
          <li className={row}>
            <IconDisc size={38}>
              <ChefHat size={19} />
            </IconDisc>
            <p className="min-w-0 pt-1.5">
              <strong className="font-semibold">{kitchen.name}</strong>
              {tx.seesKitchen}
            </p>
          </li>
          <li className={row}>
            <IconDisc size={38} tone="muted">
              <Warehouse size={19} />
            </IconDisc>
            <p className="min-w-0 pt-1.5">
              <strong className="font-semibold">{tx.seesStaff}</strong>
              {tx.seesStaffA}
              <Tag tone="muted">{tx.shared}</Tag>
              {tx.seesStaffB}
              <Tag tone="muted">{tx.private}</Tag>
              {tx.seesStaffC}
            </p>
          </li>
          <li className={row}>
            <IconDisc size={38} tone="muted">
              <Lock size={18} />
            </IconDisc>
            <p className="min-w-0 pt-1.5">
              <strong className="font-semibold">{tx.nobody}</strong>
              {tx.nobodyRest}
            </p>
          </li>
        </ul>
      </Card>
    </section>
  );
}

/** GET /ui-api/connect/{kitchen}: the kitchen's connector address for assistants that take only a URL, and setup steps per assistant. */
type ConnectorView = { connector: { url: string; connectorId: string; expiresAt?: string } | null; canManage: boolean; setup: ConnectorSetup | null };

/** A block of code or an address to paste elsewhere: readable, scrolls sideways inside itself, one tap copies it. */
function CodeBlock({ title, text, copied, onCopy, wrap = false }: { title: string; text: string; copied: boolean; onCopy: () => void; wrap?: boolean }) {
  const tx = useText(AGENT_RULES_TEXT);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h4 className="min-w-0 text-[0.92rem] font-semibold">{title}</h4>
        <Button kind="secondary" size="sm" onClick={onCopy} ariaLabel={copied ? tx.copied : tx.copyWhat(title)}>
          {copied ? <Check aria-hidden size={15} strokeWidth={2.5} className="text-good" /> : <Copy aria-hidden size={15} />}
          {copied ? tx.copied : tx.copy}
        </Button>
      </div>
      <pre className={`mt-2 rounded-lg bg-surface p-4 font-mono text-[0.8rem] leading-relaxed text-ink ${wrap ? "max-h-44 overflow-auto whitespace-pre-wrap break-all" : "overflow-x-auto"}`}>{text}</pre>
    </div>
  );
}

function Connect() {
  const { ui, kitchen } = usePortal();
  const tx = useText(AGENT_RULES_TEXT);
  const [c, setC] = useState<ConnectReply>();
  const [connector, setConnector] = useState<ConnectorView | null>();
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<string>();
  useEffect(() => {
    void ui<ConnectReply>("GET", "connect").then((r) => r.ok && setC(r.data));
    // The kitchen's connector address for consumer assistants (one URL, no headers); null when this session may not see it.
    void api<ConnectorView>("GET", `/ui-api/connect/${encodeURIComponent(kitchen.slug)}`).then((r) => setConnector(r.ok ? r.data : null));
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
  const address = (key: string, label: string, value: string) => ({
    key,
    label,
    value: (
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-all pt-0.5 font-mono text-[0.85rem]">{value}</span>
        <IconButton label={copied === key ? tx.copied : tx.copyWhat(label)} onClick={() => void copy(key, value)} className="-my-2.5 -mr-2">
          {copied === key ? <Check aria-hidden size={17} strokeWidth={2.5} className="text-good" /> : <Copy aria-hidden size={17} />}
        </IconButton>
      </span>
    ),
  });
  return (
    <section aria-labelledby="connect">
      <SectionTitle id="connect">{tx.connect}</SectionTitle>
      <p className="-mt-2 max-w-[68ch] leading-relaxed text-ink-soft">{tx.connectIntro}</p>
      {/* The addresses, keys and assistants are for the one who sets an agent up: one tap away, not on the page. */}
      <details className="group mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full px-1 font-semibold text-petrol hover:underline [&::-webkit-details-marker]:hidden">
          <ChevronDown aria-hidden size={17} className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
          {tx.connectShow}
        </summary>
        <div className="mt-3">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Card pad className="space-y-6">
          {!c ? (
            <div className="space-y-3" aria-hidden>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-32" />
            </div>
          ) : (
            <>
              <FactList labelWidth="9rem" rows={[address("mcp", tx.mcpAddress, c.mcpUrl), address("rest", tx.rest, c.openApiUrl), address("keys", tx.keys, c.jwksUrl), address("id", tx.agentId, c.agentId)]} />
              <CodeBlock title={tx.mcpJson} text={mcpJson} copied={copied === "json"} onCopy={() => void copy("json", mcpJson)} />
              <CodeBlock title={tx.oneCommand} text={cli} copied={copied === "cli"} onCopy={() => void copy("cli", cli)} />
            </>
          )}
        </Card>
        <Panel className="space-y-4 p-5 sm:p-6">
          <h3 className="flex items-center gap-2.5">
            <KeyRound aria-hidden size={19} className="text-petrol" />
            <span className="display text-[1.3rem]">{tx.mandateTitle}</span>
          </h3>
          <p className="text-[0.95rem] leading-relaxed">
            <code className="rounded-xs bg-paper px-1.5 py-0.5 font-mono text-[0.85rem]">DOCK_MANDATE</code>
            {tx.mandateIs(kitchen.name)}
            {tx.mandateHead(kitchen.mandate.approvers[0]?.name)}
          </p>
          {c && (
            <>
              <Button kind="secondary" size="sm" onClick={() => setShow((x) => !x)}>
                {show ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
                {show ? tx.hide : tx.show}
              </Button>
              {show && (
                <div className="space-y-2">
                  <CodeBlock title={tx.mandateTitle} text={c.mandate} wrap copied={copied === "mandate"} onCopy={() => void copy("mandate", c.mandate)} />
                  <p className="text-[0.85rem] leading-snug text-ink-soft">{tx.demoNote}</p>
                </div>
              )}
            </>
          )}
          <div className="border-t border-line-strong/50 pt-4">
            <h4 className="font-semibold">{tx.assistant}</h4>
            {connector === undefined ? (
              <p className="mt-1 text-[0.95rem] text-ink-soft">{tx.checking}</p>
            ) : (
              <ConnectorBlock view={connector} slug={kitchen.slug} onChange={setConnector} copied={copied} copy={copy} />
            )}
          </div>
        </Panel>
      </div>
        </div>
      </details>
    </section>
  );
}

/**
 * The kitchen's connector address: what a person pastes into Claude or ChatGPT (no headers, no sign-in), the request
 * to type, and each assistant's steps (written by the server from the vendors' own pages, in English). Whoever may
 * manage the address can issue a new one; the old one stops at once.
 */
function ConnectorBlock({ view, slug, onChange, copied, copy }: { view: ConnectorView | null; slug: string; onChange: (v: ConnectorView | null) => void; copied?: string; copy: (key: string, text: string) => Promise<void> }) {
  const tx = useText(AGENT_RULES_TEXT);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const reissue = async () => {
    setBusy(true);
    setFailed(undefined);
    const r = await api<ConnectorView>("POST", `/ui-api/connect/${encodeURIComponent(slug)}`);
    setBusy(false);
    if (r.ok) onChange(r.data);
    else setFailed(r.error.message);
  };
  if (!view) return <p className="mt-1 text-[0.92rem] leading-relaxed text-ink-soft">{tx.noConnectorHere}</p>;
  const url = view.connector?.url;
  return (
    <div className="mt-1 space-y-3 text-[0.95rem]">
      <p className="leading-relaxed text-ink-soft">{tx.connectorIntro}</p>
      {url && view.setup ? (
        <>
          <div className="flex items-start justify-between gap-2 rounded-lg bg-paper p-3">
            <span className="min-w-0 break-all font-mono text-[0.82rem]">{url}</span>
            <IconButton label={copied === "connector" ? tx.copied : tx.copyWhat(tx.connectorAddress)} onClick={() => void copy("connector", url)} className="-my-2 -mr-1.5">
              {copied === "connector" ? <Check aria-hidden size={17} strokeWidth={2.5} className="text-good" /> : <Copy aria-hidden size={17} />}
            </IconButton>
          </div>
          <p className="leading-relaxed">
            <span className="text-ink-soft">{tx.thenType}</span> <q>{view.setup.prompt}</q>
          </p>
          <ul className="divide-y divide-line-strong/50">
            {view.setup.assistants
              .filter((a) => a.works !== "no")
              .map((a) => (
                <li key={a.id}>
                  <details className="group py-2">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                      <span className="min-w-0">{a.name}</span>
                      <span className="shrink-0 text-[0.82rem] font-medium text-ink-soft">{a.works === "yes" ? tx.worksYes : tx.worksLimited}</span>
                    </summary>
                    <p className="mt-1 text-[0.88rem] leading-snug text-ink-soft">{a.needs}</p>
                    {a.steps.length > 0 && (
                      <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[0.9rem] leading-snug">
                        {a.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    )}
                    {a.paste && a.paste !== url && <pre className="mt-2 overflow-x-auto rounded-md bg-paper p-2.5 font-mono text-[0.78rem]">{a.paste}</pre>}
                  </details>
                </li>
              ))}
          </ul>
          <p className="text-[0.85rem] leading-snug text-ink-soft">{tx.connectorLimits}</p>
        </>
      ) : (
        <p className="leading-relaxed text-ink-soft">{tx.noConnector}</p>
      )}
      {view.canManage && (
        <div>
          <Button kind="secondary" size="sm" busy={busy} onClick={() => void reissue()}>
            {url ? tx.reissue : tx.issue}
          </Button>
          {url && <p className="mt-1.5 text-[0.82rem] leading-snug text-ink-soft">{tx.reissueNote}</p>}
          {failed && <p className="mt-1.5 text-[0.85rem] text-bad">{failed}</p>}
        </div>
      )}
    </div>
  );
}
