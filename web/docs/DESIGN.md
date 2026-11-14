# AimoPilot design system

The customer side of AimoPilot (the kitchen store under `/k/**`, the menu planner, the phone pages) and the system the
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
 │ ▣ AimoPilot  Ravintola Kaari ▾      [ search 17 546 products ] │ Agent  ⌘K     │
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

**A product tile (no photographs in the data).** A generated illustration of the kind of product (marked
"Illustration"), with the pack content set large on a paper badge, so "10 L" or "2,5 kg" reads before the name.
Where there is no picture, the drawn pack glyph on a pale plate (see §6).

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
- First plan used one generated photograph per department; the Gemini key had no image quota. The images were later
  made with OpenAI's image model instead; see §6.

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
- `wordmark.tsx`: the product's sign. `Wordmark` (tone `petrol` on light grounds, `paper` on petrol-deep) and
  `PilotLight` (the lamp alone). The pilot light is the indicator lamp on a control panel that says a system is on
  and supervised: a lime square in a square petrol-deep bezel, then "AimoPilot" in Barlow Condensed 800 with a hair of
  negative tracking. One weight for the whole name, no colour split. The app icon (`app/icon.svg`) is the lamp.
- `target.tsx`: the crash-test mark. It is the gate's symbol, not the product's: use it only at the gate (a stopped
  order, a refusal, a sign-off), never beside the name.
- The order lane (`k/[kitchen]/ui.tsx`): `StationStrip` (seven stations, compact on phones), `Lane` (current stage
  open, earlier ones one line each), `useFollowLane`. Stage cards are in `k/[kitchen]/stages.tsx`; `Gate` and
  `SignOff` are the loud moment and the hand-off.

## 6. Images

**The pictures are generated, not photographs of the products.** The partner's data has no product photographs, so a
small set of original images was made with OpenAI's image model (`gpt-image-2.6-flare`, medium quality, November
2026; 95 generations, $3.98 in all, logged in `scripts/art/spend.json`):

- `hero` (the kitchen picker) and `home` (the Home hero): 1536 x 864.
- One header per catalogue department, `dept-<id>` (17; Household 30 and 32 share one): 1536 x 864, subject weighted
  right so the department's name sits on the quiet left.
- 71 tiles by kind and variant of product, `tile-<kind>` (see "Variety" below): 1024 x 1024.

**One art direction for all of them** (`scripts/art/prompts.json`, the shared `style` and `negative` clauses):
calm still life on a deep petrol ground and backdrop, soft daylight from the upper left, one accent only (a sprig of
dill; mint for sweet things; a small lime-green cloth for non-food), plain unprinted packaging, no text, no logos, no
labels, no people. No real brand's packaging appears; every image was checked by eye for text and marks.

**Variety that carries information.** A department page must not be a wall of identical pictures: the tile's picture
differs where the products differ, driven by the product data (`artFor` in `_ui/art.tsx`), 71 tile pictures in all.

- Milk: Finland's national colour convention (not a brand's) as the carton's top and cap, from the fat attribute:
  red for whole (2.8 % and up), blue for semi-skimmed and 1 to 2.5 %, light blue for skimmed. And the pack format
  from the sales unit: one carton, a shrink-wrapped case of cartons, or a 10 L+ bag-in-box (the same colour as a
  stripe). Buttermilk, coffee milk and plant drinks have their own pictures.
- Cream by use and pack: whipping (whipped peaks), cooking (a pan of sauce), coffee cream (a cup), a case of small
  2 dl cartons, a bag-in-box. Yoghurt and quark by size: single cups, a tub, a 5 kg bucket.
- Cheese by form: block, whole wheel (pieces of 2.5 kg and up), a case of small pieces, slices, grated, feta cubes,
  soft cheese, white-rind and blue. Spreads in a tub, butter in paper.
- Frozen by kind, each frosted: cakes, raw buns and dough, meatballs and patties, chicken, fish fillets, shrimp,
  fries, vegetables, berries, ice cream. Drinks in cans or bottles; sauces in squeeze bottles, bouillon in tubs;
  cleaning by job (spray, dishwasher detergent, brushes and cloths), disposables (napkins, cutlery, trays and cups).

**Never implies it is the product.** A tile's picture is chosen by the kind of product (the partner's category code,
`scripts/art/map-categories.ts` writes `src/app/_ui/art-map.json`; 16 625 of 17 546 products have one, a 10 L+ liquid
pack is a bag-in-box), carries an "Illustration" / "Kuvitus" / "Illustration" mark (with "not a photograph of this
product" for screen readers and on hover), and the pack's real content stays in type on a paper badge over it.
Brand, name, origin, claims and allergens stay in type below.

**Fallback.** Categories without a fitting picture (nuts and seeds, office supplies, gases, candles, the seasonal
department's tiles) and any picture that fails to load show the drawn pack (`DrawnPlate` in `k/[kitchen]/shop.tsx`,
glyphs in `_ui/glyphs.tsx`). Departments without a header keep the glyph watermark.

**Delivery.** `scripts/art/compress.ts` writes AVIF and WebP at fixed widths into `public/art/` (tiles 240/480/720,
headers and heroes 768/1152/1536; a 480 px tile is under 35 kB, a 1536 px header under 140 kB, about 10 MB in all) and
`src/app/_ui/art-manifest.json` (widths, aspect, average colour). `<Art>` in `_ui/art.tsx` renders a `<picture>` with
`srcset`/`sizes`, the box sized by aspect so nothing shifts, the average colour as placeholder, `loading="lazy"`
except the heroes and department headers (`priority`), and the fallback on error.

**To regenerate** (needs `OPENAI_API_KEY` in `.env.local`; raw output goes to the git-ignored `.art-raw/`):

```
pnpm tsx scripts/art/generate.ts --only tile-eggs,dept-41   # skips keys already generated unless --force
pnpm tsx scripts/art/compress.ts                            # public/art/ and art-manifest.json
pnpm tsx scripts/art/map-categories.ts                      # after adding a tile kind
```

To add a picture: add a key to `prompts.json` (subject only; style and negative are shared), generate, look at it,
compress, and map it. Keep to the art direction above and the "illustration" mark on tiles.

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
- Add drop shadows, gradients or decorative images that carry no information. The generated pictures (§6) say what
  kind of product or department this is, and are marked as illustrations.
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
