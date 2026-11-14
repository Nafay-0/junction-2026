"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { LangSwitch, useLang } from "../../_i18n/provider";
import { AgentTurn, BuyerTurn, Composer, Thread, ThreadDock, type DockSize } from "../../_ui/thread";
import { RulesDemo, SetupDemo, ShowingDemo } from "../gallery-more";
import { HomeDemo, useMenuDemo, useOrderDemo } from "../gallery-widgets";

type View = "home" | "order" | "compare" | "menu" | "history" | "standing" | "results" | "rules" | "setup";

/** A stand-in shop behind the agent, so the dock and the workspace are seen where they live. */
function FakeShop() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6 sm:px-6" aria-hidden>
      <div className="h-10 w-48 rounded-full bg-paper" />
      <div className="h-56 rounded-2xl bg-petrol-deep/90" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-44 rounded-xl border border-line bg-paper" />
        ))}
      </div>
    </div>
  );
}

export function WorkspaceDemo() {
  const q = useSearchParams();
  const { lang } = useLang();
  const f = lang === "fi";
  const view = (q.get("view") as View) ?? "home";
  const [size, setSize] = useState<DockSize>(q.get("size") === "workspace" ? "workspace" : "dock");
  const [draft, setDraft] = useState("");
  const order = useOrderDemo();
  const menu = useMenuDemo(q.get("plan") === "forming" ? "forming" : "proposals");
  const [stageOpen, setStageOpen] = useState(view === "compare" || view === "menu");

  const stage = !stageOpen ? undefined : view === "compare" || order.swapping ? order.picker : view === "menu" ? (menu.chosen ? menu.sheet : menu.proposals) : undefined;
  const stageTitle = view === "menu" && !order.swapping ? (f ? "Lounas 40 hengelle" : "Lunch for 40") : f ? "Vertaa vaihtoehtoja" : "Compare alternatives";

  return (
    <div className="min-h-dvh bg-mist xl:pr-[34rem] 2xl:pr-[38rem]">
      <div className="flex justify-end px-4 pt-3">
        <LangSwitch />
      </div>
      <FakeShop />
      <ThreadDock
        open
        onClose={() => {}}
        name={f ? "Ostoagentti" : "Hotel Lumo's buyer agent"}
        sub={f ? "Tilaa keittiön sääntöjen mukaan." : "Orders within your kitchen's rules."}
        label={f ? "Agentti" : "Agent"}
        size={size}
        onSize={setSize}
        stage={stage ?? (order.swapping ? order.picker : undefined)}
        stageTitle={stageTitle}
        onStageClose={() => {
          setStageOpen(false);
          order.closeSwap();
        }}
        footer={<Composer value={draft} onChange={setDraft} onSubmit={() => setDraft("")} placeholder={f ? "Kerro, mitä keittiö tarvitsee" : "Tell the agent what the kitchen needs"} label={f ? "Viesti agentille" : "Message to the agent"} />}
      >
        {view === "home" ? (
          <HomeDemo composer={false} />
        ) : view === "setup" ? (
          <SetupDemo start={Number(q.get("step") ?? 0)} />
        ) : view === "history" || view === "standing" || view === "results" || view === "rules" ? (
          <Thread label={f ? "Keskustelu" : "Conversation"}>
            <BuyerTurn time="14.02">{view === "history" ? (f ? "Mitä tilasimme viime viikolla?" : "What did we order last week?") : view === "standing" ? (f ? "Näytä kestotilaukset" : "Show my standing orders") : view === "results" ? (f ? "Mitä kauratuotteita teillä on?" : "What oat products do you have?") : f ? "Mitä agentti saa tehdä?" : "What may my agent do?"}</BuyerTurn>
            <AgentTurn>{view === "rules" ? <RulesDemo /> : <ShowingDemo only={view} />}</AgentTurn>
          </Thread>
        ) : (
          <Thread label={f ? "Keskustelu" : "Conversation"}>
            <BuyerTurn time="14.02">{view === "menu" ? (f ? "Suunnittele lounas 40 hengelle punajuuren ympärille torstaiksi" : "Plan a lunch for 40 around beetroot for Thursday") : f ? "1000 litraa laktoositonta maitoa maanantaiksi ja kauramaitoa kahviin" : "1,000 litres of lactose-free milk for Monday, and oat drink for the coffee"}</BuyerTurn>
            <AgentTurn text={view === "menu" ? (f ? "Kolme ehdotusta sääntöjesi mukaan. Valitse yksi, niin lasken raaka-aineet." : "Three ideas inside your rules. Pick one and I work out the ingredients.") : f ? "Tässä tilauksesi. Halvin, joka ehtii maanantaiksi." : "Here is your order: the cheapest that arrives Monday."}>
              {view === "menu" ? (
                <button type="button" onClick={() => setStageOpen(true)} className="rounded-xl border border-line bg-paper px-4 py-3 text-left text-[0.95rem] font-medium text-petrol">
                  {f ? "Avaa menu" : "Open the menu"}
                </button>
              ) : (
                order.sheet
              )}
            </AgentTurn>
          </Thread>
        )}
      </ThreadDock>
    </div>
  );
}
