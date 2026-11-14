"use client";

import * as React from "react";
import { motion } from "motion/react";
import { ArrowUpRight, ChartCandlestick, Microscope, MousePointerClick, Plane, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { useClientValue } from "@/lib/use-client";

type Preset = { icon: React.ReactNode; title: string; hint: string; prompt: (place: string) => string };

const city = (place: string) => place.split(",")[0]?.trim() || "Helsinki";

/** One-tap real cases. Each one exercises a different widget, and all of them need the live web. */
const PRESETS: Preset[] = [
  {
    icon: <UtensilsCrossed />,
    title: "Plan a dinner",
    hint: "Places on a map, hours, the weather, a booking link",
    prompt: (p) => `Find a cosy restaurant with good vegan options in central ${city(p)} for an anniversary dinner this Saturday evening, and check the weather for the walk there.`,
  },
  {
    icon: <Plane />,
    title: "Book a trip",
    hint: "Live fares and hotel rates, side by side",
    prompt: (p) => `Find flights from ${city(p)} to London for 5 to 8 December for one adult, and a well-rated hotel near Soho under 220 euros a night.`,
  },
  {
    icon: <ShoppingBag />,
    title: "Pick a product",
    hint: "Prices, specs and a verdict",
    prompt: () => "Which noise-cancelling over-ear headphones should I buy for under 300 euros? Compare the best three or four.",
  },
  {
    icon: <ChartCandlestick />,
    title: "Follow a market",
    hint: "Live prices and odds that keep updating",
    prompt: () => "How is NVIDIA trading today, and what do prediction markets say about who wins the 2028 US presidential election?",
  },
  {
    icon: <Microscope />,
    title: "Research a decision",
    hint: "A team of sub-agents, a sourced report",
    prompt: () => "I moved to Finland as a non-EU master's student in August 2024 and work part-time. Which rule changes since then affect me, and what should I do about each?",
  },
  {
    icon: <MousePointerClick />,
    title: "Do it for me",
    hint: "Watch it work in a live browser, up to the step that is yours",
    prompt: () => "Put a Bialetti Moka Express for 6 cups in the basket at a Finnish online shop that has it in stock, and take me to the checkout.",
  },
];

function greeting(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Welcome({ place, onPick }: { place: string; onPick: (prompt: string) => void }) {
  // The hour is only known in the browser, so the greeting appears after hydration.
  const hour = useClientValue(() => new Date().getHours(), -1);
  const hello = hour >= 0 ? greeting(hour) : null;

  return (
    // Sized to the chat column: beside the live browser it is narrow even on a wide screen.
    <div className="mx-auto flex w-full max-w-[760px] flex-col px-4 pt-[6vh] pb-6 @min-[440px]/chat:pt-[8vh] @min-[640px]/chat:pt-[12vh]">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}>
        <p className="text-[0.74rem] font-medium tracking-[0.14em] text-brand uppercase @min-[440px]/chat:text-[0.8rem]">{APP_NAME}, your internet butler</p>
        <h1 className="font-display mt-3 text-[2.05rem] leading-[1.07] text-balance @min-[440px]/chat:text-[2.6rem] @min-[640px]/chat:text-[3.6rem] @min-[640px]/chat:leading-[1.05]">
          <span className={hello ? "opacity-100 transition-opacity duration-500" : "opacity-0"}>{hello ?? "Good evening"}.</span>
          <br />
          <span className="text-muted-foreground italic">What can I take off your hands?</span>
        </h1>
        <p className="mt-4 max-w-[34rem] text-[0.9rem] leading-relaxed text-muted-foreground @min-[440px]/chat:mt-5 @min-[440px]/chat:text-[0.95rem]">
          Pass me a task. I search the live web with Exa, show what I find as maps, charts and cards you can use, and do the work in a live browser you can watch. The last step comes back to you.
        </p>
      </motion.div>

      {/* Narrow column: two columns of small chips, name only. Wider: tiles with a line of explanation, two then three across. */}
      <div className="mt-6 grid grid-cols-2 gap-2 @min-[440px]/chat:mt-9 @min-[440px]/chat:gap-2.5 @min-[640px]/chat:mt-11 @min-[640px]/chat:grid-cols-3">
        {PRESETS.map((preset, i) => (
          <motion.button
            key={preset.title}
            type="button"
            title={preset.hint}
            onClick={() => onPick(preset.prompt(place))}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.12 + i * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
            className="group/preset relative flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card/70 p-2.5 text-left shadow-card backdrop-blur-sm transition-[border-color,transform,background-color] duration-200 hover:-translate-y-0.5 hover:border-ring/50 hover:bg-card @min-[440px]/chat:flex-col @min-[440px]/chat:items-start @min-[440px]/chat:gap-2 @min-[440px]/chat:rounded-2xl @min-[440px]/chat:p-4"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand @min-[440px]/chat:size-8 [&_svg]:size-4">{preset.icon}</span>
            <span className="min-w-0 text-[0.84rem] leading-tight font-medium tracking-tight @min-[440px]/chat:text-[0.95rem] @min-[440px]/chat:leading-normal">{preset.title}</span>
            <span className="hidden text-[0.8rem] leading-snug text-muted-foreground @min-[440px]/chat:block">{preset.hint}</span>
            <ArrowUpRight className="absolute top-4 right-4 hidden size-4 text-subtle opacity-0 transition-[opacity,transform] duration-200 group-hover/preset:translate-x-0.5 group-hover/preset:-translate-y-0.5 group-hover/preset:opacity-100 @min-[440px]/chat:block" />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
