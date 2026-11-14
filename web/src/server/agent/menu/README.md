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
| `scenarios.ts` | The partner's two menu scenarios on top of the planner: a menu around what is in season, and a booking at short notice (below) |
| `thread.ts`, `say.text.ts` | The kitchen's conversation side of both: what to say (en, fi, sv), the steps, the buyer's words to a decision, the sheet |
| `rest.ts`, `../../mcp/menu-tools.ts` | `plan_seasonal_menu`, `plan_event_menu`, `order_menu`; REST `/api/v1/menus/**`, under the caller's own mandate |

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

## The two scenarios (scenarios.ts)

Plain code in `core/on-hand.ts`, `core/pack-choice.ts`, `core/recipe-roles.ts` (tests beside each); `pnpm scenarios`
runs both on the real catalogue in process and as an outside MCP agent.

**A menu around what is in season.** The anchor is the season calendar's entry for this month (`core/season.ts`, each
with its public source) whose words find products in the range (master-data search, raw produce first; never
invented). The planner drafts two or three dishes on it. For each ingredient: the need for the covers, then what is on
hand on the service day, strongest first: what the chef said ("I have butter and flour", `saidHave`), the kitchen's
standing pantry list, an estimate from its own history (last delivery less how fast it usually goes through it, up to
the day; a single purchase tells no rate, so nothing is assumed, unless it is a staple far larger than the need), else
nothing. Only the shortfall is bought (plan edit `onHand`), the smallest pack that covers it priced first
(`liveShortlist` with `covers`), and what is left over is said when even that pack is far more than needed. Ledger:
`seasonal_anchor`, `on_hand`.

**A booking at short notice.** The menu is planned for the day; every ingredient's arrival is the wholesaler's own
status for its products (one batched call, only the dishes' products; a line not priced yet is priced before it is
called late): cut-off passed at a time, out of stock, no delivery that day and the earliest day. A day nothing can make
is one sentence with the earliest day; a yes moves the same plan (no model call). For each ingredient that cannot come:
options by its role in the dish (fat, acid, thickener, protein, aromatic, garnish, liquid, body): another ingredient
doing the same job at an adjusted amount (`ROLE_SUBS`: crème fraîche to smetana 1:1 or cooking cream and lemon 9:1,
fresh dill to frozen 1:1 or dried 1:3, butter to rapeseed oil 0.8 for frying, flour to potato starch 0.5, ...), the
planner's own ideas (the product map's alternatives, the model's fixes), a change of technique, and a replacement dish
planned so that every line can come. Every product of every option is verified (in the range, the form it names, can
arrive by the day, the kitchen's allergen, claim and nutrition rules, the mandate's groups); nothing unverified is shown.
Ranked best, better, good by fidelity, work and cost; each with the gate's preview of the swap (`substituteFor` the
product it replaces): the agent may take it alone only where the gate passes it (like for like inside the kitchen's
preferences), else a named person signs. Ledger: `cannot_arrive`, `substitution_options`, `substitution_chosen` (who).
Both audit views read them; the wholesaler's never the history behind an on-hand estimate.
