# AimoPilot design system

The contract for every screen: the store, the phone pages, the operations portal and the wall. Tokens are in
`src/app/globals.css`, components in `src/app/_ui/` (shared) and `src/app/ops/_ui/` (operations). Every component
and state can be seen on sample data at **`/design`**. The two finished reference pages are the store's Home
(`k/[kitchen]/home.tsx`) and the operations portal's Live (`ops/(desk)/live.tsx`): when in doubt, do what they do.

## 1. The idea

A modern food-service ordering product: **calm, bright, appetising, precise**. Soft where the first version was hard,
quiet where it was loud. A chef should feel it belongs beside the best tools already on their phone; a wholesaler's
operator, beside the best admin products.

- **Still in the partner's world.** Petrol blue is the brand colour, lime is the one main action, lavender is what
  the agent remembered or wrote, on white surfaces and a light mist ground. Petrol is an accent and the colour of
  the few dark surfaces (the Home hero, the operations sidebar), not a border on everything.
- **The thread is the heart of the store.** The buyer orders by talking to their agent, typed or spoken. The thread
  is always one step away: a column beside the shop on a desk, the middle of the tab bar on a phone (section 7).
- **The gate is the signature, and the only loud thing.** Warning yellow, the hazard stripe and the quartered mark
  appear where plain code stopped an order or a person must sign, and nowhere else.
- **Hierarchy comes from spacing and type**, not from boxes. Surfaces differ by role (section 4).

## 2. Tokens (`@theme` in `globals.css`)

| Role | Token | Value | Use |
|---|---|---|---|
| Brand | `petrol` / `petrol-deep` / `petrol-soft` | `#005670` / `#003646` / `#e2eef1` | links, active states, strong secondary actions / dark surfaces / selected, hover, quiet fills |
| Text | `ink` / `ink-soft` / `ink-faint` | `#15242b` / `#55666e` / `#8a999f` | text (15.9:1) / secondary (6.0:1 on white, 5.6:1 on mist) / placeholders and decoration only |
| Surfaces | `paper` / `mist` / `surface` | `#ffffff` / `#f4f8f8` / `#ecf3f4` | cards, sheets, fields / page ground / a sunken or tinted panel on white |
| Lines | `line` / `line-strong` | `#dde7ea` / `#b9c8cd` | hairlines / field borders |
| Action | `lime` / `lime-hover` / `lime-soft` | `#c0e021` / `#b1d315` / `#f1f8cf` | the one main action in view (ink text, 12:1) / a just-changed wash |
| Agent | `lavender` / `lavender-mid` / `lavender-deep` | `#f1ecf8` / `#dfd5ee` / `#5b4a7a` | the thread's ground, memory / its borders / the agent's marks, the buyer's bubble (7.0:1) |
| Meaning | `good`, `bad`, `notice` (+ `-soft`) | `#1c6b4a`, `#a3312b`, `#96501d` | placed, intact / a failed call / "this looks off" (the anomaly card). Never the only signal |
| Gate | `safety` / `safety-soft` / `safety-ink` | `#ffc20e` / `#fff5d1` / `#1a1d21` | refusals and sign-offs only |

All text pairs meet 4.5:1. The older names (`concrete`, `steel`, `chalk`) remain so unrestyled screens keep working.

## 3. Type

- **Figtree** (`font-sans`) for everything people read. **Bricolage Grotesque** (`font-display`, class `.display`)
  for titles and big figures: weight 650, width 86 % (its width axis keeps Finnish compounds on one line), tracking
  -0.022em. Both have full Finnish and Swedish glyphs and tabular figures (`.tabular` on anything that changes).
- Scale (rem): 0.75 meta, 0.82 card kind and captions, 0.875 secondary, 0.95 to 1 body, 1.05 to 1.15 lead and row
  titles; display 1.2 to 1.45 card and section titles, 1.9 to 2.2 page titles, 2.1 to 3.3 hero and key figures.
- Sentence case everywhere. **No all-caps labels**, no tracked-out eyebrows. Lines of 60 to 75 characters.
- Finnish and Swedish: texts carry soft hyphens at compound boundaries (`hyphens: manual`); check every large heading
  at 390 px in Finnish.

## 4. Shape, depth and motion

- **Radius by role**, never one number: tags and keys 6 (`rounded-xs`), small marks 8, fields and list rows 12
  (`rounded-md`), inner panels and tiles 16 (`rounded-lg`), cards 20 (`rounded-xl`), feature surfaces and sheets 28
  (`rounded-2xl`). Buttons, chips, badges, search and the composer are pills. A raw `<button>` or `<input>` gets 12
  from the base layer, so nothing is square by accident.
- **Surfaces by role.** A **card** (white, hairline, 20) for a thing that stands alone. A **list inside one card**
  for rows (hairline dividers; not a card per row). A **tinted panel** (`surface`, lavender, no border, 16) for an
  aside or a group of figures. A **dark feature** (petrol-deep, 28) once per page at most. Do not wrap everything in
  identical cards.
- **Depth is sparing**: flat with a hairline by default; `shadow-sm` for the composer and things that float,
  `shadow-lg` for sheets. Interactive cards may use `.lift`.
- **Spacing** on an 8-point rhythm: 16 px page gutter on a phone, 24 to 32 on a desk; 40 to 48 between sections;
  20 to 24 inside a card.
- **Motion** is short and shows what changed: 150 ms on press and hover, `lane-enter` when a turn or stage arrives,
  `sheet-up` for sheets, `stamp` when a sign-off lands, `changed` (a lime wash) on a value that just changed.
  **Loading is a skeleton** in the shape of what is coming (`.skeleton`, `Skeleton`, `CardSkeleton`); a spinner only
  inside a busy button and on a live step line. Everything stops under `prefers-reduced-motion`.
- **Focus**: 2 px petrol outline (lime on dark); fields and the composer draw their own ring. Targets are 44 px on
  touch (`pointer-coarse:` raises the small sizes).
- **Icons**: `lucide-react`, line icons at 1.9 to 2.3 stroke, 15 to 22 px. The gate's mark (`Target`) and the pilot
  light (`Wordmark`) are the only drawn marks. No emoji.

## 5. Components

`_ui/kit.tsx` (import from here; do not restyle by hand):

| Component | Notes |
|---|---|
| `Button`, `buttonClass` | kinds: `go` (lime, one per view), `primary` (petrol), `secondary`, `quiet` (text), `safety` (gate only), `dark`, `ghost-dark`; sizes sm, md, lg; `busy` |
| `IconButton` | round, 44 px, always labelled |
| `Input`, `Select`, `Textarea`, `.field` | label above, hint or error below, icon inside (`suffix` for a unit); native attributes pass through; one field look |
| `Checkbox`, `Chip`, `Switch` | a checkbox as a whole 44 px row (`card` for a choice in a list); a toggling pill for filters, ticked when on; an on/off for a view setting (`role="switch"`) |
| `PageHeader`, `FactList` | a page's top (back link or context, title, lead, actions; no box); facts as hairline rows, label beside value on a desk and above it on a phone |
| `Tabs` | segmented pill for a few views or filters, with counts |
| `Tag`, `Badge` | a chip for a claim; a status with a dot (`waiting` and `refused` are the gate's) |
| `Card`, `Panel`, `Plate` | card; tinted panel; `Plate` is the older name (tone `agent`, `gate`) |
| `ListRow`, `Avatar`, `IconDisc` | rows inside a card; initials; a soft round ground for an icon |
| `Steps` | done, current, pending, stopped by the gate; a segmented bar on a phone |
| `Sheet` / `Dialog` | bottom sheet on a phone, centred or right panel on a desk; Escape and outside tap close |
| `Toaster`, `useToast` | a pill that confirms an action for four seconds |
| `Empty`, `ErrorPlate`, `Skeleton`, `Missing` | an empty state is a direction; an error says what to do; never a blank |
| `Price`, `Field`, `SectionTitle`, `Kbd`, `AgentNote` | figures in the display face, tabular |

Also: the quantity stepper (`k/[kitchen]/qty.tsx`), the order lane's stepper and rows (`k/[kitchen]/ui.tsx`), the
language switch (`_i18n/provider.tsx`), the word mark (`_ui/wordmark.tsx`).

Operations (`ops/_ui/`): `PageHead`, `Section`, `Panel`, `LiveMark`, `Outcome`, `Licence`, `ViaTag`, `Details`,
`Num`, `Loading`, `Empty`, `FilterBar`, and in `parts.tsx` the **data table** (`Table`: a card with hairline rows;
on a phone each row becomes a small card and every cell is labelled with its column heading, automatically),
`Stamp`, `CountBar`, `Funnel`, `CheckGrid`. The time machine's slider (`(desk)/time-machine/time-machine.tsx`) marks each
moment a rule changed, shaped by kind, with the order as a pointer and the lime thumb as the one action.

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

## 7. The thread (`_ui/thread.tsx`)

The buyer's one conversation with their agent, typed or spoken. Names and states follow the thread's contract,
`web/docs/agent-thread.md`. All of it is presentational: pass words and data, get the look and the states.

- **`ThreadDock`**: where it lives. Phone: the primary screen, filling the screen above the tab bar (the tab bar's
  middle button opens it; the shop is one tab away). Tablet: a side sheet. Desk (1280 and up): a 27 to 30 rem column
  docked beside the shop, open by default. Slots: the thread, `footer` (the composer), `aside` (header controls).
- **`Thread`, `BuyerTurn`, `AgentTurn`**: the buyer's turns are short lavender-deep bubbles on the right (`via`
  marks voice and photo). An agent turn is one line of text at most, then its cards; `status="waiting_approver"`
  shows the wait.
- **`StepLines`**: what the agent is doing now, line by line; the line in progress turns, finished lines tick and go
  quiet, and when all are done they fold to "3 steps". **`CardSkeleton`** holds the place of a card on its way.
- **The cards are one family** (`ThreadCard`: a mark, the kind of card, the content, the actions; white, hairline, 20):

| Card | Component | States and notes |
|---|---|---|
| `understood` | `UnderstoodCard` | the need as fields; a value from memory carries the lavender "from memory" chip; `basedOn`, `alsoAsked` |
| `anomaly` | `AnomalyCard` | **warm and calm** (`notice`), never the gate's yellow: the reason as numbers (usual against asked bars); `answered` replaces the actions |
| `question` | `QuestionCard` | one question, choices as pills; chosen, others dimmed |
| `options` | `OptionsCard` | best, better, good; keeps (tick) and gives up (dash); `preselected` and why; `signOff` when choosing it needs a person; chosen |
| `price` | `PriceCard` | the figure, lines, how long it holds (a draining bar, warm under 20 %), signed by the wholesaler |
| `gate` | `GateCard` | **the signature**. `checking` (mark turning), `placed_alone` (quiet, good), `waiting` (the dark slab, hazard band, who must sign, countdown), `approved` (a stamp with the signer's name), `refused` (the slab, the rule and its reason), `declined` / `withdrawn` / `expired` (plain) |
| `order` | `OrderCard` | lines, total, delivery, status badge, link |
| `memory` | `MemoryCard` | lavender; keep or drop on each proposal; kept, dropped |
| `records` | `RecordsCard` | answer rows from the kitchen's records, each linkable, with the source |
| `notice` | `NoticeCard` | could not do it, in plain words, with what to do; `tone="gate"` for a suspension |

- **`Composer`**: one field, the microphone (hold to talk), a photo, send (lime, an arrow). States: idle; listening
  (the field gives way to what is heard and moving bars, the microphone fills and pulses); processing; busy.
  `size="lg"` on Home. `tools` replaces the built-in buttons.
- **`VoiceStatus`**: `listening`, `thinking`, `speaking`, `waiting` (the only one that borrows the gate's mark),
  `reconnecting`, `idle`; a pill (`sm`) or the call screen's centre (`lg`). `VoiceBars` alone for inline use.

## 8. The shells and the operations portal

**Store** (`k/[kitchen]/portal.tsx`): a slim demo strip; one white sticky header (word mark, the kitchen as a pill
that is its own switch, search, language, agent, basket) with the sections as pills under it on a desk. On a phone the
header keeps the mark, the kitchen and a search toggle; the sections are a **tab bar** (Home, Order, the agent in the
middle, Catalogue, More), the basket rides above it when it holds something, and More is a sheet (Orders, Basket,
Menu planner, Agent and rules, language, kitchen).

**Operations** (`ops/_ui/rail.tsx`, `ops/(desk)/layout.tsx`): a petrol-deep icon sidebar (15 rem; press g then a
letter) and a status bar above the page: ledger chain, sign-offs waiting (the gate's yellow, a link), suspensions,
Helsinki time, who is signed in. On a phone: a top bar with the same status as compact pills, a tab bar (Live,
Trace, Safeguards, Control, More) and the rest in a sheet. Pages are a `PageHead` (the title and the one question
the page answers), then `Section`s. Ids, codes and hashes sit behind `Details`. Dense data is a `Table`; figures are
`Num`; the gate's slab and yellow mark only refusals, suspensions and waiting sign-offs. A new section added to `NAV`
gets an icon in `ICON` (a ring shows until it has one).

**Phone pages** (`_ui/phone.tsx`, `PhoneShell`): a white top bar, one column, the main action held at the bottom
edge under the thumb. The sign-off (`approve/`) is the product's signature: the gate's slab with the hazard band
(who asks, the total, delivery), the rule that stopped it, the exact lines in one card, Face ID to approve; once
decided it ends on a stamp and the band is gone. **The wall** (`_wall/`) inherits the tokens and the type.

**Store pages** follow Home: a `PageHeader` (no box), then sections. The catalogue's tiles are cards with the
picture full bleed, two to a row on a phone with a round add button; on a phone the departments and the filters are
sheets and the categories a row of chips. The product page puts the buy box straight after the name on a phone.

## 9. Do and do not

- Do use lime for exactly one action in view; everything else is petrol, white or text.
- Do keep yellow, the hazard stripe and `Target` for the gate: refused, waiting on a person, suspended.
- Do say what a value is and where it came from; show "not stated" (`Missing`) rather than a blank.
- Do build pages from the kit; if a page needs a look the kit lacks, add it to the kit.
- Do not use thick or petrol borders, square corners, all-caps labels, or the old condensed display sizes.
- Do not put a card around everything, or the same shadow on everything; do not use gradients as decoration
  (the one scrim over the hero picture is there to keep text readable).
- Do not use CSS modules (they silently break in this build; a test forbids them). Tailwind classes, or a prefixed
  global class in `globals.css` inside `@layer components` so utilities can still refine it.
- Do not put a string in a component: store texts live in `*.text.ts` in English, Finnish and Swedish.
- Keep "demo on synthetic data, not the wholesaler's own shop" visible on every screen, and never use the partner's
  logo or artwork.

## 10. Rolling it out

Every page already inherits the type, colours, buttons, tags, cards (`Plate`, `Panel`), fields' and raw buttons'
radius, tables, empty and error states, focus and motion. What each page still needs is its own hand-written
markup brought into line: replace `border-2 border-petrol`, `border-t-[3px]`, `border-l-[6px]`, `bg-paper` boxes
with no radius, `font-display text-[…]` at the old sizes, hand-drawn `<svg>` icons and hand-made inputs with the
kit (`Card`, `Panel`, `Input`, `Select`, `Tabs`, `Badge`, `ListRow`, lucide icons), and check 390, 768 and 1440 in
English and Finnish.
