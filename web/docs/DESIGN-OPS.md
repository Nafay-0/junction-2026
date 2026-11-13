# Operations portal and wall: design plan

The wholesaler's side of Dock (`/ops/**`), the big screen (`/`) and the knowledge preview (`/knowledge`), built on the
shared system in `DESIGN.md` (tokens in `globals.css`, components in `_ui/`). This file records the plan, the review
against generic defaults, and what the operations side added beside the system, for the system's owner to absorb.

## Taken from the system unchanged

Tokens (petrol, petrol-deep, petrol-soft, ink, ink-soft, line, mist, lavender, lime, paper, safety, hazard), Barlow
Condensed for display and Barlow for text, `Button`, `Plate`, `Field`, `Tag`, `Kbd`, `Spinner`, `Skeleton`, `Missing`,
the `Target` mark, the motion classes (`lane-enter`, `barrier-*`, `stamp`, `breathe`, `changed`) and `plain.ts` for
Finnish formats. The order lane's shape (a station strip on top, the current stage open, earlier ones one line each)
is reused for the trace, so the kitchen's lane and the wholesaler's trace read as the same story told twice.

## Plan

**Colour.** Mist ground, paper plates with a petrol top rule, ink text, petrol for structure and links. Petrol-deep
is the operations rail and the wall's ground. Lime: the one action per view (Play on the trace, "Send in an Aiven
agent", the wall's "scan" band). Lavender: anything the kitchen's agent or memory supplied. Safety yellow and the
hazard stripe: only a refusal, a suspension, or a sign-off waiting on a person.

**Type.** Display face for page titles, station names, counters and the asked sentence; Barlow for everything read.
Sentence case. Codes, ids and hashes in the mono face, and only inside a details control.

**Shell.** A petrol-deep rail on the left (it costs width, not height, which a 13-inch laptop needs for the trace),
headed by the mark and the gatehouse status: Helsinki clock, ledger chain, sign-offs waiting, agents suspended.
Active item: a lime bar. The demo note sits at the rail's foot on every page. Content is left-aligned on mist.

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│ ◐ Dock     │ Page title (display)                     live, updated 14.05 │
│ Operations │ one line: the question this page answers                     │
│ 14.05.32   ├──────────────────────────────────────────────────────────────┤
│ ◐ chain ok │                                                              │
│ ▨ 2 wait   │   tables, lanes, diagrams on paper plates                    │
│────────────│                                                              │
│▌Live       │                                                              │
│ Trace      │                                                              │
│ Safeguards │                                                              │
│ ...        │                                                              │
│ demo note  │                                                              │
└────────────┴──────────────────────────────────────────────────────────────┘
```

**Trace (the centrepiece).** One request as a journey through stations. The station strip and the transport are one
sticky band: stations as labelled nodes on a rail (the gate node turns hazard only if the gate stopped or escalated),
a scrubber under them, Play in lime, step and jump buttons, keys shown beside them. Below, the lane: each station opens
as the replay reaches it; earlier ones fold to one line and reopen on click. Each phase has its own body: the asked
sentence large; the understood need as waybill fields; the search as a short table; the live check as a product table
with a catalogue funnel (17 546 in the catalogue, N looked at for free, K priced live); options as good, better, best
columns with the ruled-out reasons as counted bars; the fixed price as a document; the gate as a grid of every check
(passed, sent to a person, refused); the sign-off with who, how and a stamp; the order as the signed confirmation. The
aside keeps the funnel, the chain check and the ids. Deep link: `?step=N` survives reload and can be shared.

```
 Live / Trace                                                   [Open another ▾]
 “1,000 L lactose-free milk by Monday”                          ┌──────────────┐
 Ravintola Kaari, Kaari's buyer agent, ◩ MCP, Fri 13.11. 23.54  │ SIGNED ORDER │ stamp
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │ Asked ── Understood ── Searched ── Live check ── Options ── Price ─[GATE]─ Order │ sticky
 │ [▶ Play] [◀] [▶]  ━━━━━━━━━━●───────────  4 of 9  Live check   Space ← → Home End  │
 └───────────────────────────────────────────────────────────────────────────────┘
 ┌ lane ─────────────────────────────────────────┐ ┌ aside ───────────────────┐
 │ ● 1 Asked        “…”                     open │ │ The live service saw     │
 │ ● 2 Understood   1 000 L, Mon 16.11.     open │ │ 17 546 ████████████████  │
 │ ◉ 3 Live check  ┌ product | price | stock ┐   │ │     72 █ looked at, free │
 │                 └─────────────────────────┘   │ │      3 ▏ priced live     │
 │ ○ 4 Options                                   │ │ The record (chain check) │
 └───────────────────────────────────────────────┘ └──────────────────────────┘
```

**The wall, and its one bold thing.** The gate itself, drawn as a structure: every live request is a lane running
left to right across the screen through the same hazard-striped gate post, so "every agent passes the same gate" is
a picture, not a sentence. A request that passes runs on to a stamp; one that is stopped halts at the post with the
rule's name. When nothing moves, the gate post keeps reading out its seventeen checks one at a time, so an idle
wall still says what it does. Ground petrol-deep, type in paper, the scan panel the one lime thing on the screen.

```
┌────────────────────────────────────────────────────────────────┬────────────────┐
│ ◐ Dock   AI buyers order here; plain code checks every order   │    23.54.12    │
├────────────────────────────────────────────────────────────────┼────────────────┤
│ Asked     Priced     Price fixed   ▓GATE▓     Signed            │ SCAN (lime)    │
│ Kaari   ━━━━━━━━━━━━━━━━━━━━━━━━━━━▓    ▓━━━━━━━ ◐ signed        │ ┌────────────┐ │
│ Laakso  ━━━━━━━━━━━━━━━━━━━━━━━━━━■▓STOP▓ weekly budget          │ │  QR, white │ │
│ Hotel   ━━━━━━━━━━━━━━━■           ▓    ▓                         │ │            │ │
│                                   ▓ "No forbidden allergens" ▓  │ └────────────┘ │
├──────────┬──────────┬──────────┬──────────┬────────────────────┤ become the     │
│ 12 signed│ 4 alone  │ 8 person │ 13 refused│ 16 live calls     │ approver       │
├──────────┴──────────┴──────────┴──────────┴────────────────────┼────────────────┤
│ Refused, and why (3 latest)            │ Crash test: models, rating, licence   │
└────────────────────────────────────────┴───────────────────────────────────────┘
```

**Principles.**
1. The desk is calm; the gate is loud. Yellow never marks ordinary information (stock not reported, a later day).
2. Each page answers one question in ten seconds, stated under its title, and the first thing on it is the answer.
3. Plain words on the surface: Helsinki time as 14.05 and Fri 13.11., money as 1 280,50 €, units as words. Codes,
   ids and hashes behind "Details".
4. A table or a small diagram before a paragraph.
5. Motion only for change: a station arriving, a row that changed, the barrier closing on a refusal. Reduced motion
   removes all of it.

## Review against generic defaults, and what changed

- *Dark sidebar admin kit.* The first sketch had a near-black rail with grey links; it is now petrol-deep from the
  system, headed by the gatehouse's live status rather than a logo block, so the rail carries information.
- *Near-black ground with one acid accent* (the wall). The brief pins petrol and lime, so the risk was real: the wall
  ground is petrol blue, not black, lime appears once (the scan panel), and the screen's dominant accent is the
  hazard gate, which only moves when something is refused or waits on a person.
- *Big number with a small label as the hero.* The old wall led with five giant counters. They are now a row under
  the gate; the gate lanes are the hero.
- *SaaS card grid.* Platform's eight equal service cards become one service map (a row per service: job, alive,
  last answer, the number that proves it is working); Live's door cards become a diagram of three doors feeding one
  gate.
- *Meta strings with middle dots, mono labels, tracked capitals.* Removed: "dock-app · startup-50 · aws" becomes
  "dock-app, startup plan, AWS Frankfurt"; ids live only in details.
- *Numbered markers.* Only on the trace's stations, which are a true sequence.

## Added beside the shared system (in `src/app/ops/_ui/`), for the system's owner to absorb

See the list at the end of this file, kept up to date as the work goes.
