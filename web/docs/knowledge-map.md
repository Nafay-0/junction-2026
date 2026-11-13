# Product knowledge map

What every product in the partner's assortment is in a kitchen's terms, and which other products can stand in for it
in a given use, ranked good, better, best. Built offline once, checked, stored outside the repository, served by a
typed function and a small HTTP route. Code: `web/src/server/knowledge/`; scripts: `web/scripts/knowledge-*.ts`.

## What it holds

For each of the 17,546 products, one profile written by a language model reading the product's own text (name in
three languages, key ingredients, marketing and usage text, fat/sugar/protein per 100 g):

- **kind**: one of 3,837 kinds, proposed per partner category (`10401.whipping_cream` "whipping cream",
  `10603.hard_grating_cheese`, `41731.frozen_diced_carrot`, ...), each in one of 56 cross-category families
  (cream, plant_cream, cheese, flour, ...);
- **form** (liquid, grated, sliced, fillet, powder, ...) and **state** (fresh, chilled processed, frozen, shelf-stable, dried);
- **whips**, **heat-stable**, **melts**, **sweetened**, **flavoured**: true, false, or null when irrelevant;
- **uses**: up to six of 35 kitchen uses (drinking, coffee, sauce, soup, baking, whipping, topping, sandwich, salad,
  pizza, melting, ...), most typical first.

Nothing else comes from a model. Dietary claims, allergens, origin, labels, pack content, fat figure, carbon (group
average) and delivery reliability are joined from the catalogue index at load time, so a model's text can never make
a product lactose-free or nut-free. The stored file is 271 KB gzipped.

## Hard facts (`facts.ts`)

A relation is served only if code, reading the data fields, allows it:

- the substitute carries every dietary claim the buyer states, and every one the original carries that a buyer may
  rely on: lactose-free, low-lactose, gluten-free, vegan, vegetarian. Lactose-free satisfies low-lactose, never the
  reverse. Exceptions, because the data makes them carry no information: "vegetarian" is not assumed for dairy and
  other inherently vegetarian families (one maker tags all its milk vegetarian, another none), "vegan" not for plain
  plant foods (vegetables, juice, spices, flour). Plant drinks and plant creams keep vegan. Egg-, soy-, wheat-free
  are decided by the allergen comparison when both products declare allergens;
- it adds no allergen: nothing it contains or may contain that the original does not ("contains" where the original
  only "may contain" counts as new; milk that is not lactose-free carries lactose);
- missing allergen data is unknown: if the original declares allergens and the substitute does not, it is refused;
  if neither declares, it is served with the condition "no allergen data for either product";
- a buyer's forbidden allergen refuses any product without allergen data.

## Relations (`map.ts`)

For a product and a use (default: its most typical use), candidates are products of the same kind, the same family,
or a family bridged for that use (milk and plant drink for coffee, cream and plant cream for sauce, butter and
margarine for baking, ...). A shared category alone is never a link. Then:

- the candidate must be profiled for the use (same kind excepted, with a penalty);
- property rules per use: for whipping it must whip; for pizza and melting it must melt; for sauces and soups one
  that splits when boiled is penalised and says so; sweetened or flavoured for a plain use is penalised;
- produce and fish must share an ingredient word in some language (a kind such as "sliced vegetables" holds carrot
  and onion); outside the functional families (creams, cheeses, flours, fats, sauces, ...) a different kind must
  share most of its kind name or product name;
- differences become `changes` (fat 35% → 15%, pack 1 l → 10 l, brand, organic, origin, carbon group average,
  delivery reliability, price per litre when the caller passes comparison prices) and `conditions` (will not whip,
  may split if boiled, frozen: plan thawing time, ...), and lower the confidence;
- **threshold 0.55**: below it a relation is not served at all. Just under it sit pairs no cook would accept (fish
  sauce for hot sauce, a tea stand for tea), which is where it was set; `debug=1` lists what was dropped and why;
- **pack alternatives** (same kind, maker, line name, claims; only the pack differs) are returned apart from
  substitutes, and substitutes are shown once per product line (`otherPacks` lists the other sizes);
- lists are never padded. With no substitute the answer says why, e.g. "No substitute for whipping that is also
  lactose-free, vegan: of 4 related products, 3 not vegan by data, 1 not lactose-free, vegan by data."

Tiers: best (same kind, ≥ 0.82, no condition), better (≥ 0.68), good (≥ 0.55).

## How it was built

`pnpm knowledge:build [--executor modal]`, then `pnpm knowledge:eval`, then `pnpm knowledge:publish`.

1. One call per partner category (349): the product names in, a list of kinds out.
2. Batches of up to 25 products of one category (882 calls): one compact line per product in, profiles out, the kind
   restricted by JSON schema to that category's list. Answers are validated again in code; products a batch missed
   are retried in batches of 6.

Every request is hashed (model, prompt, schema, input); its answer is cached on disk under the hash
(`.data/knowledge-build/cache/`, outside `.data/valio/`, which a locally built deploy ships), so a rerun is free and an interrupted build resumes.

**Model**, chosen on a pilot of 11 categories (929 products: milks, creams, plant drinks and creams, sliced and grated
cheese, flours, pre-cut vegetables, bread, pork), prices read from the providers' pages on 13 Nov 2026:

| Model | Pilot cost | Agreement with Sonnet 5.5 (whips / kind partition / primary use) | Partner pairs P@3 | Notes |
|---|---|---|---|---|
| openai:gpt-6-luna ($0.10/$0.50 per M) | $0.060 | 77% / 49% / 84% | 50% | **chosen** |
| anthropic:claude-haiku-5-5 ($0.10/$0.50) | $0.083 | 33% / 40% / 79% | 47% | |
| google:gemini-3.1-flash-lite ($0.25/$1.50) | ~$0.08 | n/a | n/a | repeated unparseable answers, slow; dropped |
| anthropic:claude-sonnet-5-5 ($2/$10) | $1.70 | reference | 25% | finer kinds; too dear for the full run |

**Full run**: 1,233 calls, 3.5 M input and 1.5 M output tokens, **$1.10**, **131 s** wall time, on **Modal**: up to
35 containers with 12 threads each (`scripts/knowledge/modal_exec.py`, pinned client run through `uvx`). Modal compute
was a few cents. All model spend for this work including the pilots: about $3.

## Evaluation (`pnpm knowledge:eval`)

**Partner's own substitutions** (196 products carry the field; 188 have a usable substitute, 249 pairs), held out:
never used for ranking (shown as `partnerListed` only).

| Where the partner's substitute lands | Pairs |
|---|---|
| our top 1 | 32 (13%) |
| our top 2-3 | 48 (19%) |
| served lower, or as another pack of a served line | 53 (21%) |
| a pack alternative (we list it apart, on purpose) | 36 (14%) |
| refused by the hard facts | 56 (22%) |
| blocked by a property or kind rule | 10 (4%) |
| under the threshold | 5 (2%) |
| not related for that use | 9 (4%) |

P@1 19.5% and P@3 42% of the products we answer (a hit is the partner's one listed product); 67% of partner
substitutes are served somewhere (substitute or pack list). For 10% of the partner's products the map deliberately
returns no substitute.

The disagreements are instructive. 22% of the partner's own pairs fail on the partner's own data: a lactose-free
mozzarella listed with a mozzarella that is not lactose-free by its data; a plant whipping product tagged gluten-free
listed with one that is not; the same oat drink in two pack sizes, one declaring gluten and the other claiming
gluten-free; seventeen pairs where the substitute has no allergen data at all while the original declares some. The
second large group is pack sizes of the same product, which the map lists apart. Our own errors: in large same-kind
groups (fresh peppers, cucumbers, tomatoes) the partner picks a specific colour or origin we rank fourth or fifth, and
the partner sometimes crosses kinds we keep apart (berry mix for redcurrants, watermelon for other melons before the
compound-word rule).

**Hand-written hard cases**, anchors chosen by rule from the data (15 per case), each served relation judged:
lactose-free whipping cream for whipping, cooking cream for sauce, lactose-free milk, low-lactose (not lactose-free)
dairy, oat drink for coffee, shredded cheese for pizza, sliced cheese for sandwiches, gluten-free flour for baking,
fresh vegetables, frozen vegetables, and seven free-text roles ("cream for carbonara", "flour for bread" with
gluten-free required, ...). P@1 100%, P@3 99.8%. Caveat: claim checks are against data, but the whip/melt/split checks
read the same profile flags the map uses, so they test the rules, not the model. A manual read of samples agrees for
creams, milks, cheeses, flours and plant drinks.

**Manual precision sample** (random products, the map's own top suggestion): 18 of 20 acceptable to a cook. In the
weakest band served (confidence 0.55 to 0.65): about 24 of 30 acceptable after the rules above; before them, 16 of 30.

**Coverage**: no substitute in the primary use for 13.8% of products. Most empty: nuts and seeds, dried fruit,
cereals, doughs, bread and sweet bakery (25-35%), where many products are one of a kind or differ in allergens.

## Where it is weak

- Kinds are per category; a few categories organise by cut rather than ingredient (pre-cut vegetables), and the
  ingredient-word rule is a heuristic over product names.
- Prepared foods, bakery and confectionery: kinds are broad, so cross-kind relations are held to a strict name rule,
  which leaves many products with nothing.
- The model's flags are not checked against a second model at scale; whip, melt and split flags were compared with
  Sonnet 5.5 only on the pilot (77% agreement on whipping).
- No price at build time: price changes appear only when the caller passes comparison prices it already has.
- 17 of the partner's 249 pairs are refused only because one product lacks allergen data; that is deliberate.

## Using it

Server-side, typed (`web/src/server/knowledge/service.ts`):

```ts
import { alternativesFor, productsForRole } from "@/server/knowledge/service";

const alt = await alternativesFor("461273", { use: "whipping", constraints: { requiredClaims: ["lactose_free"], forbiddenAllergens: ["nuts"] } });
// alt.available, alt.substitutes[] { productId, tier, confidence, reason, changes[], conditions[], checks, otherPacks },
// alt.packAlternatives[], alt.none (why nothing)

const fit = await productsForRole("cream for carbonara", { constraints: { requiredClaims: ["lactose_free"] } });
// fit.uses, fit.kinds, fit.products[] { productId, kindLabel, score, reason }
```

HTTP (same answers as JSON; 503 when the map is not loaded, 404 for an unknown product):

- `GET /ui-api/knowledge/alternatives?product=<id>&use=sauce&claims=lactose_free&allergens=nuts&max=5&debug=1`
- `GET /ui-api/knowledge/role?q=cream for carbonara&claims=lactose_free`
- `GET /ui-api/knowledge/search?q=whipping cream`, `GET /ui-api/knowledge/status`
- preview: `/knowledge`

### A few lines for each consumer

**Menu planner** (`web/src/server/agent/menu/`): pick a product for each recipe line by its role, and keep a
fallback for when it is out of stock.

```ts
const fit = await productsForRole(`${line.ingredient} for ${dish.name}`, { constraints: { requiredClaims: diet.claims, forbiddenAllergens: diet.allergens } });
const pick = fit.available ? fit.products[0] : undefined;
const fallback = pick && (await alternativesFor(pick.productId, { use: fit.uses[0], constraints: { requiredClaims: diet.claims, forbiddenAllergens: diet.allergens } }));
// show fallback.substitutes[0].reason ("Same kind (cooking cream); fat 15% → 10%; still lactose-free.") or fallback.none
```

**Kitchen store and assistant** (`/k/**`), client side, on a product card that is unavailable or blocked:

```ts
const r = await fetch(`/ui-api/knowledge/alternatives?product=${id}&use=${use ?? ""}&claims=${mandate.requiredAttributes.join(",")}&allergens=${mandate.forbiddenAllergens.join(",")}`).then((x) => x.json());
// r.substitutes: render tier + reason + changes; r.packAlternatives: "same product, other sizes"; r.none: say it
```

**Option cards** (`web/src/core/options.ts`, `core/intake.ts`): the core must not import server code, so pass the
ranking in as a dependency. In `IntakeDeps` add `substitutes?: (productId: string, constraints: BuyerConstraints) => Promise<string[]>`,
wired in the server to `(id, c) => alternativesFor(id, { constraints: c }).then((r) => ("substitutes" in r ? r.substitutes.flatMap((s) => [s.productId, ...s.otherPacks]) : []))`.
Then in `advance()`, before `shortlist(...)`:

```ts
const subs = reference && deps.substitutes ? await deps.substitutes(reference.productId, { requiredClaims: session.mandate.requiredAttributes, forbiddenAllergens: session.mandate.forbiddenAllergens }) : [];
const prefer = [reference?.productId, ...subs.slice(0, 3), last && primaryLine(last).productId, usual?.kind === "product" ? usual.productId : undefined];
```

and `likeForLike` can treat a product the map ranks `best` or `better` as like for like.

## Rebuilding

```sh
pnpm knowledge:build --plan                       # count calls, estimate tokens
pnpm knowledge:build --executor modal             # or local (default), --concurrency 24
pnpm knowledge:eval                               # writes .data/knowledge-build/knowledge-eval.json (names products; git-ignored)
pnpm knowledge:publish                            # partner_data.knowledge_map in PostgreSQL
```

`VALIO_DATA_DIR` must point at the partner files. The map, the cache and the eval report are partner-derived and
live only in `.data/` (git-ignored) and the database's `partner_data` schema.
