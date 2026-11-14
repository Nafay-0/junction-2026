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
4. **The judge** (`judge.ts`): one Decisions API call (gemini-decision-1) over the 50 survivors, over a connection
   pool kept warm (a fresh TLS connection cost 100 to 250 ms; splitting into parallel requests made the tail worse),
   a request still unanswered at 450 ms sent once more (hedged), all within 800 ms. Each product is `exact`, `variant`, `standin` or `no`, with a confidence. Late, refused, over
   quota or switched off: the fused ranking answers, and the result says which path did (`path`, `reason`).
5. **Code checks the judge**: a product the judge calls the thing itself is relabelled a stand-in when it belongs to
   another family than the words name but can do its job (a vegetable spread for "vegan butter"), or names another
   animal or fish than the words do (chicken for "turkey mince").
6. **Order** in code: matches (exact and variant), then stand-ins, never "no". Among matches, the judge's score plus
   the brand and the pack size the words named (checked from data). `onlyStandins` when nothing is the kind asked
   (the thread says "instead"), `notSold` when nothing in the assortment is, `unsure` when the top answer is weak.

The intake asks for recall only (no embedding, no judge): the request reader already chose the family, and options
must not wait. It adds the family's best text matches that a 100-product category list cuts off, prices the top
three first, and looks a family up by recall before refusing words no product name carries.

## Fresh produce and allergens

"Unknown is never safe" stays the rule, with one narrow exception (`core/catalog/nature.ts`): a product the partner
files under fresh produce (174xx), that the knowledge map profiles as a vegetable, fruit, herb or potato, whole and
fresh, not frozen, with nothing in its names about cutting, peeling, mixing, cooking or coating, contains what it
is itself (celeriac is celery) and nothing else. Its evidence reads "by its nature, not declared by the maker" on
the product card, in the gate's record and in the signed quote line (`allergensByNature`). A mandate with
`allergenEvidence: "declared"` keeps the strict rule. Plain lexical search, OpenSearch, alternatives and the crash
world stay strict.

## Evaluation (14 Nov, 189 requests, fresh)

| configuration | right first | in top 3 | recall | dropped | stand-in as match | "not sold" | p50 ms | p90 ms | US cents |
|---|---|---|---|---|---|---|---|---|---|
| keywords (before) | 40% | 44% | 61% | 4 | 1 | 4/11 | 28 | 54 | 0 |
| semantic only | 75% | 87% | 98% | 0 | 4 | 0/11 | 342 | 409 | 0.0002 |
| hybrid recall, no judge | 67% | 74% | 100% | 0 | 1 | 0/11 | 341 | 407 | 0.0002 |
| keyword recall + judge | 80% | 81% | 81% | 0 | 0 | 11/11 | 358 | 632 | 0.046 |
| semantic recall + judge | 97% | 98% | 100% | 0 | 0 | 11/11 | 678 | 884 | 0.064 |
| **hybrid recall + judge, 50 (shipped)** | **97%** | **97%** | **100%** | **0** | **0** | **11/11** | **680** | **796** | **0.063** |

Times are end to end, including the query embedding. The judge missed its deadline once in 185 searches.

### Common practice on the same 189 requests (14 Nov)

The same requests and the same scoring code, run with approaches most teams use, on our catalogue and our index.
These are textbook set-ups we built and ran, not other companies' products. They take the buyer's words as typed
(no reading of claims or allergens), and the index is the one `pnpm search:publish:opensearch` creates (on a local
Docker OpenSearch 3.3 for this run; BM25 and HNSW are the same algorithms as on the hosted 3.6 service).

| configuration | right first | in top 3 | recall | dropped | stand-in as match | "not sold" | p50 ms | p90 ms | US cents |
|---|---|---|---|---|---|---|---|---|---|
| BM25 | 31% | 43% | 75% | 22 | 0 | 4/11 | 4 | 7 | 0 |
| k-NN (semantic search) | 72% | 85% | 98% | 18 | 5 | 0/11 | 350 | 417 | 0.0003 |
| hybrid: BM25 + k-NN, reciprocal rank fusion | 58% | 71% | 98% | 21 | 3 | 0/11 | 352 | 407 | 0.0003 |
| BM25 + our hard rules | 33% | 47% | 75% | 0 | 0 | 4/11 | 9 | 23 | 0 |
| hybrid (RRF) + our hard rules | 62% | 72% | 98% | 0 | 3 | 0/11 | 355 | 420 | 0.0003 |

- **BM25**: one `multi_match` (best fields, any word) with OpenSearch's default BM25 (k1 1.2, b 0.75) over `names.fi`
  (the `finnish` analyzer), `names.sv` (`swedish`), `names.en` (`english`) and `brand` (lowercase and ASCII folding);
  no synonyms, no filters, no rules, no judge; the top 100 are the candidates.
- **k-NN**: the query embedding (gemini-embedding-2, 768 dimensions) against the same product vectors smart search
  uses (Lucene HNSW, cosine), top 100, no filters.
- **Hybrid (RRF)**: the BM25 and k-NN top 100 fused by reciprocal rank (k = 60, equal weights): what a standard hybrid
  search ships, with no rules and no judge.
- **+ our hard rules**: the same lists after the claims and allergens read from the words are applied in code
  (`recall.ts` `hardFilter`), no judge: the rules take "dropped" to 0; the judge (rows above) takes right-first from
  about 60 % to 97 % and says "we do not sell that".

"Dropped" is a top-3 product that misses a stated claim or carries a forbidden allergen. BM25 times are a local
round trip; k-NN and hybrid times include the query embedding's measured time (replayed from the evaluation's
cache, about 340 ms).

To reproduce: `pnpm search:publish:opensearch` against an OpenSearch with the k-NN plugin (OPENSEARCH_URL), then
`pnpm search:eval --baselines --configs bm25,knn,hybrid_rrf,bm25_rules,hybrid_rrf_rules`.

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

## Product texts in the index (not in the vectors yet)

Since the data-depth index (`core/catalog/partner.ts`), every `IndexedProduct` (and the `Product` it becomes) carries
what the maker writes, shortened, in English and Finnish where given: `texts.ingredients.{en,fi}` (the ingredient
list, up to 400 characters, cut at a comma with "…"), `texts.storage`, `texts.usage` (usage, else preparation
instructions), `texts.disposal`, `texts.about` (the first 80 characters of the marketing text), plus
`mainIngredient.names.{en,fi,sv}` with its share and origin, and `fish[].latin` / `fish[].species` (FAO code). In
the file they are a columnar block (`IndexFile.texts`, "ingredients.en" ... arrays in row order); `pnpm index:build
--no-texts` leaves them out. The vectors (`server/search/docs.ts embeddingText`) do not use them: adding them is
untested against `pnpm search:eval`.

## Recall on Aiven OpenSearch

Recall can be answered in this process's memory (the inverted index and the vectors above) or by OpenSearch
(`server/aiven/search/opensearch-recall.ts`): one `_msearch` brings back the lexical, typo and per-word keyword lists
(the catalogue index's stemmed, folded and n-gram name fields, a matched word worth more than any text score so
"and" ranks products carrying more of the words first) and the nearest vectors (Lucene HNSW, cosine, `ef_search`
400). The code and kinds sources, the hard filter, the fusion, the quotas and the use lift are the same code for
both (`recall.ts` `recallPlan`, `fuseLists`); cheap exact filters (ids, the family's category codes, every claim,
no declared or "may contain" forbidden allergen) are pushed into the queries and the hard rules still run in code on
what comes back. OpenSearch's own hybrid query is not used: it fuses scores into one list, and the lists are needed
to fuse them as memory recall does.

`DOCK_SEARCH_RECALL_BACKEND` picks the order (`recall-router.ts`): `memory` (default) answers from memory and asks
OpenSearch only when the vectors are not loaded yet (after a deploy the vectors load after the index when the recall
index answers, so the first searches are already semantic) or memory recall fails; `opensearch` asks OpenSearch first
with memory as the fallback; `memory-only` never asks it. OpenSearch has a deadline (`DOCK_SEARCH_RECALL_TIMEOUT_MS`,
400) and a breaker (3 failures in a row, 30 s); when both fail, memory recall without vectors answers. Each search's
result says which backend answered (`stats.recallBackend`, `recallFallback`), `/api/health` (`dataPlane.recall`)
and the Platform page count them, and each search is one `search.done` telemetry event (counts, codes and
milliseconds only).

The index: `pnpm search:publish:opensearch` fills `dock-recall-v<N+1>` and moves the alias `dock-recall` once the
count matches; `--rollback` moves it back to the previous version, `--status` shows them, `--index <name>` fills a
development copy without touching the alias, `--drop <name>` deletes one of its own indexes (never one behind the
alias). About 90 s for 17,546 products from a laptop. The catalogue's keyword index (`dock-products`) is not touched.

Evaluation, 14 Nov, 189 requests, `judge50` (the shipped configuration), measured from a laptop in Finland; the
OpenSearch run against a development copy of the index on the project's Aiven OpenSearch (3.6):

| recall | right first | in top 3 | recall | dropped | stand-in as match | "not sold" | p50 ms | p90 ms | recall p50 / p90 ms |
|---|---|---|---|---|---|---|---|---|---|
| memory | 97% | 98% | 100% | 0 | 0 | 11/11 | 706 | 875 | 19 / 34 |
| OpenSearch | 97% | 98% | 100% | 0 | 0 | 11/11 | 837 | 1051 | 149 / 272 |

Per case: the same first product in 185 of 189, and no request right with one backend and wrong with the other; the
candidate lists overlap 86 % on average (the keyword lists differ: OpenSearch's analyzers against memory's word
index; on a local copy the vector lists alone overlapped 99 % with the exact in-memory ones). One OpenSearch call of 189 missed the 400 ms
deadline and memory answered it. The difference in time is the round trip from the laptop (about 80 ms warm, 600 to
900 ms for the first calls on a cold connection and graph: an earlier run that was not warmed up fell back to memory
on every search after the breaker opened). So memory is the default order in the code; on Aiven Runtime,
next to the service, the round trip is shorter but was not measured. The hosted site runs the other way round:
`infra/aiven-deploy.mjs` sets `DOCK_SEARCH_RECALL_BACKEND=opensearch`, so OpenSearch answers first and memory is the
fallback (`/api/health`, `dataPlane.recall.order`, on 15 Nov: `opensearch`, `memory`).
