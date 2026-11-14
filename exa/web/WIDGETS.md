# Building widgets

A widget is a React component that renders one tool result from the agent: a map of places, a flight list, a stock chart. The product is judged on how professional, live and responsive these feel, so each one should look like it shipped from a design-led company (think Linear, Arc, Perplexity, Airbnb), not like a hackathon card.

## Read first

- `src/lib/widgets/types.ts`: the data contract. Your component receives exactly the type named for it. Do not change this file; if a field is missing, say so in your final report.
- `src/components/widgets/frame.tsx`: `WidgetFrame`, `SourceChips`, `SourceList`, `Favicon`, `Shimmer`, `LiveDot`, `WidgetError`, `formatMoney`, `formatDate`. Every widget is wrapped in `WidgetFrame`.
- `src/app/globals.css`: the design tokens. Read the comment at the top.
- `AGENTS.md`: this is Next.js 16 with React 19 and Tailwind CSS 4; APIs differ from older versions. Docs are in `node_modules/next/dist/docs/`.
- `src/components/ui/`: shadcn/ui primitives already installed (button, badge, tabs, dialog, drawer, popover, tooltip, scroll-area, select, switch, skeleton, separator, collapsible, dropdown-menu, sheet, card, input, textarea, avatar). Import `cn` from `@/lib/utils`.

## Contract for every widget

```tsx
"use client";
import type { WidgetProps, PlacesData } from "@/lib/widgets/types";

export function PlacesMap({ data, loading }: WidgetProps<PlacesData>) { ... }
```

- One file per widget in `src/components/widgets/`, a named export, `"use client"` at the top.
- `loading` is true while the tool is still running. `data` may then be partial: arrays can be empty and optional fields missing. Render a skeleton shaped like the final layout (use `Shimmer`), pass `loading` and `data.stage` to `WidgetFrame`, and render whatever real data has already arrived. Never crash on missing data.
- If `data.error` is set, render `<WidgetError message={data.error} />` inside the frame.
- Always pass `data.sources` to `WidgetFrame` so the reader can see where the data came from. This is a judging criterion.
- Also write `src/lib/widgets/fixtures/<widget-file-name>.ts` exporting two typed constants: a realistic, fully populated sample (real-looking names, Helsinki/Finland or well-known global examples, working image URLs from a stable public host such as images.unsplash.com or upload.wikimedia.org) and a loading sample (`stage` set, little or no data). Name them `<name>Fixture` and `<name>LoadingFixture`. A gallery page imports these.

## Design system ("Concierge")

- **Colour:** only tokens, never hex. Surfaces: `bg-background`, `bg-card`, `bg-surface`, `bg-muted`. Text: `text-foreground`, `text-muted-foreground`, `text-subtle`. Accent: `text-brand`, `bg-brand`, `bg-brand-soft`, `bg-primary text-primary-foreground` for the main button. Small highlight: `text-brass`. Gains and losses: `text-up`, `text-down`. Borders: `border-border`, or the `hairline` utility. Charts: `var(--chart-1)` to `var(--chart-5)`, `var(--up)`, `var(--down)`, `var(--border)`, `var(--muted-foreground)`. Light and dark themes both have to look right; the `.dark` class is on `<html>`.
- **Type:** Geist for the interface (default). `font-display` (a serif) only for a large headline number or title inside a widget, sparingly. Add the `nums` class to prices, odds, times and counters. Sizes: widget title 0.95rem medium (the frame does this), body 0.85 to 0.9rem, meta 0.72 to 0.8rem in `text-muted-foreground`.
- **Shape:** the frame is `rounded-2xl`; inner cards `rounded-xl`; chips and badges `rounded-full`. Shadows: `shadow-card`, `shadow-float` for things that lift.
- **Space:** generous but dense enough to be useful. Align to a 4px grid. Let the main number or image breathe.
- **Motion:** import from `motion/react`. Stagger list items in (opacity + 6 to 8px rise, 250 to 400ms, ease-out), animate layout changes, count numbers up or cross-fade them when they change. Hover states on anything clickable. Keep it calm: no bounces, nothing longer than 500ms. CSS helpers exist: `animate-rise`, `animate-fade`, `animate-pulse-dot`, `shimmer`, `text-shimmer`.
- **Responsive:** must look deliberate at 360px wide and at 760px (the chat column's maximum). No horizontal page scroll. Inside a widget, a horizontal snap-scroll strip is fine on small screens. Touch targets at least 40px.
- **Images:** plain `<img>` with `loading="lazy"`, `referrerPolicy="no-referrer"`, `alt`, and an `onError` fallback (hide the image or show a neutral placeholder). Do not use `next/image`; the hosts are not known in advance.
- **Links:** external links open in a new tab with `rel="noreferrer"`.
- **Icons:** `lucide-react`.
- **Accessibility:** real buttons and links, visible focus, `aria-label` on icon-only controls, keyboard support for anything interactive.
- **Copy:** short, plain, sentence case. No exclamation marks, no emoji.

## What "live and responsive" means here

Widgets are not static cards. Where it fits, add the interactions a person would expect from the real product: sort and filter toggles, select-to-highlight, hover that links a list item to its marker or chart line, an expand-to-full view, tooltips on chart hover, copy buttons, deep links (maps directions, `tel:`, booking pages). Prefer two or three interactions done well over many done roughly.

## Checks before you finish

- `pnpm exec tsc --noEmit` passes for your files. Other people are editing other files at the same time: fix only errors in files you own, and do not edit files you do not own (ask in your report instead).
- `pnpm exec eslint <your files>` is clean.
- Do not start the dev server and do not run `next build`; another process may be using them. Do not install packages without saying so in your report (already installed: `motion`, `recharts`, `maplibre-gl`, `react-map-gl`, `streamdown`, `lucide-react`, `next-themes`, `sonner`, `vaul`).
- Do not commit. Final report: files written, any type you needed that was missing, anything you could not verify.
