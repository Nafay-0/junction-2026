"use client";

import { useState, type ReactNode } from "react";
import { useLang } from "../_i18n/provider";
import { AmountAnswer, ChoiceAnswer, Stepper } from "../_ui/widgets";
import { DeliveryCard, HistoryList, MemoryList, ProductFacts, ProductResults, RuleChange, RulesSheet, SetupDone, SetupStep, SetupWelcome, StandingOrders } from "../_ui/widgets-more";
import { useOrderDemo } from "./gallery-widgets";

/** The second set of widgets on sample data: showing things, your rules, the set-up interview. */

export function ShowingDemo({ only }: { only?: "results" | "history" | "standing" }) {
  const { lang } = useLang();
  const f = lang === "fi";
  const [added, setAdded] = useState<string[]>([]);
  const [paused, setPaused] = useState<Record<string, boolean>>({});
  const [memory, setMemory] = useState([
    { id: "m1", text: f ? "Maidoksi aina laktoositon" : "Milk is always lactose-free", source: f ? "Aino, 27.10." : "Aino, 27.10." },
    { id: "m2", text: f ? "Maanantaisin noin 400 l maitoa" : "About 400 L of milk on Mondays", source: f ? "neljästä viime tilauksesta" : "from your last four orders" },
  ]);
  const again = useOrderDemo();
  const [againOpen, setAgainOpen] = useState(false);
  const price = f ? "Hinta avattaessa" : "Price when opened";
  const products = [
    { id: "p1", name: f ? "Kaurajuoma barista 1 l" : "Oat drink barista 1 l", pack: f ? "1 l tölkki" : "1 l carton", art: "tile-plant-drink" },
    { id: "p2", name: f ? "Kaurajuoma luomu 1 l" : "Organic oat drink 1 l", pack: f ? "1 l tölkki" : "1 l carton", art: "tile-plant-drink" },
    { id: "p3", name: f ? "Kaurajuoma 10 l hanapakkaus" : "Oat drink 10 l bag-in-box", pack: f ? "10 l hanapakkaus" : "10 l bag-in-box", art: "tile-bag-in-box" },
    { id: "p4", name: f ? "Kauraruokakerma 1 l" : "Oat cooking cream 1 l", pack: f ? "1 l tölkki" : "1 l carton", art: "tile-cream-cooking" },
    { id: "p5", name: f ? "Kauravälipala mustikka 150 g" : "Oat snack blueberry 150 g", pack: f ? "6 × 150 g" : "6 × 150 g", art: "tile-yoghurt-cups" },
    { id: "p6", name: f ? "Kaurajäätelö vanilja 2,5 l" : "Oat ice cream vanilla 2.5 l", pack: "2,5 l", art: "tile-ice-cream" },
    { id: "p7", name: f ? "Kaurakeksi 400 g" : "Oat biscuit 400 g", pack: "12 × 400 g", art: "tile-pastry" },
    { id: "p8", name: f ? "Kaurahiutale 5 kg" : "Rolled oats 5 kg", pack: f ? "5 kg säkki" : "5 kg sack", art: "tile-flour-sack" },
  ].map((p) => ({ ...p, price, added: added.includes(p.id) }));
  const results = <ProductResults kind={f ? "8 tuotetta haulla \"kaura\"" : "8 products for \"oat\""} products={products} onAdd={(id) => setAdded((a) => [...a, id])} onOpen={() => {}} />;
  const history = againOpen ? (
    again.sheet
  ) : (
    <HistoryList
      kind={f ? "Viime viikon tilaukset" : "Last week's orders"}
      onAgain={() => setAgainOpen(true)}
      orders={[
        { id: "o1", when: f ? "to 12.11." : "Thu 12.11.", summary: f ? "400 l laktoositonta maitoa, 24 l kaurajuomaa" : "400 L lactose-free milk, 24 L oat drink", total: "449,36 €", note: f ? "Agentti tilasi" : "Placed by your agent" },
        { id: "o2", when: f ? "ma 9.11." : "Mon 9.11.", summary: f ? "400 l laktoositonta maitoa, 10 l kermaa" : "400 L lactose-free milk, 10 L cream", total: "452,00 €", note: f ? "Agentti tilasi" : "Placed by your agent" },
        { id: "o3", when: f ? "pe 6.11." : "Fri 6.11.", summary: f ? "1 000 l laktoositonta maitoa" : "1 000 L lactose-free milk", total: "1 010,00 €", note: f ? "Aino hyväksyi" : "OK'd by Aino" },
        { id: "o4", when: f ? "ti 3.11." : "Tue 3.11.", summary: f ? "12 × kaurakeksi" : "12 × oat biscuit", total: "38,40 €" },
      ]}
    />
  );
  const standing = (
    <StandingOrders
      kind={f ? "Kestotilaukset" : "Standing orders"}
      onPause={(id, p) => setPaused((x) => ({ ...x, [id]: p }))}
      onChange={() => {}}
      items={[
        { id: "s1", name: f ? "Laktoositon maito" : "Lactose-free milk", rhythm: f ? "400 l, maanantaisin ja torstaisin" : "400 L, Mondays and Thursdays", next: f ? "Seuraava: ma 16.11." : "Next: Mon 16.11.", paused: !!paused.s1 },
        { id: "s2", name: f ? "Kerma" : "Cream", rhythm: f ? "14 l, torstaisin" : "14 L, Thursdays", next: f ? "Seuraava: to 19.11." : "Next: Thu 19.11.", paused: !!paused.s2, note: f ? "Kasvanut 10 l → 14 l neljässä viikossa" : "Crept from 10 L to 14 L in four weeks" },
      ]}
    />
  );
  if (only === "results") return results;
  if (only === "history") return history;
  if (only === "standing") return standing;
  return (
    <>
      {results}
      <ProductFacts
        kind={f ? "Tuote" : "Product"}
        name={products[0].name}
        pack={products[0].pack}
        art={products[0].art}
        price="1,89 €"
        rows={[
          { label: f ? "Toimitus aikaisintaan" : "Earliest delivery", value: f ? "ma 16.11., tilaa su 17.00 mennessä" : "Mon 16.11., order by Sun 17.00" },
          { label: f ? "Ruokavalio" : "Dietary", value: f ? "Vegaaninen, laktoositon" : "Vegan, lactose-free" },
          { label: f ? "Sisältää" : "Contains", value: f ? "Kauraa (gluteeni)" : "Oats (gluten)" },
          { label: f ? "Alkuperä" : "Origin", value: f ? "Suomi" : "Finland" },
        ]}
        add={{ label: f ? "Lisää tilaukseen" : "Add to the order", onClick: () => setAdded((a) => [...a, "p1"]), added: added.includes("p1") }}
      />
      {history}
      {standing}
      <DeliveryCard
        kind={f ? "Toimitus" : "Delivery"}
        title={f ? "Saapuu tänään 10–12" : "Arrives today 10–12"}
        detail={f ? "3 riviä, 124,80 €" : "3 lines, 124,80 €"}
        steps={[
          { label: f ? "Tilattu" : "Ordered", at: f ? "ma 9.02" : "Mon 9.02", state: "done" },
          { label: f ? "Pakattu" : "Packed", at: f ? "ke 16.40" : "Wed 16.40", state: "done" },
          { label: f ? "Matkalla" : "On its way", at: "7.15", state: "now" },
          { label: f ? "Perillä" : "Delivered", state: "next" },
        ]}
      />
      <MemoryList kind={f ? "Mitä agentti muistaa" : "What your agent remembers"} items={memory} onEdit={() => {}} onForget={(id) => setMemory((m) => m.filter((x) => x.id !== id))} />
    </>
  );
}

export function RulesDemo() {
  const { lang } = useLang();
  const f = lang === "fi";
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(500);
  const [saved, setSaved] = useState(500);
  const [done, setDone] = useState(false);
  const eur = (n: number) => `${n.toLocaleString("fi-FI")} €`;
  return (
    <>
      <RulesSheet
        kind={f ? "Sääntösi" : "Your rules"}
        onChange={(id) => {
          if (id === "limit") {
            setEditing(true);
            setDone(false);
          }
        }}
        rows={[
          { id: "limit", label: f ? "Agenttisi saa tilata yksin" : "Your agent may spend alone", value: f ? `${eur(saved)} / tilaus` : `${eur(saved)} per order`, detail: f ? "Sen yli Aino hyväksyy puhelimellaan" : "Above that, Aino OKs it on her phone" },
          { id: "budget", label: f ? "Viikkobudjetti" : "Weekly budget", value: eur(2500) },
          { id: "buy", label: f ? "Saa ostaa" : "May buy", value: f ? "Maitotuotteet, kasvijuomat, kuivatuotteet" : "Dairy, plant drinks, dry goods" },
          { id: "always", label: f ? "Aina" : "Always", value: f ? "Laktoositon" : "Lactose-free" },
          { id: "never", label: f ? "Ei koskaan" : "Never", value: f ? "Pähkinät" : "Nuts" },
          { id: "who", label: f ? "Rajan ylittävät hyväksyy" : "Who OKs above the limit", value: f ? "Aino Virtanen, keittiöpäällikkö" : "Aino Virtanen, kitchen manager" },
        ]}
      />
      {editing && (
        <RuleChange
          kind={f ? "Muuta sääntöä" : "Change a rule"}
          title={f ? "Paljonko agenttisi saa tilata yksin?" : "What may your agent spend alone?"}
          before={f ? `${eur(saved === limit && done ? 500 : saved)} / tilaus` : `${eur(saved === limit && done ? 500 : saved)} per order`}
          after={f ? `${eur(limit)} / tilaus` : `${eur(limit)} per order`}
          note={f ? `Enintään ${eur(limit)} tilaukset eivät enää kysy Ainolta.` : `Orders up to ${eur(limit)} will no longer ask Aino.`}
          changed={limit !== 500}
          done={done}
          confirm={f ? `Vahvista: ${eur(limit)} / tilaus` : `Confirm: ${eur(limit)} per order`}
          onConfirm={() => {
            setSaved(limit);
            setDone(true);
          }}
          onCancel={() => {
            setEditing(false);
            setLimit(saved);
          }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Stepper value={limit} onChange={setLimit} min={0} max={5000} step={50} less={f ? "50 € vähemmän" : "50 € less"} more={f ? "50 € enemmän" : "50 € more"} label={f ? "Raja euroina" : "Limit in euros"} size="lg">
              {f ? "€ / tilaus" : "€ per order"}
            </Stepper>
            <span className="flex gap-2">
              {[300, 800, 1000].map((v) => (
                <button key={v} type="button" onClick={() => setLimit(v)} className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-[0.86rem] font-medium tabular transition-colors duration-150 ${v === limit ? "border-petrol bg-petrol-soft text-petrol-deep" : "border-line-strong bg-paper hover:border-petrol hover:bg-petrol-soft"}`}>
                  {eur(v)}
                </button>
              ))}
            </span>
          </div>
        </RuleChange>
      )}
    </>
  );
}

export function SetupDemo({ start = 0 }: { start?: number }) {
  const { lang } = useLang();
  const f = lang === "fi";
  const [step, setStep] = useState(start);
  const [kindOf, setKindOf] = useState<string[]>([]);
  const [never, setNever] = useState<string[]>([]);
  const [limit, setLimit] = useState(500);
  const [budget, setBudget] = useState(2500);
  const of = 5;
  const q = f ? "Kysymys" : "A question";
  const eur = (n: number) => `${n.toLocaleString("fi-FI")} €`;
  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));
  let body: ReactNode;
  if (step === 0)
    body = (
      <SetupWelcome
        title={f ? "Tervetuloa. Laitetaan ostoagenttisi kuntoon." : "Welcome. Let's set up your buying agent."}
        lead={f ? "Agentti tilaa keittiösi puolesta, mutta vain sinun sääntöjesi rajoissa. Kysyn kolme asiaa." : "Your agent orders for your kitchen, but only inside rules you set. I'll ask three things."}
        points={[
          { title: f ? "Millainen keittiö" : "What kind of kitchen", why: f ? "jotta ehdotan oikeita tuotteita ja määriä" : "so I suggest the right products and amounts" },
          { title: f ? "Mitä ei koskaan saa tulla" : "What must never arrive", why: f ? "allergeenit ja ruokavaliot: nämä pitävät aina" : "allergens and diets: these always hold" },
          { title: f ? "Paljonko agentti saa käyttää" : "What the agent may spend", why: f ? "sen yli pyydän aina sinulta luvan" : "above that I always ask you first" },
        ]}
        time={f ? "Noin kaksi minuuttia. Kaiken voi muuttaa myöhemmin." : "About two minutes. You can change everything later."}
        start={f ? "Aloitetaan" : "Let's start"}
        onStart={next}
      />
    );
  else if (step === 1)
    body = (
      <SetupStep step={1} of={of} onBack={back}>
        <ChoiceAnswer
          kind={q}
          question={f ? "Millainen keittiö teillä on?" : "What kind of kitchen is yours?"}
          why={f ? "määrät ja tuotteet ovat erilaisia koulussa ja kahvilassa" : "a school and a cafe buy different things in different amounts"}
          choices={[
            { id: "restaurant", label: f ? "Ravintola" : "Restaurant" },
            { id: "cafe", label: f ? "Kahvila" : "Cafe" },
            { id: "hotel", label: f ? "Hotelli" : "Hotel" },
            { id: "school", label: f ? "Koulu tai päiväkoti" : "School or daycare" },
            { id: "care", label: f ? "Hoivakoti" : "Care home" },
            { id: "catering", label: f ? "Pitopalvelu" : "Catering" },
          ]}
          chosen={kindOf}
          onChoose={(id) => {
            setKindOf([id]);
            next();
          }}
        />
      </SetupStep>
    );
  else if (step === 2)
    body = (
      <SetupStep step={2} of={of} onBack={back} onNext={next} next={never.length ? undefined : f ? "Ei mitään näistä" : "None of these"}>
        <ChoiceAnswer
          kind={q}
          multiple
          question={f ? "Mitä keittiöön ei koskaan saa tulla?" : "What must never arrive in your kitchen?"}
          why={f ? "agentti ei voi tilata näitä, vaikka joku pyytäisi" : "your agent cannot order these, even if someone asks"}
          choices={[
            { id: "nuts", label: f ? "Pähkinät" : "Nuts" },
            { id: "peanut", label: f ? "Maapähkinä" : "Peanuts" },
            { id: "gluten", label: f ? "Gluteeni" : "Gluten" },
            { id: "lactose", label: f ? "Laktoosi" : "Lactose" },
            { id: "fish", label: f ? "Kala" : "Fish" },
            { id: "egg", label: f ? "Kananmuna" : "Egg" },
            { id: "sesame", label: f ? "Seesami" : "Sesame" },
            { id: "pork", label: f ? "Sianliha" : "Pork" },
          ]}
          chosen={never}
          onChoose={(id) => setNever((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]))}
        />
      </SetupStep>
    );
  else if (step === 3)
    body = (
      <SetupStep step={3} of={of} onBack={back}>
        <AmountAnswer
          kind={q}
          question={f ? "Paljonko agentti saa tilata kerralla kysymättä?" : "How much may your agent order at once without asking?"}
          why={f ? "sen yli tilaus odottaa hyväksyntääsi puhelimessa" : "above that, the order waits for your OK on your phone"}
          value={limit}
          onChange={setLimit}
          unit={f ? "€ / tilaus" : "€ per order"}
          step={50}
          min={0}
          max={5000}
          presets={[
            { value: 200, label: "200 €" },
            { value: 500, label: "500 €" },
            { value: 1000, label: "1 000 €" },
          ]}
          confirm={f ? `${eur(limit)} sopii` : `${eur(limit)} is right`}
          onConfirm={next}
        />
      </SetupStep>
    );
  else if (step === 4)
    body = (
      <SetupStep step={4} of={of} onBack={back}>
        <AmountAnswer
          kind={q}
          question={f ? "Entä viikossa enintään?" : "And at most in a week?"}
          why={f ? "tämän yli agentti ei tilaa, kysyi kuka tahansa" : "past this the agent does not order, whoever asks"}
          value={budget}
          onChange={setBudget}
          unit={f ? "€ / viikko" : "€ per week"}
          step={100}
          min={0}
          max={50000}
          presets={[
            { value: 1000, label: "1 000 €" },
            { value: 2500, label: "2 500 €" },
            { value: 5000, label: "5 000 €" },
          ]}
          confirm={f ? `${eur(budget)} sopii` : `${eur(budget)} is right`}
          onConfirm={next}
        />
      </SetupStep>
    );
  else if (step === 5)
    body = (
      <SetupStep step={5} of={of} onBack={back}>
        <RulesSheet
          kind={f ? "Sääntösi" : "Your rules"}
          title={f ? "Nämä ovat sääntösi" : "These are your rules"}
          rows={[
            { id: "limit", label: f ? "Agenttisi saa tilata yksin" : "Your agent may spend alone", value: f ? `${eur(limit)} / tilaus` : `${eur(limit)} per order`, detail: f ? "Sen yli sinä hyväksyt" : "Above that, you OK it" },
            { id: "budget", label: f ? "Viikossa enintään" : "At most in a week", value: eur(budget) },
            { id: "never", label: f ? "Ei koskaan" : "Never", value: never.length ? never.join(", ") : f ? "Ei rajoituksia" : "No restrictions" },
          ]}
          footer={
            <button type="button" onClick={next} className="mt-1 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-lime px-5 text-[1rem] font-semibold text-ink transition-colors hover:bg-lime-hover">
              {f ? "Vahvista ja lisää tämä laite hyväksyjäksi" : "Confirm, and add this device to OK orders"}
            </button>
          }
        />
      </SetupStep>
    );
  else
    body = (
      <SetupDone
        title={f ? "Valmista. Agenttisi on käytössä." : "Done. Your agent is ready."}
        lines={[f ? `Tilaa yksin enintään ${eur(limit)}; sen yli kysyy sinulta.` : `Orders up to ${eur(limit)} alone; above that it asks you.`, f ? "Tämä laite hyväksyy tilaukset Face ID:llä tai sormenjäljellä." : "This device OKs orders with Face ID or a fingerprint.", f ? "Sääntöjä voi muuttaa milloin vain: sano \"muuta sääntöjä\"." : "Change your rules any time: say \"change my rules\"."]}
        start={f ? "Tee ensimmäinen tilaus" : "Make your first order"}
        onStart={() => setStep(0)}
      />
    );
  return <>{body}</>;
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[0.82rem] font-medium text-ink-soft">{title}</p>
      <div className="space-y-3 rounded-2xl bg-lavender p-3 sm:p-4">{children}</div>
    </div>
  );
}

export function MoreWidgetsDemo() {
  return (
    <section>
      <h2 className="display text-[1.6rem]">Showing things, your rules, setting up</h2>
      <p className="mt-1 max-w-[70ch] text-[0.95rem] text-ink-soft">Short lists in a card, one action per row, the editor one tap away. Live on sample data.</p>
      <div className="mt-5 grid items-start gap-6 lg:grid-cols-2">
        <Frame title="Showing things: search results, a product, history, standing orders, a delivery, memory">
          <ShowingDemo />
        </Frame>
        <div className="space-y-6">
          <Frame title="Your rules, and changing one (press Change on the first row)">
            <RulesDemo />
          </Frame>
          <Frame title="The set-up interview: the first screen, then one question at a time">
            <SetupDemo />
          </Frame>
        </div>
      </div>
    </section>
  );
}
