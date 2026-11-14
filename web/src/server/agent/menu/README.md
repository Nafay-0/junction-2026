# Menu to order

A chef states a dish or a menu and covers; AimoPilot returns one checked, fixed-price order that needs at most one
sign-off. The model drafts (outline, then each dish in parallel; a name check of found products; ways out for lines
that cannot be bought); plain code does everything that touches safety, money or authority.

| File | What |
|---|---|
| `draft.ts`, `prompts.ts`, `pick.ts`, `fixes.ts` | The model's part (Sonnet 5.5, low effort) and the code that checks its output |
| `match.ts`, `safety.ts` | Catalogue search, role fit, allergen and claim rules ("unknown is never safe") |
| `plan.ts` | Pure: amounts with their working, core good-better-best options per line, doubts, totals |
| `service.ts` | The flow: plan, edit, quote, order; batched live calls within the agent's allowance; ledger entries |
| `kitchens.ts` | Menu mandates for Kaari (restaurant) and Laakso (school, no nuts), signed with their own keys |
| `eval/` | Ten requests, recorded model outputs, fixture catalogue; `pnpm menu:eval [--record]` runs them live |

Screens: `app/_plan/MenuPlanner` (mount with `<MenuPlanner kitchen="kaari" />`), routes `/ui-api/plan/**`,
preview `/plan/kaari` and `/plan/laakso`.

## Hooks wished for in the core

1. `requestQuote` makes one live call, so a quote holds at most 10 products (MeteredCatalog's cap). A day's menu
   often needs 12 to 20. Batching the quote's own lookup in tens would keep it one quote and one sign-off.
2. The hourly live allowance (30 products per agent) is tight for menus: a three-course plan prices 15 to 25
   products. A per-request or per-plan budget, or counting cached answers as free, would fit menus better.
3. `toDockProduct` uses `unit: "pcs"` for packs whose content is unknown, so "pieces" means packages, not eggs or
   lemons. A piece count per pack (from GS1) would let pieces be converted instead of held.
4. A way to change a request's need-by date (the intake does it through the repository); the planner opens a new
   request instead.
