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

## 3. Tokens (`src/app/globals.css`, Tailwind 4 `@theme`)

Use the Tailwind names (`bg-petrol`, `text-ink-soft`, `border-line`) or the CSS variables (`var(--color-petrol)`).

| Group | Tokens |
|---|---|
| Structure | `petrol` #005670, `petrol-deep` #003646, `petrol-soft` #D5E6EB (selected rows, a value that just changed) |
| Text | `ink` #23282D, `ink-soft` #55616B (passes 4.5:1 on white, mist and lavender) |
| Grounds | `mist` #F2F7F8 (page), `paper` #FFFFFF (documents, tiles), `line` #C9D6DB (hairlines) |
| Action | `lime` #C0E021, `lime-hover` #AED01A, text on lime is `ink` |
| The agent | `lavender` #EEE8F5 (ground), `lavender-deep` #5B4A7A (marks and text on lavender) |
| Temperature | `chilled` #2B8C9E, `frozen` #4F67B5, `ambient` #A97E36, always with `TempGlyph` and the word |
| The gate | `safety` #FFC20E, `safety-ink` #1A1D21, utilities `.hazard`, `.hazard-thin`, `.hazard-frame` |
| Dark (wall, ops today) | `steel`, `steel-2`, `steel-3`, `chalk`, `chalk-soft`: kept until those surfaces move to `petrol-deep` |
| Old names | `concrete` = mist, `concrete-deep` = a quiet fill; kept so older screens keep working |

Motion utilities, each disabled under `prefers-reduced-motion`: `.lane-enter` (a stage arrives), `.barrier-left` /
`.barrier-right` (the gate closes), `.stamp` (a sign-off lands), `.breathe` (waiting for a person), `.changed` (a
value just changed: a brief petrol wash), `.spin` (working). Focus: a 3 px petrol outline, lime on dark grounds
(add `on-dark` to the dark container).

## 4. Type

Two families, both OFL, loaded in `app/layout.tsx`: **Barlow Condensed** (display, weight 800 through the `.display`
class) and **Barlow** (everything people read, 400 to 700). Sentence case everywhere. No tracked capitals, no
monospace except code a developer copies (the MCP config on Agent and rules).

| Role | Class | Size |
|---|---|---|
| Page title | `display` | 2.6 to 3 rem (3.8 rem in a hero) |
| Section title | `display` (`SectionTitle`) | 1.75 rem |
| Stage title on the lane | `display` | 1.55 to 1.75 rem |
| Money and big numbers | `display tabular` | 2 to 3.4 rem |
| Body | Barlow | 1 to 1.08 rem, leading-snug, lines under 75 characters |
| Labels on fields | Barlow 500 | 0.8 rem, `text-ink-soft` |

Numbers: `num`, `money`, `moneyShort`, `measure` in `_ui/plain.ts` write Finnish conventions ("1 280,50 €",
"2,5 kg", no-break spaces). `say(text, names)` is `humanize` plus Finnish money for sentences the API wrote. Dates
stay `day()` ("Mon 16.11.") and `clock()` ("14.05"), Helsinki time. Never put an id, a rule code or a raw timestamp
on the main surface; put them behind "Show details".

## 5. Components (`src/app/_ui/`)

- `kit.tsx`: `Button` (kinds `go` lime, `primary` petrol, `secondary` petrol outline, `quiet` link, `dark`,
  `ghost-dark` on dark grounds, `safety` for the gate only; sizes `sm`, `md`, `lg`), `buttonClass()` for links that
  look like buttons, `Plate` (document with a petrol rule; tone `agent` lavender, tone `gate` hazard band), `Field`,
  `Missing` ("No data", never blank), `Tag`, `SectionTitle`, `ErrorPlate` (what happened, how to fix it), `Empty`
  (an empty state is a direction), `AgentNote`, `Spinner`, `Working`, `Skeleton`, `Kbd`.
- `glyphs.tsx`: drawn pack glyphs (carton, bag-in-box, tub, block, sack, bottle, canister, case, bag, can) and
  department glyphs, `TempGlyph`, `DEPARTMENT_GLYPH`.
- `phone.tsx`: `PhoneShell` (one column, demo note at the foot; tone `gate` adds the hazard band), `GateHead` (the
  black slab with the mark, for a phone), `bigButton()`, `PhoneNotice`, `PhoneProblem`.
- `target.tsx`: the crash-test mark. Use it only at the gate: a stopped order, a refusal, a sign-off.
- The order lane (`k/[kitchen]/ui.tsx`): `StationStrip` (seven stations, compact on phones), `Lane` (current stage
  open, earlier ones one line each), `useFollowLane`. Stage cards are in `k/[kitchen]/stages.tsx`; `Gate` and
  `SignOff` are the loud moment and the hand-off.

## 6. Images

None are generated. The brief allowed a small set of original images from Google's image model (department headers,
hero and empty states, in the manner of food photography on a dark petrol ground). The Gemini key on this machine is
on the free tier, where every image model (`gemini-nano-banana-2.1`, `gemini-3.1-flash-image`,
`gemini-3.1-flash-lite-image`, `gemini-2.5-flash-image`) has a quota of zero; spend was 0. Instead the pack is the
picture: drawn line glyphs on a tinted plate, with the pack content set large, and department plates in petrol-deep.
If images are added later: original only, no brand packaging or logos, compressed WebP under 120 kB, on a petrol
ground, and say here that they are generated.

## 7. Do and do not

Do
- Put one lime button in view: the thing the page is for (Add to basket, Place the order, Approve, Send).
- Use lavender for anything the agent remembered, inferred or said, so a buyer can see what came from memory.
- Show the kitchen's units next to the sales unit: "3 cases = 30 L".
- Say what is missing ("No data", "not confirmed by the wholesaler"); unknown is never shown as absent.
- Give every empty state a next step ("Nothing is waiting for you; your next cut-off is Sun 17.00").
- Keep the demo note (`DEMO_NOTE`) on every page.

Do not
- Use yellow, hazard stripes or the crash-test mark anywhere but the gate and sign-off. Not for warnings, not for
  "new", not for low confidence (use lavender), not for decoration.
- Round corners (the phone drawing around a QR code is the one exception: it depicts a phone).
- Add drop shadows, gradients or decorative images that carry no information.
- Write all caps labels, middle-dot meta strings, arrows on links, or numbered markers on things that are not a
  sequence.
- Copy the partner's logo, wordmark, artwork, photographs or page layouts.

## 8. For the operations portal and the wall

- The portal is the wholesaler's own desk: use `petrol-deep` as its dark ground instead of `steel`, `paper` for
  documents (an order, a trace step), `mist` for the page if it goes light. The wall can stay dark: `petrol-deep`
  ground, `paper` text, lime for the one live counter, `safety` and the mark only for a stopped or refused order.
- Reuse `Plate`, `Tag`, `Field`, `Button`, `SectionTitle`, `ErrorPlate`, `Empty` from `_ui/kit.tsx`, and
  `money`/`say` from `_ui/plain.ts` so euros look the same on both sides (the ops screens still call `eur()`).
- The gate's look is shared: a stopped order is the black slab in a hazard frame (`.hazard-frame` with `on-dark`),
  the mark, the rule titles from `ruleTitle()`; a passed order is a quiet white plate with a petrol check.
- Lavender means "the kitchen's agent or its memory": use it on the ops memory view for kitchen-held items.
- Tables: `bg-paper` with a 3 px petrol rule on top, `divide-line` rows, `text-ink-soft` headers in sentence case,
  money right-aligned and `tabular`.
- The tokens `concrete`, `ink`, `ink-soft` changed value (to mist and the partner's charcoal), so existing ops screens
  already shifted slightly; nothing else in them was touched.
