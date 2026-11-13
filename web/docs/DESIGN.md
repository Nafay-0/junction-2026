# Dock design system

The customer side of Dock (the kitchen store under `/k/**`, the menu planner, the phone pages) and the system the
operations portal (`/ops/**`) and the wall (`/`) should adopt. Tokens live in `src/app/globals.css`; components in
`src/app/_ui/`. This file is the contract: if you add a surface, use these and nothing else.

## 1. The idea in one paragraph

A wholesaler's webshop for professional kitchens, in the wholesaler's own world (petrol blue, white, charcoal, a
sharp lime for the one thing to do, square corners, a heavy condensed display face), with the kitchen's purchasing
agent living inside it. The shop is calm. **The gate is loud**: warning-sign yellow, black hazard striping and the
quartered crash-test mark appear only where a rule stops an order or a named person must decide. Nothing else on
the customer side uses them, so when they appear a viewer across the room knows what happened.

This is a demo built for the Junction 2026 challenge on synthetic data. It borrows the partner's palette, geometry
and tone; it does not copy their logo, wordmark, artwork, photographs or page layouts, and the demo note stays
visible on every store page (`DEMO_NOTE` in `_ui/brand.ts`).

## 2. Plan, and the review against generic defaults

**Colour, five working values plus the gate's pair.**

| Token | Hex | Role |
|---|---|---|
| `petrol` | `#005670` | Structure: the navigation band, links, active states, document rules, secondary buttons |
| `petrol-deep` | `#003646` | Dark grounds: demo strip, department plates, the order lane's current station, the assistant header |
| `ink` | `#23282D` | Text on light |
| `lime` | `#C0E021` | The one main action per view (Add to basket, Place the order, Send). Text on lime is `ink` (11:1) |
| `mist` | `#F2F7F8` | The page ground; quiet fills |
| `lavender` | `#EEE8F5` | The agent's tint: anything the agent remembered, inferred or wrote sits on lavender |
| `paper` | `#FFFFFF` | Documents and tiles |
| `safety` | `#FFC20E` | Gate only: a person must decide, or a rule refused |
| `ink` + `safety` hazard | stripes | Gate only, as a band or a frame |

Temperature is a quiet code, never a fill behind text: chilled `#2B8C9E` (cold water), frozen `#4F67B5` (ice),
ambient `#A97E36` (grain), each with a small glyph so colour is never the only signal.

**Type: Barlow Condensed (display) and Barlow (text), kept deliberately.** Both are drawn from road and highway
signage, which is the voice of a loading dock; the condensed cut at 700/800 carries the partner's "heavy condensed
headline" register, and Barlow is a plain, friendly grotesque for reading. They are free (OFL) and already loaded,
so there is no second download. Sentence case everywhere; no tracked capitals.

**Layout concept.** A webshop shell (utility row with the kitchen and a big catalogue search, a petrol navigation
band, a mist page) with the agent docked on the right as a lavender panel on wide screens and a sheet on phones.
Content is left-aligned on a 12-column grid, max 1440 px wide.

```
 demo note (petrol-deep, one line)
 ┌──────────────────────────────────────────────────────────────┬───────────────┐
 │ ◐ Dock   Ravintola Kaari ▾        [ search 17 546 products ] │ Agent  ⌘K     │
 │          deliveries Mon–Fri       [Ask the agent ⌘K] [Basket 3  412,00 €]   │ (lavender)    │
 ├──────────────────────────────────────────────────────────────┤               │
 │ Home  Order  Catalogue  Menu planner  Orders  Agent and rules│  answers,     │
 │ (petrol band, active item: lime underline)  [▨ 1 waiting]   │  citations    │
 ├──────────────────────────────────────────────────────────────┤               │
 │ mist page                                                     │  [field][Send]│
 └──────────────────────────────────────────────────────────────┴───────────────┘
```

**The order lane.** The stages are a real sequence, so they are numbered and shown as a lane. A station strip
across the top (readable from across a table) and the stages below it; the current stage is open, earlier ones
collapse to one line each and can be reopened.

```
  Request ─ Lookup ─ Options ─ Price ─ [ GATE ] ─ Sign-off ─ Order        (strip; current = filled)
  ●  1 Request   “100 L lactose-free milk for Thursday”  100 L, Thu 19.11.        Open
  │
  ●  2 Lookup    Nothing unusual; 2 answers from memory                           Open
  │
  ◉  3 Options   ┌ Good ──────┐┌ Better ────┐┌ Best ──────┐   [Compare side by side]
  ┆              │ 128,40 €   ││ 131,31 €   ││ 140,00 €   │
  ┆              └────────────┘└────────────┘└────────────┘
  ○  4 Price
  ○  5 Gate         ← when it stops: full-width black slab, hazard frame, the mark, barrier closes
  ○  6 Sign-off     ← phone frame with the QR, the named person, a running clock
  ○  7 Order
```

**A product tile (no photographs in the data).** The pack is the picture: a pale plate with a drawn pack glyph
(carton, tub, sack, bottle, box) and the pack content set large, so "10 L" or "2,5 kg" reads before the name.

```
 ┌───────────────────────────┐
 │ ❄ Chilled           Valio │  temperature glyph + word, brand
 │ ┌───────────────────────┐ │
 │ │  ▯   10 L             │ │  pack plate: glyph, content in display type
 │ └───────────────────────┘ │
 │ Valio skimmed milk 10 l   │
 │ 1 case = 10 L, Finland    │
 │ Lactose-free  Organic     │  claims as outlined labels
 │───────────────────────────│
 │ 1,40 €/piece   [− 1 +][Add]│  price after a live check, else "Price when opened"
 └───────────────────────────┘
```

**Principles.**
1. The shop is calm; the gate is loud. Yellow and black only at the gate and sign-off.
2. Lime means "do it": at most one lime button in view.
3. Lavender means the agent. If the agent remembered or inferred it, it sits on lavender.
4. Square and flat. No radius (the round mark is the only circle), no drop shadows except the docked panel.
5. Every number in the kitchen's units: "3 cases = 30 L", euros with a comma, Helsinki time.
6. Motion only to show a change: a stage moving on, the barrier closing, a sign-off landing.

**Review against the generic defaults, and what changed.**
- *Near-black ground with one acid accent*: not used; the ground is white and mist, and lime is the partner's own
  call-to-action colour, rationed to one per view.
- *Broadsheet hairlines with zero radius*: square corners are the partner's geometry, but I dropped the dense
  ruled-column idea from my first sketch; documents are white plates on mist with a single petrol top rule.
- *SaaS card kit*: the first plan put Home's figures in four equal tiles. Revised to a ledger row (period, litres,
  kilograms, euros) over a weekly bar strip, so it reads as the kitchen's own book, not a dashboard template.
- *Tracked capitals, middle-dot meta strings, mono labels, arrows on links*: removed from the phone pages ("DOCK
  DEMO" eyebrow) and the gate (mono rule codes); meta text uses commas.
- *Numbered markers*: kept only on the order lane, which is a true sequence.
- First plan used one generated photograph per department. The Gemini key on this machine is on the free tier,
  where image models have a quota of zero, so no image was generated (spend: 0). Departments use a drawn pack
  glyph on a petrol-deep plate instead; see §6.
