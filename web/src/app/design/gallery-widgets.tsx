"use client";

import { BookOpen, History, Phone, Repeat, ShieldCheck, UtensilsCrossed } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLang } from "../_i18n/provider";
import { AgentHome } from "../_ui/agent-home";
import { Composer } from "../_ui/thread";
import { AlternativesPicker, AmountAnswer, ChoiceAnswer, DayAnswer, FactRows, InPlace, LeftOut, MenuProposals, MenuSheet, OrderSheet, RememberThis, YesNoAnswer, type Outcome, type SheetLine, type SheetNotice } from "../_ui/widgets";
import { money, sampleCandidates, sampleDays, sampleDishes, sampleFilters, sampleProducts, sampleProposals, sampleRows, sampleToday } from "./widget-samples";

/**
 * The widgets on sample data, wired to each other the way a page would wire them to the engine: a change in the
 * order sheet recalculates, "swap" opens the picker for that line, a menu goes on to the order sheet. Used by the
 * gallery (/design) and by the workspace demo (/design/workspace).
 */

type DemoLine = { id: string; product: string; packs: number; from?: string; gone?: boolean };

export function useOrderDemo(initial: { variant?: "plain" | "unavailable" | "budget" | "settled" | "busy" } = {}) {
  const { lang } = useLang();
  const f = lang === "fi";
  const P = sampleProducts(lang);
  const [lines, setLines] = useState<DemoLine[]>([
    { id: "l1", product: "semi1", packs: initial.variant === "budget" ? 2600 : 1000 },
    { id: "l2", product: "oat1", packs: 24, gone: initial.variant === "unavailable" },
  ]);
  const [day, setDay] = useState("2026-11-16");
  const [swapping, setSwapping] = useState<string>();
  const [settled, setSettled] = useState(initial.variant === "settled");
  const [removedLine, setRemovedLine] = useState<DemoLine>();

  const cents = lines.filter((l) => !l.gone).reduce((s, l) => s + l.packs * P[l.product].cents, 0);
  const sheetLines: SheetLine[] = lines.map((l) => {
    const p = P[l.product];
    return {
      id: l.id,
      name: p.name,
      pack: p.pack,
      art: p.art,
      packs: l.packs,
      amount: `${(l.packs * p.litres).toLocaleString("fi-FI")} L`,
      unitPrice: `${(p.cents / p.litres / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2 })} €/l`,
      total: money(l.packs * p.cents),
      swappedFrom: l.from ? P[l.from].name : undefined,
      state: l.gone ? "unavailable" : initial.variant === "busy" && l.id === "l1" ? "updating" : "ok",
      reason: l.gone ? (f ? "Tilausaika maanantaiksi päättyi juuri." : "Its order cut-off for Monday has just passed.") : undefined,
    };
  });
  const outcome: Outcome =
    cents > 250_000
      ? { kind: "blocked", text: f ? "Viikkobudjetista 2 500 € on jäljellä 1 860,00 €." : "1 860,00 € is left of this week's 2 500 € budget.", detail: f ? "Viikkobudjetti on sääntöjesi ehdoton raja." : "The weekly budget is a firm limit in your rules." }
      : cents > 50_000
        ? { kind: "sign", text: f ? "Aino hyväksyy puhelimellaan: yli 500 € rajasi." : "Aino OKs it on her phone: over your 500 € limit." }
        : { kind: "alone", text: f ? "Alle 500 € rajasi." : "Inside your 500 € limit." };
  const notices: SheetNotice[] = [];
  if (cents > 250_000) notices.push({ key: "fit", text: f ? "1 800 litraa mahtuu tämän viikon budjettiin." : "1 800 L fits this week's budget.", action: { label: f ? "Käytä 1 800 l" : "Use 1 800 L", onClick: () => setLines((ls) => ls.map((l) => (l.id === "l1" ? { ...l, packs: 1800 } : l))) } });
  if (initial.variant === "plain") notices.push({ key: "dup", text: f ? "Tilasit 400 l samaa maitoa maanantaiksi 20 minuuttia sitten." : "You ordered 400 L of the same milk for Monday 20 minutes ago." });
  const confirm = outcome.kind === "alone" ? (f ? `Tilaa, ${money(cents)}` : `Order this, ${money(cents)}`) : outcome.kind === "sign" ? (f ? `Lähetä Ainolle hyväksyttäväksi, ${money(cents)}` : `Send to Aino for an OK, ${money(cents)}`) : f ? "Ei mahdu budjettiin" : "Does not fit the budget";

  const swapLine = lines.find((l) => l.id === swapping);
  const litres = swapLine ? swapLine.packs * P[swapLine.product].litres : 1000;
  const [filter, setFilter] = useState<string>();
  const all = sampleCandidates(lang, litres);
  const candidates = (filter === "cheapest" ? [...all].sort((a, b) => parseFloat(a.price.replace(/\s/g, "").replace(",", ".")) - parseFloat(b.price.replace(/\s/g, "").replace(",", "."))) : filter === "organic" ? [] : all).slice(0, 4);

  return {
    lang,
    f,
    sheet: (
      <OrderSheet
        kind={f ? "Tilauksesi" : "Your order"}
        lines={sheetLines}
        onPacks={(id, packs) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, packs } : l)))}
        onSwap={(id) => setSwapping(id)}
        onRemove={(id) => {
          setRemovedLine(lines.find((l) => l.id === id));
          setLines((ls) => ls.filter((l) => l.id !== id));
        }}
        removed={removedLine ? { name: P[removedLine.product].name, onUndo: () => { setLines((ls) => [...ls, removedLine]); setRemovedLine(undefined); } } : undefined}
        settledNote={outcome.kind === "sign" ? (f ? "Odottaa Ainon hyväksyntää. Toimitus ma 16.11." : "Waiting for Aino's OK. Delivery Mon 16.11.") : f ? "Tilattu. Saapuu ma 16.11." : "Ordered. Arrives Mon 16.11."}
        takeBack={{ label: f ? "Peru tilaus (su 17.00 asti)" : "Take it back (until Sun 17.00)", onClick: () => setSettled(false) }}
        onAdd={() => setLines((ls) => [...ls, { id: `l${ls.length + 1}`, product: "skim1", packs: 12 }])}
        days={sampleDays(lang)}
        day={day}
        onDay={setDay}
        total={money(cents)}
        totalNote={f ? "veroton, kiinteä hinta 30 min" : "before VAT, price fixed for 30 min"}
        outcome={outcome}
        notices={notices}
        confirm={confirm}
        onConfirm={() => setSettled(true)}
        busy={initial.variant === "busy"}
        settled={settled}
      />
    ),
    swapping: !!swapLine,
    picker: (
      <AlternativesPicker
        kind={f ? "Vertaa vaihtoehtoja" : "Compare alternatives"}
        insteadOf={swapLine ? P[swapLine.product].name : P.semi1.name}
        filters={sampleFilters(lang).map((x) => ({ ...x, on: x.id === filter || x.id === "lactose" }))}
        onFilter={(id) => setFilter((cur) => (cur === id ? undefined : id))}
        candidates={candidates}
        rows={sampleRows(lang)}
        selected={swapLine && swapLine.from ? swapLine.product : undefined}
        onSelect={(id) => {
          if (!swapLine) return;
          const to = P[id];
          const from = P[swapLine.product];
          setLines((ls) => ls.map((l) => (l.id === swapLine.id ? { ...l, product: id, packs: Math.max(1, Math.round((l.packs * from.litres) / to.litres)), from: id === l.product ? l.from : l.product, gone: false } : l)));
          setSwapping(undefined);
        }}
        onClose={swapLine ? () => setSwapping(undefined) : undefined}
      />
    ),
    closeSwap: () => setSwapping(undefined),
    openSwap: () => setSwapping("l1"),
  };
}

export function useMenuDemo(start: "forming" | "proposals" | "sheet" = "proposals") {
  const { lang } = useLang();
  const f = lang === "fi";
  const [chosen, setChosen] = useState<string | undefined>(start === "sheet" ? "m1" : undefined);
  const [covers, setCovers] = useState(40);
  const [have, setHave] = useState<Record<string, boolean>>({ i5: true });
  const [dropped, setDropped] = useState<string[]>([]);
  const proposals = sampleProposals(lang);
  const dishes = sampleDishes(lang, covers)
    .filter((d) => !dropped.includes(d.id))
    .map((d) => ({ ...d, ingredients: d.ingredients.map((g) => ({ ...g, have: have[g.id] ?? false })) }));
  const toOrder = dishes.flatMap((d) => d.ingredients).filter((g) => !g.have && g.product).length;
  const inKitchen = dishes.flatMap((d) => d.ingredients).filter((g) => g.have).length;
  const total = Math.round(covers * 340);
  return {
    proposals: (
      <MenuProposals
        kind={f ? "Menuehdotukset" : "Menu ideas"}
        intro={f ? "Kolme lounasta 40 hengelle punajuuren ympärille, keittiön sääntöjen mukaan." : "Three lunches for 40 around beetroot, inside the kitchen's rules."}
        proposals={start === "forming" && !chosen ? proposals.slice(0, 1) : proposals}
        selected={chosen}
        onSelect={setChosen}
        forming={
          start === "forming" && !chosen
            ? {
                of: 3,
                steps: [
                  { key: "a", text: f ? "Luin keittiön säännöt: ei pähkinöitä, laktoositon" : "Read the kitchen's rules: no nuts, lactose-free", state: "done" },
                  { key: "b", text: f ? "Hain punajuurituotteet, jotka ehtivät torstaiksi" : "Found the beetroot products that arrive by Thursday", state: "done", detail: "14" },
                  { key: "c", text: f ? "Lasken toisen menun raaka-aineet 40 annokselle" : "Working out the second menu's ingredients for 40 covers", state: "doing" },
                ],
              }
            : undefined
        }
      />
    ),
    chosen,
    sheet: (
      <MenuSheet
        kind={f ? "Menu" : "Menu"}
        title={proposals[0].title}
        covers={covers}
        onCovers={setCovers}
        dishes={dishes}
        onDropDish={(id) => setDropped((d) => [...d, id])}
        onSwapDish={() => {}}
        onSwapIngredient={() => {}}
        onHave={(_, id, v) => setHave((h) => ({ ...h, [id]: v }))}
        summary={{ toOrder, inKitchen, total: money(total), perCover: money(Math.round(total / covers)) }}
        confirm={f ? `Jatka tilaukseen, ${toOrder} tuotetta` : `Continue to the order, ${toOrder} products`}
        onConfirm={() => {}}
      />
    ),
  };
}

export function AnswersDemo() {
  const { lang } = useLang();
  const f = lang === "fi";
  const [fat, setFat] = useState<string[]>([]);
  const [diet, setDiet] = useState<string[]>(["lf"]);
  const [day, setDay] = useState<string>();
  const [amount, setAmount] = useState(400);
  const [amountDone, setAmountDone] = useState(false);
  const [yn, setYn] = useState<"yes" | "no">();
  const kind = f ? "Kysymys" : "A question";
  return (
    <>
      <ChoiceAnswer
        kind={kind}
        question={f ? "Mikä rasvapitoisuus?" : "Which fat content?"}
        why={f ? "pyysit maitoa, ja valikoimassa on kolme, jotka ehtivät maanantaiksi" : "you asked for milk, and three kinds can arrive by Monday"}
        choices={[
          { id: "semi", label: f ? "Kevyt 1,5 %" : "Semi-skimmed 1.5 %", hint: f ? "tavallinen valintasi" : "your usual" },
          { id: "skim", label: f ? "Rasvaton" : "Skimmed" },
          { id: "whole", label: f ? "Täysmaito 3,5 %" : "Whole 3.5 %" },
        ]}
        chosen={fat}
        onChoose={(id) => setFat([id])}
      />
      <ChoiceAnswer
        kind={kind}
        multiple
        question={f ? "Mitä keittiö ei koskaan saa tilata?" : "What must this kitchen never be sent?"}
        choices={[
          { id: "nuts", label: f ? "Pähkinät" : "Nuts" },
          { id: "lf", label: f ? "Laktoosi" : "Lactose" },
          { id: "gluten", label: f ? "Gluteeni" : "Gluten" },
          { id: "fish", label: f ? "Kala" : "Fish" },
          { id: "egg", label: f ? "Kananmuna" : "Egg" },
        ]}
        chosen={diet}
        onChoose={(id) => setDiet((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]))}
      />
      <DayAnswer kind={kind} question={f ? "Mille päivälle?" : "For which day?"} why={f ? "sanoit \"ensi viikolla\"" : "you said \"next week\""} days={sampleDays(lang)} day={day} onDay={setDay} />
      <AmountAnswer
        kind={kind}
        question={f ? "Kuinka paljon maitoa?" : "How much milk?"}
        value={amount}
        onChange={setAmount}
        unit={f ? "litraa" : "litres"}
        step={10}
        min={10}
        usual="400 L"
        presets={[
          { value: 200, label: "200 L" },
          { value: 400, label: "400 L" },
          { value: 1000, label: "1 000 L" },
        ]}
        confirm={f ? `${amount.toLocaleString("fi-FI")} litraa` : `${amount.toLocaleString("fi-FI")} litres`}
        onConfirm={() => setAmountDone(true)}
        answered={amountDone}
      />
      <YesNoAnswer
        kind={kind}
        question={f ? "Tilasit 400 l samaa maitoa 20 minuuttia sitten. Tilataanko silti uudelleen?" : "You ordered 400 L of the same milk 20 minutes ago. Order it again anyway?"}
        why={f ? "sama tuote samalle päivälle näyttää usein vahingolta" : "the same product for the same day is often a slip"}
        yes={f ? "Kyllä, tilaa toinenkin" : "Yes, a second order"}
        no={f ? "Ei, se oli vahinko" : "No, that was a slip"}
        onAnswer={setYn}
        answered={yn}
      />
    </>
  );
}

export function InPlaceDemo() {
  const { lang } = useLang();
  const f = lang === "fi";
  const [items, setItems] = useState([
    { id: "m1", text: f ? "Maidoksi aina laktoositon" : "Milk is always lactose-free", source: f ? "sanoit sen tässä tilauksessa" : "you said so in this order", keep: true },
    { id: "m2", text: f ? "Maanantaisin noin 400 l" : "About 400 L on Mondays", source: f ? "neljästä viime tilauksesta" : "from your last four orders", keep: true },
    { id: "m3", text: f ? "Hanapakkaus mieluummin kuin tölkit" : "Bag-in-box rather than cartons", source: f ? "vaihdoit sen kahdesti" : "you swapped to it twice", keep: false },
  ]);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <div className="rounded-xl border border-line bg-paper px-3 py-1.5">
        <InPlace summary={f ? "Tilauksen tiedot" : "Order details"}>
          <FactRows
            rows={[
              { label: f ? "Tila" : "Status", value: f ? "Odottaa hyväksyntää: Aino Virtanen" : "Waiting for Aino Virtanen" },
              { label: f ? "Toimitus" : "Delivery", value: f ? "ma 16.11." : "Mon 16.11." },
              { label: f ? "Tilasi" : "Placed by", value: f ? "Keittiön ostoagentti" : "The kitchen's buyer agent" },
              { label: f ? "Tilausnumero" : "Order", value: "ord_d80d8e60", mono: true },
            ]}
          />
        </InPlace>
        <InPlace summary={f ? "Näin tarkistat hinnan" : "How to check this price"}>
          <FactRows
            rows={[
              { label: f ? "Allekirjoittaja" : "Signed by", value: f ? "Tukkuri, avain dock-wholesaler" : "The wholesaler, key dock-wholesaler" },
              { label: f ? "Menetelmä" : "Method", value: "Ed25519 (JWS)", mono: true },
              { label: f ? "Voimassa" : "Holds until", value: "14.32" },
              { label: f ? "Tiiviste" : "Digest", value: "9f2c…41ab", mono: true },
            ]}
          />
        </InPlace>
        <InPlace summary={f ? "16 muuta tuotetta jäi pois: miksi" : "16 other products not offered: why"} count="16">
          <LeftOut
            groups={[
              { reason: f ? "Tilausaika maanantaiksi on päättynyt" : "The order cut-off for Monday has passed", count: 6, names: [f ? "10 l hanapakkaukset" : "the 10 l bag-in-box packs"] },
              { reason: f ? "Eri tuote kuin pyysit (kahvimaito, piimä)" : "A different product than asked (coffee milk, buttermilk)", count: 9 },
              { reason: f ? "Ei laktoositon" : "Not lactose-free", count: 1 },
            ]}
          />
        </InPlace>
      </div>
      <RememberThis kind={f ? "Muistetaanko tämä?" : "Remember this?"} items={items} onToggle={(id, keep) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, keep } : x)))} onSave={() => setSaved(true)} saved={saved} />
    </>
  );
}

export function HomeDemo({ quiet = false, composer = true }: { quiet?: boolean; composer?: boolean }) {
  const { lang } = useLang();
  const f = lang === "fi";
  const [draft, setDraft] = useState("");
  const noop = () => {};
  return (
    <AgentHome
      greeting={f ? "Hyvää huomenta, Hotel Lumo." : "Good morning, Hotel Lumo."}
      lead={quiet ? undefined : f ? "Neljä asiaa odottaa sinua tänään." : "Four things need you today."}
      today={quiet ? [] : sampleToday(lang).slice(0, 4)}
      quiet={f ? "Mikään ei odota sinua tänään. Seuraava toimitus ma 16.11." : "Nothing needs you today. Next delivery Mon 16.11."}
      composer={!composer ? undefined : <Composer value={draft} onChange={setDraft} onSubmit={() => setDraft("")} placeholder={f ? "Kerro, mitä keittiö tarvitsee" : "Tell the agent what the kitchen needs"} label={f ? "Viesti agentille" : "Message to the agent"} />}
      starters={[
        { id: "s1", label: f ? "Toista tavallinen maito" : "Repeat the usual milk", icon: <Repeat aria-hidden size={18} />, onClick: noop },
        { id: "s2", label: f ? "Suunnittele menu" : "Plan a menu", icon: <UtensilsCrossed aria-hidden size={18} />, onClick: noop },
        { id: "s3", label: f ? "Mitä tilasimme viime viikolla?" : "What did we order last week?", icon: <History aria-hidden size={18} />, onClick: noop },
        { id: "s4", label: f ? "Mitä agentti saa tehdä" : "What the agent may do", icon: <ShieldCheck aria-hidden size={18} />, onClick: noop },
        { id: "s5", label: f ? "Selaa valikoimaa" : "Browse the catalogue", icon: <BookOpen aria-hidden size={18} />, onClick: noop },
        { id: "s6", label: f ? "Soita agentille" : "Call your agent", icon: <Phone aria-hidden size={18} />, onClick: noop },
      ]}
    />
  );
}

function Frame({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "lg:col-span-2" : ""}>
      <p className="mb-2 text-[0.82rem] font-medium text-ink-soft">{title}</p>
      <div className="space-y-3 rounded-2xl bg-lavender p-3 sm:p-4">{children}</div>
    </div>
  );
}

/** The gallery's block for the widgets. Each is live: change an amount, swap a line, choose a menu. */
export function WidgetsDemo() {
  const order = useOrderDemo({ variant: "plain" });
  const unavailable = useOrderDemo({ variant: "unavailable" });
  const budget = useOrderDemo({ variant: "budget" });
  const busy = useOrderDemo({ variant: "busy" });
  const settled = useOrderDemo({ variant: "settled" });
  const forming = useMenuDemo("forming");
  const menu = useMenuDemo("sheet");
  return (
    <section>
      <h2 className="display text-[1.6rem]">Widgets</h2>
      <p className="mt-1 max-w-[70ch] text-[0.95rem] text-ink-soft">
        Where the buyer refines an order or a menu inside the conversation, without typing and without leaving. All are live on sample data. The same widgets inside the dock and the workspace:{" "}
        <a className="font-medium text-petrol underline" href="/design/workspace">
          /design/workspace
        </a>
        .
      </p>
      <div className="mt-5 grid items-start gap-6 lg:grid-cols-2">
        <Frame title="The agent as home: what needs the kitchen today, the composer, starting points">
          <HomeDemo />
        </Frame>
        <Frame title="The same, on a quiet day">
          <HomeDemo quiet />
        </Frame>
        <Frame title="Order sheet: edit amounts, day, swap, remove, add. A duplicate notice; a person signs">{order.swapping ? order.picker : order.sheet}</Frame>
        <Frame title="Order sheet: a line that became unavailable">{unavailable.swapping ? unavailable.picker : unavailable.sheet}</Frame>
        <Frame title="Order sheet: over the weekly budget, with the amount that fits">{budget.sheet}</Frame>
        <Frame title="Order sheet: recalculating, and settled">
          {busy.sheet}
          {settled.sheet}
        </Frame>
        <Frame title="Alternatives picker: columns aligned row by row; chips re-rank (try Cheapest, Organic)" wide>
          {order.picker}
        </Frame>
        <Frame title="Menu ideas while the plan is forming" wide>
          {forming.proposals}
        </Frame>
        <Frame title="The chosen menu as a working sheet: covers, dishes, ingredients, conflicts">{menu.sheet}</Frame>
        <Frame title="Answering without typing">
          <AnswersDemo />
        </Frame>
        <Frame title="Opening in place, and what to remember">
          <InPlaceDemo />
        </Frame>
      </div>
    </section>
  );
}
