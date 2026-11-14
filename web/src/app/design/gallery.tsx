"use client";

import { Package, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LangSwitch } from "../_i18n/provider";
import { Avatar, Badge, Button, Card, Checkbox, Chip, Empty, FactList, IconDisc, Input, Kbd, ListRow, PageHeader, Panel, Price, Select, Sheet, Skeleton, Steps, Tabs, Tag, Textarea, Toaster, useToast } from "../_ui/kit";
import { AgentTurn, AnomalyCard, BuyerTurn, Composer, GateCard, MemoryCard, NoticeCard, OptionsCard, OrderCard, PriceCard, QuestionCard, RecordsCard, StepLines, Thread, UnderstoodCard, VoiceStatus, type MicState, type VoiceState } from "../_ui/thread";
import { Wordmark } from "../_ui/wordmark";

/**
 * Every shared component with its states, on made-up data (web/docs/DESIGN.md points here). Nothing on this page
 * calls the server: it is the place to look at a component before using it, and to check a change to the kit.
 */
export function Gallery() {
  return (
    <Toaster>
      <div className="min-h-dvh bg-mist">
        <header className="border-b border-line bg-paper">
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <Wordmark size={28} />
            <p className="text-[0.9rem] text-ink-soft">Design system: components and their states, on sample data</p>
            <LangSwitch />
          </div>
        </header>
        <main className="mx-auto max-w-[1200px] space-y-14 px-4 py-10 sm:px-6">
          <ThreadDemo />
          <Voice />
          <Controls />
          <Surfaces />
        </main>
      </div>
    </Toaster>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="display text-[1.6rem]">{title}</h2>
      {note && <p className="mt-1 max-w-[70ch] text-[0.95rem] text-ink-soft">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ThreadDemo() {
  const [draft, setDraft] = useState("");
  const [mic, setMic] = useState<MicState>("idle");
  const [answer, setAnswer] = useState<string>();
  const [option, setOption] = useState<string>();
  return (
    <Block title="The thread" note="The buyer's one conversation with their agent. Buyer turns are bubbles; agent turns are a line of text at most, live steps while it works, then cards built from data. The gate card is the signature; the anomaly card is warm and calm.">
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="rounded-2xl bg-lavender p-4">
          <Thread label="Sample thread, first half">
            <BuyerTurn time="14.02">1000 litraa laktoositonta maitoa maanantaiksi</BuyerTurn>
            <AgentTurn
              steps={
                <StepLines
                  steps={[
                    { key: "a", text: "Read the request twice", state: "done", detail: "1.4 s" },
                    { key: "b", text: "Searched 17 546 products", state: "done", detail: "12 ms" },
                    { key: "c", text: "Checked the live price of 3 products", state: "done" },
                  ]}
                />
              }
            >
              <UnderstoodCard
                kind="What I understood"
                summary="1 000 L lactose-free milk by Monday 16.11."
                items={[
                  { label: "Product", value: "Milk, lactose-free", from: "said" },
                  { label: "Amount", value: "1 000 L" },
                  { label: "Deliver by", value: "Mon 16.11." },
                  { label: "Fat", value: "Semi-skimmed, 1.5 %", from: "memory" },
                ]}
              />
              <AnomalyCard
                kind="Check the amount"
                title="That is ten times your usual order"
                reason="The last six milk orders were between 80 and 120 litres. A slip of a zero is the most common mistake in an order."
                usual={{ value: "100 L", amount: 100 }}
                asked={{ value: "1 000 L", amount: 1000 }}
                actions={
                  <>
                    <Button kind="primary" size="sm">
                      Yes, 1 000 L
                    </Button>
                    <Button size="sm">Make it 100 L</Button>
                  </>
                }
              />
            </AgentTurn>
            <BuyerTurn via="voice">Yes, a thousand. It is for the conference.</BuyerTurn>
            <AgentTurn>
              <QuestionCard
                kind="One question"
                question="The 10-litre boxes cannot make Monday. Cartons can."
                why="The order cut-off for bag-in-box was Thursday 15.00. One-litre cartons can still be ordered until Sunday 17.00."
                choices={[
                  { id: "cartons", label: "Cartons for Monday" },
                  { id: "later", label: "Boxes", hint: "Wed 18.11." },
                ]}
                chosen={answer}
                onChoose={setAnswer}
              />
              <MemoryCard kind="Remember this?" items={[{ text: "Conference breakfasts: lactose-free milk, about 3 L per 10 guests.", onKeep: () => {}, onDrop: () => {}, keepLabel: "Keep", dropLabel: "Drop" }, { text: "Cartons are fine when boxes cannot make the day.", state: "kept" }]} />
            </AgentTurn>
            <AgentTurn text="Looking for what can still make Monday." steps={<StepLines fold={false} steps={[{ key: "a", text: "Checking the live price of 3 products", state: "doing" }]} />} pending />
          </Thread>
        </div>
        <div className="rounded-2xl bg-lavender p-4">
          <Thread label="Sample thread, second half">
            <AgentTurn text="Three ways to do it, all lactose-free.">
              <OptionsCard
                kind="Options"
                chosen={option}
                onChoose={setOption}
                options={[
                  { id: "a", rank: "best", name: "Semi-skimmed milk 1 L, lactose-free", detail: "1 000 cartons", price: "1 400,00 €", per: "1,40 € / L", delivery: "Mon 16.11.", keeps: ["The day you asked for", "Your usual fat content"], givesUp: ["Cartons, not boxes: more to open"], preselected: "The agent would take this: the only one that makes Monday in full." },
                  { id: "b", rank: "better", name: "Semi-skimmed milk 10 L box, lactose-free", detail: "100 boxes", price: "1 565,50 €", per: "1,57 € / L", delivery: "Wed 18.11.", keeps: ["Boxes, as you usually buy"], givesUp: ["Two days late"], signOff: "Over 1 000 €: Aino Virtanen signs" },
                  { id: "c", rank: "good", name: "Skimmed milk 1 L, lactose-free", detail: "600 cartons now, the rest Wednesday", price: "780,00 €", per: "1,30 € / L", delivery: "Mon 16.11.", keeps: ["Inside this week's budget"], givesUp: ["Only 600 L on Monday", "Skimmed, not semi-skimmed"] },
                ]}
                note="Ranked for the cheapest that can make Monday. Prices are from the wholesaler's live service, checked 14.03."
              />
              <PriceCard
                kind="Fixed price"
                price="1 400,00 €"
                per="for 1 000 L, VAT 0 %"
                holds="holds 9 min 40 s"
                left={0.64}
                lines={[
                  { label: "1 000 × Semi-skimmed milk 1 L", value: "1 400,00 €" },
                  { label: "Delivery Mon 16.11.", value: "included" },
                ]}
                signed="Signed by the wholesaler. Anyone can check it against the published keys."
              />
              <GateCard
                state="waiting"
                kind="The gate"
                countdown="38 s"
                title="Stopped at the gate"
                reason="1 400,00 € is over the 1 000,00 € the agent may spend alone. Only a named person can sign it, on their own phone."
                approver={{ name: "Aino Virtanen", role: "kitchen manager", where: "On their phone now" }}
                rules={[
                  { title: "Per-order limit", ok: false },
                  ...Array.from({ length: 16 }, (_, i) => ({ title: `Rule ${i}`, ok: true })),
                ]}
              />
              <GateCard state="approved" kind="The gate" title="Signed by a person" reason="The sign-off is bound to this exact order." approver={{ name: "Aino Virtanen", role: "14.05" }} rules={Array.from({ length: 17 }, (_, i) => ({ title: `Rule ${i}`, ok: true }))} />
              <OrderCard
                kind="Order"
                status={{ label: "Placed", tone: "good" }}
                lines={[{ name: "Semi-skimmed milk 1 L, lactose-free", qty: "× 1 000", price: "1 400,00 €" }]}
                total="1 400,00 €"
                totalLabel="Total, VAT 0 %"
                delivery="Arrives Mon 16.11."
                href="#"
                linkLabel="Open the order"
              />
            </AgentTurn>
            <AgentTurn>
              <RecordsCard
                kind="From your records"
                rows={[
                  { label: "Mon 9.11.", sub: "100 L milk, 10 L cream, placed by the agent", value: "168,10 €", href: "#" },
                  { label: "Thu 12.11.", sub: "100 L milk, signed by Sanna Koskinen", value: "124,80 €", href: "#" },
                ]}
                note="2 orders last week, from the kitchen's order history."
              />
              <NoticeCard kind="Not in the catalogue" title="The wholesaler does not sell beef here.">
                The agent may buy milk and plant drinks for this kitchen. Ask for something in those groups, or change the rules under Agent and rules.
              </NoticeCard>
              <NoticeCard tone="gate" kind="Suspended" title="The wholesaler has suspended this agent.">
                Nothing can be ordered until operations resume it. The reason given: three refused orders in a minute.
              </NoticeCard>
              <GateCard state="declined" kind="The gate" title="Declined by Aino Virtanen" reason="Nothing was ordered. The price is released." />
              <GateCard state="refused" kind="The gate" title="Refused" reason="Almond drink contains tree nuts. This kitchen's signed rules say never nuts." rules={[{ title: "Forbidden allergen: tree nuts", ok: false }, { title: "x", ok: true }, { title: "y", ok: true }]} />
              <GateCard state="placed_alone" kind="The gate" title="Inside the mandate" reason="Placed by the agent alone." rules={Array.from({ length: 17 }, (_, i) => ({ title: `Rule ${i}`, ok: true }))} />
            </AgentTurn>
          </Thread>
          <div className="mt-4">
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={() => setDraft("")}
              label="Tell the agent what the kitchen needs"
              placeholder="Tell the agent what the kitchen needs"
              mic={{ state: mic, onDown: () => setMic("listening"), onUp: () => setMic("idle"), heard: mic === "listening" ? "sata litraa maitoa torstaiksi" : undefined }}
              onPhoto={() => {}}
              hint="Hold the microphone to talk. Nothing is ordered until the gate has checked it."
            />
          </div>
        </div>
      </div>
    </Block>
  );
}

function Voice() {
  const states: VoiceState[] = ["listening", "thinking", "speaking", "waiting", "reconnecting", "idle"];
  return (
    <Block title="Voice" note="The call is a door onto the same thread. Its states, small for the thread's header and large for the call screen.">
      <div className="flex flex-wrap gap-2.5">
        {states.map((s) => (
          <VoiceStatus key={s} state={s} />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
        {states.slice(0, 5).map((s) => (
          <VoiceStatus key={s} state={s} size="lg" />
        ))}
      </div>
    </Block>
  );
}

function Controls() {
  const toast = useToast();
  const [tab, setTab] = useState("all");
  const [sheet, setSheet] = useState(false);
  const [check, setCheck] = useState(true);
  const [chips, setChips] = useState<string[]>(["Lactose-free"]);
  return (
    <Block title="Controls" note="Buttons and chips are pills; fields are 12. Lime is the one main action in view.">
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="go">Place the order</Button>
        <Button kind="primary">Repeat</Button>
        <Button>Change</Button>
        <Button kind="quiet">Repeat with a change</Button>
        <Button kind="safety">Sign off</Button>
        <Button busy>Working</Button>
        <Button size="sm">Small</Button>
        <Button kind="go" size="lg">
          Large
        </Button>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Tag>Lactose-free</Tag>
        <Tag tone="muted">Steady</Tag>
        <Tag tone="agent">Drifted</Tag>
        <Tag tone="good">Organic</Tag>
        <Badge tone="good">Placed</Badge>
        <Badge tone="info">Priced</Badge>
        <Badge tone="agent">From memory</Badge>
        <Badge tone="waiting">Waiting for a person</Badge>
        <Badge tone="refused">Refused</Badge>
        <Badge>Draft</Badge>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Input label="Restaurant name" placeholder="Ravintola Kaari" hint="As it appears on your delivery notes." />
        <Input label="Search" icon={<Search size={17} />} placeholder="maito, mjölk, milk" />
        <Select label="Deliver on">
          <option>Mon 16.11.</option>
          <option>Tue 17.11.</option>
        </Select>
        <Input label="Per-order limit" value="abc" error="Give a number of euros." onChange={() => {}} />
        <Input label="Weekly budget" value="400" suffix="€" inputMode="numeric" onChange={() => {}} />
        <Textarea label="Note for the driver" placeholder="Back door, ring twice" />
        <div className="space-y-2">
          <Checkbox checked={check} onChange={setCheck} label="Lactose-free only" hint="The agent never proposes anything else." />
          <Checkbox card checked={!check} onChange={(v) => setCheck(!v)} label="Milk and cream" />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Must be">
        {["Lactose-free", "Gluten-free", "Vegan", "Organic"].map((c) => (
          <Chip key={c} on={chips.includes(c)} onClick={() => setChips((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))}>
            {c}
          </Chip>
        ))}
        <Chip on={false} onClick={() => {}} count={91}>
          Milk
        </Chip>
      </div>
      <div className="mt-8 rounded-xl bg-paper p-5">
        <PageHeader back={{ href: "#", label: "Orders" }} title="Order of Mon 16.11." lead="Placed by the agent alone at 9.42, within the kitchen's signed rules." actions={<Button kind="go">Repeat this order</Button>} />
        <FactList
          className="mt-6 max-w-xl"
          rows={[
            { label: "Sold per", value: "case: 6 × 1 L" },
            { label: "Origin", value: "Finland" },
            { label: "Allergens", value: "Contains milk" },
          ]}
        />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Tabs label="Show" value={tab} onChange={setTab} options={[{ id: "all", label: "All", count: 24 }, { id: "waiting", label: "Waiting", count: 2 }, { id: "refused", label: "Refused", count: 3 }]} />
        <Button size="sm" onClick={() => setSheet(true)}>
          Open a sheet
        </Button>
        <Button size="sm" onClick={() => toast.show("Added to the basket", "good")}>
          Show a toast
        </Button>
      </div>
      <div className="mt-6 max-w-3xl">
        <Steps
          label="Where the request is"
          steps={[
            { key: "1", label: "Request", state: "done" },
            { key: "2", label: "Lookup", state: "done" },
            { key: "3", label: "Options", state: "current" },
            { key: "4", label: "Price", state: "pending" },
            { key: "5", label: "Gate", state: "pending" },
          ]}
        />
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="A sheet" footer={<Button kind="go" onClick={() => setSheet(false)}>Done</Button>}>
        <p className="text-ink-soft">It rises from the bottom edge on a phone and is a centred dialog on a desk. Escape or a tap outside closes it.</p>
      </Sheet>
    </Block>
  );
}

function Surfaces() {
  return (
    <Block title="Surfaces" note="By role: a card for a thing that stands alone, a list inside one card for rows, a tinted panel for an aside. Not a card around everything.">
      <div className="grid gap-5 lg:grid-cols-3">
        <Card pad>
          <p className="text-[0.86rem] text-ink-soft">A card</p>
          <Price className="mt-2" cents={140000} per="for 1 000 L" note="Fixed until 14.12" size="lg" />
        </Card>
        <Card>
          <ul className="divide-y divide-line">
            <li>
              <ListRow leading={<Avatar name="Aino Virtanen" />} title="Aino Virtanen" sub="Kitchen manager, signs up to 2 500 €" trailing={<Badge tone="good">Enrolled</Badge>} />
            </li>
            <li>
              <ListRow href="#" leading={<IconDisc size={36}><Package size={18} /></IconDisc>} title="Mon 16.11." sub="1 000 × milk, placed by the agent" trailing={<span className="font-semibold tabular">1 400,00 €</span>} />
            </li>
          </ul>
        </Card>
        <div className="space-y-4">
          <Panel className="p-4">
            <p className="text-[0.86rem] text-ink-soft">A tinted panel</p>
            <p className="mt-1 font-medium">Usual 100 L, Mondays and Thursdays</p>
          </Panel>
          <Panel tone="agent" className="p-4">
            <p className="text-[0.86rem] text-lavender-deep">The agent&apos;s tint</p>
            <p className="mt-1 font-medium">Always lactose-free for this kitchen</p>
          </Panel>
        </div>
        <Empty title="Nothing waits for you" glyph={<IconDisc tone="good"><Package size={20} /></IconDisc>}>
          Sign-offs, cut-offs closing within a day and standing orders that drift appear here.
        </Empty>
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24" />
        </div>
      </div>
    </Block>
  );
}
