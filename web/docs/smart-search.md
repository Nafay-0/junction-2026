# Smart search: recall wide, rules in code, a fast judge on top

Every product search goes through one function, `findProducts(catalog, request)` in `src/server/search/service.ts`:
the catalogue's search box (`/ui-api/kitchens/{kitchen}/catalog?q=`), the thread's product results
(`server/thread/home.ts productsCard`), the menu planner's ingredient matching (`server/agent/menu/match.ts`), and the
intake's candidates through the core's port (`core/catalog/finder.ts`, `ProductFinder`). With the seed catalogue,
the crash world's own catalogue and every test, it is the catalogue's own lexical search, unchanged.

## How a search runs

1. **Read the words** (`recall.ts understand`): terms, dietary claims, allergens to avoid, uses ("for whipping",
   "kahviin"), product codes, a brand, a pack size. A claim is never dropped: the request's claims are added to the
   words', and a misspelt claim word ("laktositon") is read as the claim, stricter and never looser, with a note
   ("read 'laktositon' as lactose-free"). "without soy", "pähkinätön", "utan nötter" become forbidden allergens.
2. **Hard rules first**, from product data only: claims carried, no forbidden allergen (no allergen data is not
   safe), the family, an id list. Applied inside every recall source, so a model never sees a product the rules
   removed and can never bring one back.
3. **Recall** over all 17,546 products, by cheap means at once, fused by reciprocal rank with a quota per source:
   - `lexical`: the words in the names (English, Finnish, Swedish; whole or inside a compound), inverted index;
   - `typo`: words no product name has, corrected to the nearest one that does, or an inflected form to its stem;
   - `words`: any of the words, rarer words weighing more;
   - `kinds`: the knowledge map's kinds whose label or aliases carry the words, all their products, lifted when the
     map profiles them for a use the words name;
   - `vectors`: the query's embedding (gemini-embedding-2, 768 dimensions) against one vector per product built
     once from its names, shelf and knowledge-map facts (`pnpm search:vectors`);
   - `code`: a product id said outright (then it is a lookup: no embedding, no judge).
4. **The judge** (`judge.ts`): one Decisions API call (gemini-decision-1) over the 50 survivors, split into two
   parallel requests of 25 (questions are independent), a slow request sent once more after 550 ms (hedged), all
   within 800 ms. Each product is `exact`, `variant`, `standin` or `no`, with a confidence. Late, refused, over
   quota or switched off: the fused ranking answers, and the result says which path did (`path`, `reason`).
5. **Order** in code: matches (exact and variant), then stand-ins, never "no". Among matches, the judge's score plus
   the brand and the pack size the words named (checked from data). `onlyStandins` when nothing is the kind asked
   (the thread says "instead"), `notSold` when nothing in the assortment is, `unsure` when the top answer is weak.

The intake asks for recall only (no embedding, no judge): the request reader already chose the family, and options
must not wait. It adds the family's best text matches that a 100-product category list cuts off, prices the top
three first, and looks a family up by recall before refusing words no product name carries.

## Cost, limits, telemetry

Per search about 0.06 US cents (one query embedding of about 15 tokens at $0.20 per million, about 5,500 judge
tokens at $0.10 per million; neither bills output). Smart search's model calls have their own daily count
(`DOCK_SEARCH_DAILY_CALLS`, default 5000) so a busy search box never uses up the calls an order needs; their spend
counts in `DOCK_LLM_DAILY_USD` and search stops calling at that cap's last 10 %. Each call is a telemetry row
(`search.judge`, `search.embed`) and counts on the conversation's turn.

## The vectors on a deployed server

The vectors are derived from partner data and never committed. Locally: `pnpm search:vectors` writes
`.data/valio/search-vectors.json.gz` (12 MB; about $0.33 for the whole assortment). For a deployed server:
`pnpm search:publish` puts the file in one row of `partner_data.search_vectors` in the project's PostgreSQL (the
schema the read-only Grafana role cannot read), and the server fetches it at boot by hash and caches it on its disk,
like the catalogue index and the knowledge map. The server needs `GEMINI_API_KEY` for the judge and query
embeddings; without it, smart search runs recall without vectors or judge.

## Evaluation

`pnpm search:eval` runs the same 181 requests (English, Finnish, Swedish, mixed; 30 held out) through every
configuration; `--tune` leaves out the hold-out, `--opus --sample 60` adds the Claude Opus 5.5 reference,
`--ablation` shows what recall is made of. The requests and their expected kinds are in `eval/search/cases.ts`
(kinds from the knowledge map, a sample checked by hand; `pnpm tsx eval/search/check-cases.ts` validates them).
Answers are cached under `.data/search-eval/` with the time they took; `--fresh` measures again.
