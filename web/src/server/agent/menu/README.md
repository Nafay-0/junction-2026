# Menu to order

A chef states a dish or a menu and covers; Dock returns one checked, fixed-price order that needs at most one
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
3. Done: pieces convert by the count a pack states (`piecesPerSalesUnit` in `core/catalog/product.ts`: the
   partner's egg size codes such as "M10 580g", and "8x18pc" reconciled with the packaging hierarchy). A product
   whose pack does not say how many pieces it holds is left out of a piece line with that reason, never counted
   in packages; only when none of the products found says so is the line held.
4. Done: `dock.changeNeededBy(session, requestId, { neededBy, by, reason })` moves a request's need-by date
   (validated, refused once an order stands on the request, one ledger line `data.step = "needed_by"`). The planner
   moves its own request when the chef changes the date; the intake uses it for corrections and later deliveries.

Also fixed in plain code: a stock amount written for powder (grams) is never bought as a liquid concentrate, nor
millilitres of ready stock as concentrate (`stockMismatch` in `match.ts`); a product already peeled or cut is
bought by the net amount, without the peeling allowance (`isPrePrepared` in `plan.ts`), and the raw product stays a
card with the allowance.
