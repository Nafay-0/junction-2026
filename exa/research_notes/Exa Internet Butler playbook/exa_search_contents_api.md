# Exa Search and Contents API: practical reference (as of 13 Nov 2026)

Method: read the live docs (machine-readable `.md` pages under https://exa.ai/docs/, which docs.exa.ai now points to), the OpenAPI spec (https://exa.ai/docs/exa-spec.yaml, `info.version: 2.0.0`, which the docs call "the source of truth for request and response schemas"), and the published SDK source: exa-py 2.28.0 sdist from PyPI and exa-js 2.28.0 tarball from npm (both released 6 Nov 2026). No live API calls. "Documented" = cited URL. "Inferred" = my reading, marked as such. Where SDK source and docs differ, it says so.

Base URL `https://api.exa.ai`. Auth header `Authorization: Bearer $EXA_API_KEY` or `x-api-key: $EXA_API_KEY`. Both SDKs read `EXA_API_KEY` from the environment — [llms.txt](https://docs.exa.ai/llms.txt)

---

## 1. Which endpoints exist now, and what each is for

### Takeaway
The core for a search agent is `POST /search` (with `type` covering fast, balanced and deep research, plus `outputSchema` for structured JSON) and `POST /contents` (full text, highlights, summaries, subpages, freshness, snapshots). `/answer` still exists. `/findSimilar` is deprecated. `/research` has been **retired** and replaced by `/search type:"deep"` and the new **Agent API** (`/agent/runs`). New in 2026: Agent API, Monitors, Batch API, Snapshot, the `lite` type, Dynamic Highlights, and `warnings`/`notices` in search responses.

### Cited Findings
- Public paths in the OpenAPI spec: `/search`, `/contents`, `/answer`, `/findSimilar`, `/monitors` (+ `/monitors/batch`, `/{id}`, `/{id}/trigger`, `/{id}/runs`), `/agent/runs` (+ `/{id}`, `/{id}/cancel`, `/{id}/stop`, `/{id}/events`), `/batches` (+ `/{id}`, `/{id}/cancel`), and Websets under `/v0/...`. There is no `/research` path — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- `/findSimilar` is marked `deprecated: true`, `x-exa-lifecycle: deprecated`, and returns a `Deprecation` header: "Deprecated: prefer `/search` with a query describing the source" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- 1 Apr 2026: "`/research` endpoint: replaced by `/search` with `type: "deep-reasoning"`." `resolvedSearchType` and `highlightScores` returned null from 15 Apr and were removed 1 May. `startCrawlDate`/`endCrawlDate` silently ignored from 15 Apr — [Changelog](https://exa.ai/docs/changelog.md)
- exa-js `ResearchClient`: "Client for the Research API, which has been retired. Every method rejects with an `ExaError` (`statusCode` 410) without sending a request. Use the Agent API (`exa.agent.runs.create`)" — [exa-js 2.28.0 dist/index.d.ts](https://www.npmjs.com/package/exa-js/v/2.28.0). exa-py still ships `exa.research` (base path `/research/v1`) with a message pointing to `exa.agent.runs.create` — [exa-py 2.28.0 exa_py/research/base.py](https://pypi.org/project/exa-py/2.28.0/)
- 2026 releases: Instant search (5 Feb), `maxAgeHours` + highlights `maxCharacters` (2 Feb), Company Search (21 Jan), pricing update (3 Mar), Deep revamp with `outputSchema` + `deep-reasoning` (4 Mar), Monitors (30 Mar), Exa Agent (16 Jun), Exa Connect (24 Jun), Agent in MCP (1 Jul), `publication` category (23 Jul), Dynamic Highlights (28 Aug), Agent Ultra (24 Sep), `lite` type plus warnings and notices (19 Oct) — [Changelog](https://exa.ai/docs/changelog.md)
- Exa Agent: "an async, usage-based web research agent API for high-compute tasks like list building, enrichment, and deep research", `POST /agent/runs`, returns `output.text`, `output.structured` (when `outputSchema` is given), `output.grounding`, `costDollars` — [Agent quickstart](https://exa.ai/docs/agent/quickstart.md)
- Monitors: "Run recurring searches and receive newly discovered results by webhook", minimum interval 1 hour, supports `outputSchema` — [Changelog](https://exa.ai/docs/changelog.md), [llms.txt](https://docs.exa.ai/llms.txt)
- Batch API: "Run Exa API requests asynchronously in batches" — [llms.txt](https://docs.exa.ai/llms.txt)
- Hosted MCP server at `https://mcp.exa.ai/mcp`; Agent tool via `?tools=agent_run` — [llms.txt](https://docs.exa.ai/llms.txt), [Changelog](https://exa.ai/docs/changelog.md)
- Index size: "As of October 2026, Exa's index tracks over 2 trillion URLs and serves 100 billion pages" — [FAQs](https://exa.ai/docs/admin/faqs.md)

### Inferences
- For a weekend "Internet Butler": `/search` (auto or deep, with highlights) is the workhorse; `/contents` handles known URLs, subpage crawls and forced-fresh reads; Snapshot (`snapshotAsOf`) covers "past versions"; Monitors is a strong demo hook for "keep watching this for me" (webhook on new results). Use the Agent API only for long multi-hop jobs. It is async, so your UI has to poll or stream.
- Do not build on `/research` or `exa.research.*`. JS rejects with 410 locally. Python probably fails at the server (inferred).

### Gaps
- I found no documented sunset date for `/findSimilar`. It is deprecated but still in the spec.

---

## 2. Search modes: exact `type` values, latency, when to use

### Takeaway
Exa now recommends **`lite`, `auto`, `deep`**, plus **`deep-lite`**. `fast`, `instant` and `deep-reasoning` are legacy but still accepted. `neural`/`keyword` no longer appear in the API spec's documented values (the SDK types still list some). The brief's "fast, balanced and deep" maps to `lite` (or legacy `fast`), `auto`, and `deep`/`deep-lite`. The default is `auto`.

### Cited Findings
- Spec `type` values (default `auto`): `auto` "balanced… recommended for most applications"; `lite` "Low-cost, low-latency search for real-time and interactive experiences"; `deep-lite` "lightweight research with synthesized results and a consistent 4-second latency"; `deep` "comprehensive multi-step research with synthesis"; `instant` "Legacy. Use `lite`… Unlike `lite`, it accepts every search parameter"; `fast` "Legacy. Use `lite`… accepts every search parameter"; `deep-reasoning` "Legacy. Use `deep`". The schema also allows any other string — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- Latency table: `auto` ~1 second; `lite` ~300 ms; `deep-lite` ~4 seconds; `deep` 4–15 seconds. "Latency figures are approximate and cover the search itself with cached content. `outputSchema` adds a synthesis step and a low `contents.maxAgeHours` adds a fresh page fetch" — [Search quickstart](https://exa.ai/docs/search/quickstart.md)
- `outputSchema` "adds about 2 seconds of synthesis latency on top of the selected search type" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- Historical figures: Fast p50 below 425 ms (Jul 2025); Instant sub-150 ms (Feb 2026); `deep-reasoning` 12–50 s and `deep` 4–12 s (Mar 2026) — [Changelog](https://exa.ai/docs/changelog.md)
- `lite`: "serves page content from Exa's cache and never fetches a page live. When you request `text` or `highlights`, results with no cached copy are left out of the response." Supported: `query`, `numResults` (≤100), `contents.highlights`, `contents.text`, `contents.snapshotAsOf`, `category` (all, including `company`/`people`), `includeDomains`, `excludeDomains`, `startPublishedDate`, `endPublishedDate`, `userLocation`, `moderation`, `objective`, `userIdentifier`, `compliance`. Anything else returns `400 INVALID_REQUEST_BODY` naming each unsupported parameter, including `outputSchema`, `systemPrompt`, `stream`, `additionalQueries`, `contents.summary`, `contents.extras`, `contents.subpages`, `contents.subpageTarget`, `contents.maxAgeHours` (any value, **including -1**), `contents.livecrawl`, `contents.livecrawlTimeout`, `includeText`, `excludeText`, crawl dates, and `contents.context`. "A parameter set to `null` counts as unset. Any other value, including `false` and an empty list, counts as set." — [Search quickstart](https://exa.ai/docs/search/quickstart.md)
- Legacy mapping: `instant` → `lite`; `fast` → `lite` ("runs the same search as `fast`"), or `auto` when you need a parameter `lite` lacks; `deep-reasoning` → `deep` or Exa Agent — [Search quickstart](https://exa.ai/docs/search/quickstart.md)
- Deep process: plan (query expansion, optional `additionalQueries`, at most 10, "available only to Deep search types"), search and inspect, refine, then select and synthesize. "Start with `deep` for research workflows. Move to `deep-lite` when the task is simpler and latency matters." "`numResults` controls how many selected pages are returned… It does not set the number of searches Deep may perform." — [Deep Search](https://exa.ai/docs/search/deep-search.md)
- When to stay on standard search: you need pages rather than a conclusion, the query targets a narrow source, your app does its own reasoning, or the path is interactive, autocomplete or voice — [Deep Search](https://exa.ai/docs/search/deep-search.md)
- Deep is "recommended by default when using `outputSchema`"; use Deep for "structured outputs that cannot be filled with a single search (3+ fields)" — [Best practices](https://exa.ai/docs/search/best-practices.md)
- SDK vs spec mismatch: exa-py `SearchType = Literal["auto","fast","deep-lite","deep","deep-reasoning","neural","instant","lite"]`, docstring "'neural' uses embedding-based semantic search", and "any other string" is passed through — [exa-py 2.28.0 api.py](https://pypi.org/project/exa-py/2.28.0/). exa-js `NonDeepSearchType = "keyword" | "neural" | "auto" | "hybrid" | "fast" | "instant" | "lite"`; `DeepSearchType = "deep-lite" | "deep" | "deep-reasoning"` — [exa-js 2.28.0 index.d.ts](https://www.npmjs.com/package/exa-js/v/2.28.0)
- Jul 2025: "Auto search: no longer returns `score`… Neural search: scores are unchanged. Set `type="neural"` if you depend on them." — [Changelog](https://exa.ai/docs/changelog.md)

### Inferences
- Recommended routing for the Butler: `lite` for quick lookups and autocomplete-style tool calls (cache only, so never for prices or availability); `auto` as the default agent tool; `deep` with `outputSchema` when the butler has to produce a list or comparison table; Agent API for jobs over 30 s.
- `neural`/`keyword` may still work because the API accepts any string, but they are not in the spec's documented list. Do not depend on them, or on `score`, which the current spec's result schema no longer includes.

### Gaps
- No documented latency for legacy `fast`/`instant` beyond the 2025/Feb 2026 changelog figures. No documented `numResults` cap per type beyond "Limits vary by search type… maximum public limit is 100".

---

## 3. Filters

### Takeaway
Live filters: `includeDomains`/`excludeDomains` (≤1200, path prefixes and `*.` wildcards), `startPublishedDate`/`endPublishedDate` (ISO 8601), `category`, `userLocation`, `moderation`, `numResults` (1–100, default 10). **Crawl-date filters are ignored. `includeText`/`excludeText` are deprecated.** `company` and `people` reject date filters with a 400, and `people` also rejects `excludeDomains`.

### Cited Findings
- `includeDomains` / `excludeDomains`: arrays, `maxItems: 1200`. Each entry can be a hostname (`example.com`), a hostname with a path prefix (`example.com/docs`), or a wildcard subdomain (`*.example.com`). "Use this parameter for domain or path filtering instead of adding a `site:` operator" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- `startPublishedDate` / `endPublishedDate`: `format: date-time`, "Only links with a published date after/before this will be returned. Must be specified in ISO 8601 format." `publishedDate` in results is "An estimate of the creation date, from parsing HTML content" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- `startCrawlDate` / `endCrawlDate`: "Deprecated. Ignored by the API. Setting it adds an `IGNORED_FIELD` warning" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml); "deprecated parameters are now ignored for all teams" (23 Jul 2026) — [Changelog](https://exa.ai/docs/changelog.md)
- `includeText` / `excludeText`: "Deprecated… Matching is approximate (word-level rather than exact phrase)… Up to 50 strings, each up to 4096 characters." Docs say put the terms in the query instead — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Best practices](https://exa.ai/docs/search/best-practices.md)
- `category` enum: `company`, `publication`, `news`, `personal site`, `financial report`, `people`. "Other strings are accepted and used as category hints." "`company` and `people` do not support `startPublishedDate` or `endPublishedDate`, and `people` also does not support `excludeDomains`. Requests that set an unsupported filter return a 400 error." — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- Category history: `publication` replaces `research paper`; `pdf`, `github` and `tweet` are being deprecated (Jul 2026); `people` replaced `linkedin` (Dec 2025) and spans "1B+ public profiles"; `company` uses a fine-tuned retrieval model and returns "typed company info (workforce, HQ, financials, web traffic)" (Jan 2026) — [Changelog](https://exa.ai/docs/changelog.md)
- Results carry `entities[]` (company, person or publication entity objects) "for supported entity-backed categories and for product listing pages" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- `userLocation`: a two-letter ISO 3166-1 string (`"US"`) or an object `{country}`, `{latitude, longitude}` or both. "Coordinates are used only for queries that name no place but depend on where the user is… They do not set a country, so send `country` with them" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Search quickstart](https://exa.ai/docs/search/quickstart.md)
- `moderation`: boolean, default false, "filter unsafe content" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- `numResults`: default 10, min 1, max 100; "Search does not support pagination" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Search quickstart](https://exa.ai/docs/search/quickstart.md). `INVALID_NUM_RESULTS`: "`numResults` must be ≤ 100 when highlights are requested"; `NUM_RESULTS_EXCEEDED`: over the plan limit — [Error codes](https://exa.ai/docs/admin/error-codes.md)
- Language: "Exa now detects your query language and returns results only in that language. Enabled by default" (Nov 2025) — [Changelog](https://exa.ai/docs/changelog.md)
- `objective` (≤4096 chars): "The broader goal this search serves". Exa recommends, verbatim, as a tool-parameter description: "Goal for this search turn; say which documents should rank first, which should be excluded, and what specific facts or figures to pull from them." — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Best practices](https://exa.ai/docs/search/best-practices.md)
- `userIdentifier`: an opaque end-user ID of 1–64 chars `[A-Za-z0-9_-]` that "Must not contain personal information… Retained even when your team has Zero Data Retention enabled. Does not affect results." — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- Filter philosophy: "Filters are hard constraints… keep softer source preferences in the query text instead" — [Search quickstart](https://exa.ai/docs/search/quickstart.md)
- `site:` in the query: if nothing matches, Exa removes the operator and returns a `RESTRICTIONS_RELAXED` notice; "Filters in the request body, such as `includeDomains`, still apply" — [Best practices](https://exa.ai/docs/search/best-practices.md)

### Inferences
- Since the brief mentions "people and personal websites": use `category:"people"` with no date filters and no `excludeDomains`, otherwise you get a 400. For "news from the last week", use `category:"news"` + `startPublishedDate`.
- `userLocation: "FI"` is the natural default for a demo in Espoo.

### Gaps
- No documented hard "category silently disables other filters" behaviour on `/search`. The current spec says unsupported combinations return 400. But the `/findSimilar` spec text says "With `company` or `people`, domain, URL, published-date, and text filters are ignored", which is inconsistent with `/search` (400). Test both.

---

## 4. Contents options and what comes back

### Takeaway
On `/search`, content options sit under `contents: {...}`. On `/contents` they sit at the **top level** next to `urls`/`ids`. Current controls: `text` {maxCharacters, includeHtmlTags, linkStyle, verbosity, include/excludeSections}, `highlights` {query, maxCharacters, verbosity, dynamic}, `summary` {query, schema}, `extras` {links, imageLinks, richImageLinks}, `maxAgeHours` + `livecrawlTimeout` (freshness), `snapshotAsOf` (history), `subpages` + `subpageTarget` (**only on `/contents` now; deprecated on `/search`**). `livecrawl`, `numSentences`, `highlightsPerUrl`, `context` and `crawledBeforeDate` are deprecated.

### Cited Findings
- Placement warning: "`/search` nests `highlights`, `text`, and `summary` inside the `contents` object… `/contents` has no `contents` wrapper" — [Search quickstart](https://exa.ai/docs/search/quickstart.md). A top-level `text` on `/search` is ignored and produces an `IGNORED_FIELD` warning — [Best practices](https://exa.ai/docs/search/best-practices.md)
- `/contents` request: `urls` or `ids` (interchangeable; "Provide either `ids` or `urls`, but not both"), maxItems 100, each ≤2048 chars — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Contents quickstart](https://exa.ai/docs/contents/quickstart.md)
- **text**: `true` or an object. `maxCharacters` (1–1,000,000 on search; 1–5,000,000 on /contents, "Defaults to 5,000,000"); `includeHtmlTags` (default false; markdown otherwise); `linkStyle` `"full"` (`[anchor](url)`) or `"citation"` (`[anchor][n]` with the list at the end, which "A `maxCharacters` limit can cut off"); `verbosity` `compact` (default) | `standard` | `full`; `includeSections` / `excludeSections` ("Best-effort"). "Set `maxAgeHours: 0` to apply `includeHtmlTags`, `verbosity`, and section filters to freshly fetched content." — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml). The exa-py docstring is stricter: verbosity and sections "Requires max_age_hours=0 to take effect" — [exa-py 2.28.0 api.py](https://pypi.org/project/exa-py/2.28.0/)
- Default output is clean markdown since Jun 2025; `includeHtmlTags=true` gives HTML. "Either way, boilerplate like ads and navigation is stripped." — [Changelog](https://exa.ai/docs/changelog.md)
- **highlights**: `true` (recommended; "Exa chooses how much text to return from each result based on its relevance") or an object: `query` (custom steering), `maxCharacters` (1–1,000,000, "total length of highlight text returned per URL", not compatible with `dynamic`), `verbosity` `low|medium|high` (beta, needs the dynamic-highlights header, not compatible with maxCharacters), `dynamic` (research preview; header `Exa-Beta: dynamic-highlights-2026-08-28` required, "requests setting `dynamic` without it are rejected"). Deprecated: `numSentences` ("mapped to a character budget of about 1333 characters per sentence"), `highlightsPerUrl` ("Currently ignored") — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Highlights](https://exa.ai/docs/search/highlights.md)
- Highlights quality claims: "500 characters of highlights match the accuracy of the first 8,000 characters of page text"; "Highlights cut search tokens by 5x on average" — [Highlights](https://exa.ai/docs/search/highlights.md)
- Highlights come back as `results[].highlights: string[]`. **`highlightScores` was removed 1 May 2026** — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Changelog](https://exa.ai/docs/changelog.md)
- **summary**: object `{query?, schema?}`; "Summary makes a language model call for each page". With `schema`, "The summary comes back as a JSON string matching the schema; parse it" — [Contents quickstart](https://exa.ai/docs/contents/quickstart.md). Summaries cost extra ($1/1k per the Mar 2026 pricing note) — [Changelog](https://exa.ai/docs/changelog.md)
- Combining views: "Requesting highlights, text, and summary together returns and bills each view separately." — [Contents quickstart](https://exa.ai/docs/contents/quickstart.md)
- **extras**: `links` (0–1000, default 0), `imageLinks` (0–1000), `richImageLinks` (0–1000, `{url, alt}`); `richLinks` and `codeBlocks` are deprecated on `/search` (still listed, not marked deprecated, on `/contents`). Response: `results[].extras.links[]`, `.imageLinks[]`, `.richImageLinks[]`, `.richLinks[]`, `.codeBlocks[]` — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- **Freshness**: `maxAgeHours` integer −1..720. Omit: cache if available, else live fetch. Positive N: use cache if newer than N hours, else fetch ("A failed fetch may return the latest cached copy instead"). `0`: "live content, fetched within the last 60 seconds". `-1`: cache only. "It does not filter results by publication date." — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Search quickstart](https://exa.ai/docs/search/quickstart.md)
- `livecrawlTimeout`: ms, default 10000, max 90000. "Raise it to 12000–15000 for slow sites" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Contents quickstart](https://exa.ai/docs/contents/quickstart.md)
- `livecrawl` (`never|always|fallback|preferred`) is deprecated, "Does not guarantee freshly fetched content. Cannot be combined with `maxAgeHours`." Migration: always→`maxAgeHours:0`; never→`-1`; fallback→omit; preferred→a low value such as `1` — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Contents quickstart](https://exa.ai/docs/contents/quickstart.md)
- "Repeated `maxAgeHours: 0` requests for the same page within 60 seconds can return the same copy of the page." — [Contents quickstart](https://exa.ai/docs/contents/quickstart.md)
- **subpages**: integer 0–100 on `/contents` ("The actual number crawled may be limited by system constraints"); `subpageTarget`: a string or an array (≤100 items, each ≤100 chars). On `/search`, both are "Deprecated… To crawl subpages, send the result URLs to `/contents` with `subpages`." `SUBPAGES_LIMIT_EXCEEDED`: "`/contents` allows at most 100 subpages per request." Response: `results[].subpages[]` — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Error codes](https://exa.ai/docs/admin/error-codes.md)
- **context** (the combined context string option, `contents.context` / top-level `context` with `maxCharacters`): "Deprecated. Use `highlights` or `text` instead." The response field `context` is deprecated too — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- Result fields: `title`, `url`, `publishedDate`, `author`, `id` ("temporary ID… Useful for the /contents endpoint"), `image`, `favicon`, `text`, `highlights[]`, `summary` (string), `subpages[]`, `entities[]`, `extras{}`. No `score` field in the current result schema — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- exa-py `_Result` also defines `score`, `crawl_date` and `snapshot_at` (Optional). These are not in the spec — [exa-py 2.28.0 api.py](https://pypi.org/project/exa-py/2.28.0/)
- `/contents` response: `results[]`, `statuses[]` with `{id, status: "success"|"error", source: "cached"|"crawled", error?: {tag, httpStatusCode}}`, `costDollars`, `searchTime` — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- Contents handles "JavaScript-rendered pages, PDFs, and complex layouts automatically" — [Contents quickstart](https://exa.ai/docs/contents/quickstart.md)
- `filterEmptyResults?: boolean` exists in exa-js `ContentsOptions` — [exa-js 2.28.0 index.d.ts](https://www.npmjs.com/package/exa-js/v/2.28.0) (not in the spec).

### Inferences
- `statuses[].source` tells you whether you got a cached or freshly crawled copy. Log it to debug "stale page" complaints.
- For a butler checking prices or availability, use `/contents` with `maxAgeHours: 0, livecrawlTimeout: 15000`, plus `highlights: {query: "price"}` or `summary: {schema}`.

### Gaps
- Per-highlight scores are gone and nothing replaces them. The valid `includeSections` tag list is an enum in exa-py (`SECTION_TAG`), but I did not extract it.

---

## 5. Structured JSON: how to request it, and the limits

### Takeaway
There are four routes. (1) `outputSchema` on `/search` (any type except `lite`) gives `output.content` + field-level `output.grounding`, capped at 10 properties total and 2 nesting levels. (2) `contents.summary.schema` gives per-page JSON returned **as a string**. (3) `outputSchema` on `/answer` gives `answer` as an object. (4) `outputSchema` on `/agent/runs` gives `output.structured`, for wide or complex schemas.

### Cited Findings
- `/search` `outputSchema`: root `type` `"text"` (with optional `description`) or `"object"` (`properties`, `required`, `additionalProperties`, `description`). "Works with every search type except `lite` and adds about 2 seconds of synthesis latency… Object schemas are limited to 10 properties in total (nested and array items properties count toward the limit) and 2 levels of nesting, and every array must define items." — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- Validated before the search runs; violations give a 400, e.g. "`output_schema exceeds maximum of 10 properties`". "Do not add citation or confidence fields to your own schema; Exa returns them automatically." — [Deep Search](https://exa.ai/docs/search/deep-search.md)
- Response `output.content` (a string, or an object when the schema is an object) and `output.grounding[]` = `{field: "companies[0].funding", citations: [{url, title}], confidence: "low"|"medium"|"high"}` — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- `systemPrompt` steers sources and behaviour; `outputSchema` sets the shape. Python: `system_prompt`, `output_schema` — [Search quickstart](https://exa.ai/docs/search/quickstart.md)
- Streaming: `stream: true` returns SSE "only when `outputSchema` is set"; event types `text-delta`, `grounding`, `results` (carries `warnings`/`notices`), `stream-reset`, `done` (final `output`, `searchTime`, `costDollars`), and an error chunk; ends with `data: [DONE]` — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Best practices](https://exa.ai/docs/search/best-practices.md)
- `INVALID_JSON_SCHEMA` (400): "The provided output schema is invalid." — [Error codes](https://exa.ai/docs/admin/error-codes.md)
- Summary schema: a JSON Schema in `summary.schema` (the docs example uses draft 2020-12 `$schema`); the result is a JSON string — [Contents quickstart](https://exa.ai/docs/contents/quickstart.md). exa-py accepts a Pydantic model or a dict for `schema` — [exa-py 2.28.0 api.py](https://pypi.org/project/exa-py/2.28.0/)
- `/answer` `outputSchema`: "A JSON Schema Draft 7 specification… the answer is returned as a structured object" — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml). exa-js `answer<T>(query, {outputSchema: ZodSchema<T>})` returns `AnswerResponseTyped<T>` — [exa-js 2.28.0 index.d.ts](https://www.npmjs.com/package/exa-js/v/2.28.0)
- Agent: "If you need more than 10 fields, split the work into several Deep requests with focused schemas, or use Exa Agent for wide enrichment tables" — [Deep Search](https://exa.ai/docs/search/deep-search.md). Agent schemas can use nullable unions, enums and `additionalProperties:false` (see the docs example) — [Agent quickstart](https://exa.ai/docs/agent/quickstart.md)

### Inferences
- Search `outputSchema` is the cleanest demo: one call gives grounded JSON with per-field citations and confidence, which you can render as "verified by source X". Budget the 10-property cap, e.g. `{options: [{name, price, url, note}]}` = 5 properties.
- For per-page extraction across many URLs (for example, pulling price and opening hours off 10 shop pages), `summary.schema` is cheaper and parallel, but you must `json.loads` each summary.

### Gaps
- No documented property, nesting or size limits for `summary.schema` or `/answer` `outputSchema`.

---

## 6. "Retrieve past versions of web pages" = Exa Snapshot (`snapshotAsOf`)

### Takeaway
`snapshotAsOf` (ISO date-time or `YYYY-MM-DD`) on `/search` (inside `contents`) or `/contents` (top level) returns the newest stored version at or before that instant. It covers a rolling 5-month window. **The free tier does not include it (403 `SNAPSHOT_NOT_ON_PLAN`)**, and pay-as-you-go gets a 100-request trial.

### Cited Findings
- "Exa Snapshot keeps stored versions of pages Exa has crawled. Send `snapshotAsOf` to pin the request to a datetime." Uses: backtesting, reproducible evals, comparing earlier versions of docs, pricing pages, policies and filings — [Snapshot](https://exa.ai/docs/search/snapshot.md)
- On Search: "Exa discovers candidate URLs, then keeps only pages with a stored version at or before `snapshotAsOf`." "On Search, the cutoff bounds content, not ranking." — [Snapshot](https://exa.ai/docs/search/snapshot.md)
- On Contents: IDs with no eligible version "are omitted from `results` and reported in `statuses` with… `CONTENT_NOT_CACHED`… `httpStatusCode: 404`" — [Snapshot](https://exa.ai/docs/search/snapshot.md)
- Title, author, date, text, highlights and summaries all come from that stored version — [Snapshot](https://exa.ai/docs/search/snapshot.md)
- Cannot be combined with `livecrawl`, `livecrawlTimeout`, `maxAgeHours` or `subpages` ("rejected with `INVALID_REQUEST`") — [Snapshot](https://exa.ai/docs/search/snapshot.md)
- Supported search types: `auto`, `fast`, `instant`, `lite`; `deep-lite` only where enabled; **not `deep` or `deep-reasoning`**. All categories supported — [Snapshot](https://exa.ai/docs/search/snapshot.md)
- Plans: Free = not included (`403 SNAPSHOT_NOT_ON_PLAN`). Pay-as-you-go = "100 requests at 10 QPS, up to 10 search results or 1 contents URL per request. Past that… `403` `SNAPSHOT_TRIAL_EXHAUSTED` or `SNAPSHOT_TRIAL_CAP_EXCEEDED`." Enterprise = per contract (`SNAPSHOT_NOT_IN_CONTRACT`). A `snapshotAsOf` older than the 5-month window is rejected — [Snapshot](https://exa.ai/docs/search/snapshot.md), [Billing](https://exa.ai/docs/admin/billing.md)
- `crawledBeforeDate` is a deprecated alias of `snapshotAsOf` — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)

### Inferences
- **Hackathon risk:** if the team's key is on the free tier (or hackathon credits sit on a free-tier team), Snapshot will 403. Ask Exa's on-site team early whether hackathon keys include Snapshot. With only 100 trial requests and 1 URL per contents call, use it sparingly (for example, a "what changed on this pricing or policy page since last month" demo). Compare the snapshot text with a `maxAgeHours:0` fetch.

### Gaps
- Docs do not say how often versions are stored per page (snapshot granularity), so you cannot assume a version exists for a given day.

---

## 7. Answer API and the Research API's replacement (Agent)

### Takeaway
`POST /answer` runs a search plus an LLM answer with `citations[]`, optional SSE streaming and optional `outputSchema`. Models: `exa` (default), `exa-pro`, `exa-research`, `exa-fast` per the spec (the Python SDK types only `exa`/`exa-pro`). The Research API is gone. Use `/search type:"deep"` or **Exa Agent** (`/agent/runs`, `effort` = minimal|low|medium|high|xhigh|auto|ultra).

### Cited Findings
- `/answer` request: `query` (required, minLength 1), `stream` (default false), `text` (bool; include full source text in citations), `model` enum `exa|exa-pro|exa-research|exa-fast` default `exa`, `systemPrompt`, `userLocation`, `outputSchema`, `userIdentifier` — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- Behaviour: a direct answer for specific queries ("capital of France" → "Paris"), or "A detailed summary with citations for open-ended queries" — [Answer reference](https://exa.ai/docs/reference/answer.md)
- Response: `answer` (string or object), `citations[]` = `{title, url, publishedDate, author, id, image, favicon, text?}`, `costDollars`, `requestId` — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- Stream chunks: OpenAI-style `choices[].delta.content`; a citations chunk `{citations: [...]}`; a cost chunk `{costDollars, requestId}`; an error chunk — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- exa-py `answer(query, *, stream=False, text=False, system_prompt=None, model: Literal["exa","exa-pro"]=None, output_schema=None, user_location=None, user_identifier=None, ...)` and `stream_answer(...)` — [exa-py 2.28.0 api.py](https://pypi.org/project/exa-py/2.28.0/). exa-js `answer(query, options?)`, `streamAnswer(query, options?)` (async generator; chunks have `.content` and `.citations`) — [SDK quickstart](https://exa.ai/docs/sdks/quickstart.md), [exa-js 2.28.0 index.d.ts](https://www.npmjs.com/package/exa-js/v/2.28.0)
- Rate limit: `/answer` and `/chat/completions` default to 10 QPS — [Billing](https://exa.ai/docs/admin/billing.md)
- Agent API: `exa.agent.runs.create(query=..., output_schema=..., effort="auto", system_prompt=..., stream=...)`; `exa.agent.runs.poll_until_finished(run_id, poll_interval=4000)`; also `get`, `list`, `cancel`, `stop`; JS `createAndWait`, `pollUntilFinished`. SSE events such as `agent_run.created`. Output `output.text`, `output.structured`, `output.grounding`, `costDollars`. Continue a run with `previousRunId` — [Agent quickstart](https://exa.ai/docs/agent/quickstart.md), [Best practices](https://exa.ai/docs/search/best-practices.md), [exa-js index.d.ts](https://www.npmjs.com/package/exa-js/v/2.28.0)
- Agent `effort` enum `minimal, low, medium, high, xhigh, auto, ultra`, default `auto`. "Fixed efforts have a predictable per-request price, while `auto` and `ultra` are metered"; `budget.maxCostDollars` $1–$100; Ultra default cap $20/run, `budget.maxDurationSeconds` 5 min–3 h — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml), [Agent quickstart](https://exa.ai/docs/agent/quickstart.md), [Changelog](https://exa.ai/docs/changelog.md)
- "Exa Agent is higher-latency and async by design." — [Agent quickstart](https://exa.ai/docs/agent/quickstart.md)
- Agent limits: 50 concurrent runs (`429 CONCURRENCY_LIMIT_REACHED`); each run start counts as 2 requests against QPS; GET polling does not count against QPS — [Billing](https://exa.ai/docs/admin/billing.md)
- Exa Connect `dataSources` on `POST /agent/runs` (Similarweb, Fiber.ai, Baselayer, Financial Datasets, Affiliate.com, Particle, **Jinko: flight and hotel search with real-time pricing**, and others) — [Changelog](https://exa.ai/docs/changelog.md), [llms.txt](https://docs.exa.ai/llms.txt)

### Inferences
- Jinko (flights and hotels) and Affiliate.com (product catalogs) through Exa Connect are directly relevant to butler tasks such as trip planning and shopping. They are worth a look by whoever covers the Agent API.
- For a chat UI, `/answer` streaming is the fastest way to show cited text.

### Gaps
- No documented per-model difference or latency for `/answer` models (`exa` vs `exa-pro` vs `exa-research` vs `exa-fast`). Agent runtime per effort is only qualitative ("Slowest fixed effort", etc.); the full price and runtime table is in the Agent docs and pricing pages, which another researcher covers.

---

## 8. findSimilar

### Takeaway
`POST /findSimilar` takes a `url` and returns semantically similar pages, with optional contents, domain, date and category filters and `excludeSourceDomain`. It is **deprecated** in the spec and both SDKs ("no direct replacement for URL-based similarity"). It still works, but plan around `/search`.

### Cited Findings
- Request: `url` (required), `numResults` (1–100, default 10), `includeDomains`/`excludeDomains`, `startPublishedDate`/`endPublishedDate`, `category`, `excludeSourceDomain` (bool: exclude the source URL's domain), `contents` (same ContentsOptions), and deprecated `includeText`/`excludeText`/crawl dates — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- "Deprecated: prefer `/search` with a query describing the source." — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- exa-py: `@deprecated("find_similar()/findSimilar is deprecated. Use search() instead.")`; `find_similar_and_contents` also deprecated — [exa-py 2.28.0 api.py](https://pypi.org/project/exa-py/2.28.0/). exa-js: "@deprecated Use `search()` instead. There is no direct replacement for URL-based similarity." — [exa-js 2.28.0 index.d.ts](https://www.npmjs.com/package/exa-js/v/2.28.0)

### Inferences
- It is still useful for "find me more shops or services like this one" (pass the URL, set `excludeSourceDomain: true`). Expect deprecation warnings and a `Deprecation` response header.

### Gaps
- No removal date documented.

---

## 9. SDKs: versions, method names, async, runnable examples

### Takeaway
**exa-py 2.28.0** (Python ≥3.9) and **exa-js 2.28.0**, both released 6 Nov 2026. Main methods: `search` (contents nested under `contents`), `stream_search`/`streamSearch`, `get_contents`/`getContents` (flat options), `answer`, `stream_answer`/`streamAnswer`, `agent.runs.*`, `monitors`, `websets`, plus tool-calling helpers (`exa.openai`, `exa.anthropic`, `exa.tools`). `search_and_contents`/`searchAndContents` and `find_similar*` are deprecated. `research.*` is retired. Async in Python via `AsyncExa`. **Python SDK keys are snake_case at every nesting level.**

### Cited Findings
- Versions: PyPI exa-py latest 2.28.0 (uploaded 2026-11-06), requires_python ≥3.9 — [PyPI exa-py](https://pypi.org/project/exa-py/). npm exa-js `latest` = 2.28.0 (2026-11-06) — [npm exa-js](https://www.npmjs.com/package/exa-js)
- 2.26.0 SDKs log each search `warning` once; Python raises `DeprecationWarning` for ignored options; TS marks them `@deprecated` — [Changelog](https://exa.ai/docs/changelog.md). Silence in Python with `warnings.filterwarnings("ignore", category=ExaWarning)`; in JS with `new Exa(key, undefined, { warnings: "silent" })` or a callback — [SDK quickstart](https://exa.ai/docs/sdks/quickstart.md)
- Oct 2025 major version: "search now includes page contents" by default — [Changelog](https://exa.ai/docs/changelog.md). exa-py ContentsOptions docstring: "If no content options are specified, text with max_characters=10000 is returned by default." — [exa-py 2.28.0 api.py](https://pypi.org/project/exa-py/2.28.0/). exa-js: "`search()`, which returns text contents by default"; pass `contents: false` to opt out — [exa-js 2.28.0 index.d.ts](https://www.npmjs.com/package/exa-js/v/2.28.0)
- exa-py `Exa.search(query, *, stream, contents, num_results, include_domains, exclude_domains, start_crawl_date, end_crawl_date, start_published_date, end_published_date, include_text, exclude_text, type, category, flags, moderation, user_location, additional_queries, system_prompt, output_schema, objective, user_identifier, betas, ...)`. Other methods: `stream_search`, `search_and_contents` (deprecated), `get_contents`, `find_similar` (deprecated), `find_similar_and_contents` (deprecated), `wrap(openai_client)`, `answer`, `stream_answer`. Namespaces `self.websets`, `self.research`, `self.monitors`, `self.agent`, `self.tools`, `self.openai`, `self.anthropic`; `AsyncExa` mirrors all of them with `async def` — [exa-py 2.28.0 api.py](https://pypi.org/project/exa-py/2.28.0/)
- `DYNAMIC_HIGHLIGHTS_BETA = "dynamic-highlights-2026-08-28"` exported from `exa_py.api`; pass `betas=[DYNAMIC_HIGHLIGHTS_BETA]` — [exa-py api.py](https://pypi.org/project/exa-py/2.28.0/), [Highlights](https://exa.ai/docs/search/highlights.md)
- exa-js `class Exa` members: `websets`, `research` (retired), `monitors`, `agent`, `beta`, `tools`, `openai`, `anthropic`; constructor `(apiKey?, baseURL?, options?)`; methods `search`, `streamSearch` (AsyncGenerator), `searchAndContents` (deprecated), `findSimilar` and `findSimilarAndContents` (deprecated), `getContents(urls | results, options?)`, `answer`, `streamAnswer` — [exa-js 2.28.0 index.d.ts](https://www.npmjs.com/package/exa-js/v/2.28.0)
- Python `web_search` tool helpers (`exa.openai.web_search()`, `handle_tool_calls`; `exa.anthropic.web_search()`, `handle_tool_use`) and JS equivalents (`handleToolCalls`, `handleToolUse`, `handleResponsesToolCalls`). "Their web search tools pass notices to the model with the results" and fill in `objective` automatically — [exa-py tools.py](https://pypi.org/project/exa-py/2.28.0/), [Best practices](https://exa.ai/docs/search/best-practices.md), [Changelog](https://exa.ai/docs/changelog.md)

### Minimal examples (built from documented signatures; not run, since there is no key)

**Python (exa-py 2.28.0)**
```python
import json
from exa_py import Exa            # AsyncExa for asyncio
exa = Exa()                       # reads EXA_API_KEY

# 1) Search with highlights + filters
r = exa.search(
    "best-rated bicycle repair shops in Espoo open on Saturday",
    type="auto",                  # "lite" for ~300 ms cache-only; "deep" for research
    num_results=5,
    user_location="FI",
    start_published_date="2026-01-01T00:00:00.000Z",   # omit for category company/people
    objective="Find shops the user can visit this weekend; prefer official shop pages; pull hours and price for a tune-up.",
    contents={"highlights": True},                     # snake_case inside: {"max_age_hours": 24}
)
for x in r.results:
    print(x.title, x.url, x.published_date, x.highlights)

# 2) Search returning structured JSON with grounding (not allowed with type="lite")
r = exa.search(
    "Compare monthly prices of the three cheapest mobile data plans in Finland",
    type="deep",
    system_prompt="Prefer operator pricing pages over news.",
    output_schema={                                    # <=10 properties total, <=2 nesting levels
        "type": "object", "required": ["plans"],
        "properties": {"plans": {"type": "array", "maxItems": 3, "items": {
            "type": "object", "required": ["operator", "price_eur"],
            "properties": {"operator": {"type": "string"},
                           "price_eur": {"type": "number"},
                           "data_gb": {"type": "string"},
                           "url": {"type": "string"}}}}},
    },
)
print(r.output.content if r.output else None)          # dict
print(r.output.grounding if r.output else None)        # per-field citations + confidence

# 2b) Per-page structured summary (comes back as a JSON *string*)
r = exa.search("Espoo libraries opening hours", num_results=3,
               contents={"summary": {"query": "opening hours",
                                     "schema": {"type": "object",
                                                "properties": {"name": {"type": "string"},
                                                               "hours": {"type": "string"}}}}})
rows = [json.loads(x.summary) for x in r.results if x.summary]

# 3) Contents: subpages + forced fresh crawl (subpages only on get_contents now)
c = exa.get_contents(
    ["https://www.example-shop.fi"],
    subpages=10, subpage_target=["pricing", "contact"],
    max_age_hours=0, livecrawl_timeout=15000,          # do not also send livecrawl
    text={"max_characters": 8000},
)
for s in c.statuses: print(s)                          # per-URL success/error + cached/crawled
for p in c.results: print(p.url, [sp.url for sp in (p.subpages or [])])

# 4) Answer with citations (+ streaming)
a = exa.answer("When does Junction 2026 take place and where?", text=False)
print(a.answer); [print(cit.url) for cit in a.citations]
for chunk in exa.stream_answer("Explain Finnish recycling deposit rules"):
    print(chunk, end="", flush=True)
```

**TypeScript (exa-js 2.28.0)**
```ts
import Exa from "exa-js";
const exa = new Exa(); // EXA_API_KEY

// 1) Search with highlights
const r = await exa.search("best-rated bicycle repair shops in Espoo open on Saturday", {
  type: "auto", numResults: 5, userLocation: "FI",
  objective: "Find shops the user can visit this weekend; pull hours and tune-up price.",
  contents: { highlights: true },          // or { highlights: { query: "opening hours", maxCharacters: 1500 } }
});
for (const x of r.results) console.log(x.title, x.url, x.publishedDate, x.highlights);

// 2) Structured output with grounding
const s = await exa.search("Compare the three cheapest mobile data plans in Finland", {
  type: "deep",
  systemPrompt: "Prefer operator pricing pages.",
  outputSchema: { type: "object", required: ["plans"], properties: { plans: { type: "array", maxItems: 3,
    items: { type: "object", required: ["operator", "priceEur"], properties: {
      operator: { type: "string" }, priceEur: { type: "number" }, url: { type: "string" } } } } } },
});
console.log(s.output?.content, s.output?.grounding);

// 3) Contents with subpages + fresh crawl (flat options, no `contents` wrapper)
const c = await exa.getContents(["https://www.example-shop.fi"], {
  subpages: 10, subpageTarget: ["pricing", "contact"],
  maxAgeHours: 0, livecrawlTimeout: 15000, text: { maxCharacters: 8000 },
});
console.log(c.statuses, c.results.map(p => p.subpages?.map(sp => sp.url)));

// 4) Answer + streaming
const a = await exa.answer("When does Junction 2026 take place and where?");
console.log(a.answer, a.citations.map(c => c.url));
for await (const chunk of exa.streamAnswer("Explain Finnish recycling deposit rules")) {
  if (chunk.content) process.stdout.write(chunk.content);
}
```

### Inferences
- `c.statuses` is a documented response field, but I did not confirm that the Python `SearchResponse` object exposes `.statuses` as an attribute (inferred; fall back to the raw dict if it is missing). JS `getContents` returns `SearchResponse<T>`, which in practice carries `statuses` (inferred).

### Gaps
- I did not read the GitHub releases pages, only the published package source, so per-version release notes for 2.27/2.28 are not covered.

---

## 10. OpenAI-compatible endpoints

### Takeaway
`/chat/completions` (model `exa`) wraps `/answer`. `/responses` (model `exa-agent`) wraps the Agent API in sync, streaming or background modes. Point the OpenAI SDK at `base_url="https://api.exa.ai"`.

### Cited Findings
- "`/chat/completions` routes to `/answer`, and `/responses` routes to the Agent API." Use `extra_body={"text": True}` for `/answer` params; citations are at `completion.choices[0].message.citations` — [OpenAI SDK compatibility](https://exa.ai/docs/integrations/openai-sdk.md)
- `/responses`: `model: "exa-agent"`; modes are sync (default), `stream: true` (Responses SSE events, ending with `response.completed`, no `[DONE]`, may include `: keep-alive` comments), and `background: true` (poll `GET /responses/{id}`); cancel with `POST /responses/{id}/cancel`; `reasoning.effort` (`minimal`…`ultra`); "`high`, `xhigh`, and `ultra`… return `400`" when synchronous; no `budget` field; `previous_response_id` to continue — [OpenAI SDK compatibility](https://exa.ai/docs/integrations/openai-sdk.md)
- `exa.wrap(openai_client)` adds RAG to chat completions: `use_exa="auto"|"required"|"none"`, `num_results` (default 3), `result_max_len` (default 2048), plus any `search()` param — [OpenAI SDK compatibility](https://exa.ai/docs/integrations/openai-sdk.md)
- Rate limits: `/chat/completions` 10 QPS; `/responses` 5 QPS and 50 active runs — [Billing](https://exa.ai/docs/admin/billing.md)

### Inferences
- If the team's agent framework only speaks OpenAI, `/chat/completions` model `exa` is a zero-code cited-answer tool, but you lose search filters. Native tool calling with `exa.openai.web_search()` / `exa.anthropic.web_search()` gives you more control.

### Gaps
- Which `/answer` params `extra_body` accepts beyond `text` is not listed.

---

## 11. Errors, status codes, rate limits

### Takeaway
The error envelope is `{requestId, error, tag}`. Branch on the HTTP status first. `/contents` per-URL failures come back inside a 200 (`statuses`). Default limits: 10 QPS for search, answer and chat; **5 QPS for deep types**; 100 QPS for contents; agent 5 QPS and 50 concurrent. 503 means retry (it is not billed).

### Cited Findings
- Status codes: 400 invalid; 401 bad key; 402 out of credits or budget exceeded (or no key: `X402_PAYMENT_REQUIRED`); 403 feature not on plan, or policy; 404; 409; 422 (Websets preview); 429 rate or concurrency ("wait for `Retry-After` seconds when present, otherwise use exponential backoff"); 500; 503 `SERVICE_OVERLOADED` ("not processed and is not billed… reducing [rate] does not help — retrying does"); 504 timeout — [Error codes](https://exa.ai/docs/admin/error-codes.md)
- Tags: `INVALID_API_KEY`, `NO_MORE_CREDITS`, `API_KEY_BUDGET_EXCEEDED`, `TEAM_BUDGET_EXCEEDED`, `FEATURE_DISABLED`, `PROHIBITED_CONTENT`, `TEAM_BLOCKED`, `CONTENT_FILTER_ERROR`, `RATE_LIMIT_EXCEEDED`, `SERVICE_OVERLOADED`, `INVALID_REQUEST_BODY`, `INVALID_REQUEST` ("Options conflict… or a beta feature was used without its `Exa-Beta` header"), `INVALID_NUM_RESULTS`, `NUM_RESULTS_EXCEEDED`, `INVALID_JSON_SCHEMA`, `SUBPAGES_LIMIT_EXCEEDED`. "The set of tags is open-ended" — [Error codes](https://exa.ai/docs/admin/error-codes.md)
- `/contents` status tags: `CRAWL_NOT_FOUND`, `CRAWL_HTTP_{status}`, `CRAWL_TIMEOUT`, `CRAWL_LIVECRAWL_TIMEOUT`, `SOURCE_NOT_AVAILABLE`, `UNSUPPORTED_URL`, `CRAWL_UNKNOWN_ERROR`, plus `CONTENT_NOT_CACHED` for snapshots. "`httpStatusCode` describes the target page" — [Error codes](https://exa.ai/docs/admin/error-codes.md), [Snapshot](https://exa.ai/docs/search/snapshot.md)
- Rate limits (team-wide across keys): `/search`, `/answer`, `/chat/completions` 10 QPS; `/search` deep-lite/deep/deep-reasoning 5 QPS; `/contents` 100 QPS; `/agent/runs`, `/responses` 5 QPS + 50 active runs; `/websets/*` 20 QPS. Free and PAYG = 10 QPS; PAYG can reach 25 QPS after $1,000 of purchases in 30 days — [Billing](https://exa.ai/docs/admin/billing.md)
- Free tier: $10 credits monthly plus a one-time $10 onboarding bonus. Snapshot is not included — [Billing](https://exa.ai/docs/admin/billing.md)
- Response headers `x-request-id`, `x-exa-queued`, `x-exa-queue-ms` on search, contents and answer — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- Search `warnings[]` (code `IGNORED_FIELD`, `path`, `message`; "Log them; do not pass them to a model") and `notices[]` (code `RESTRICTIONS_RELAXED`; "Pass them to your model"). Neither changes the status code — [Best practices](https://exa.ai/docs/search/best-practices.md)
- Exa MCP free tier without a key: 3 QPS, 150 calls/day — [Changelog](https://exa.ai/docs/changelog.md)

### Inferences
- With a shared team key and two developers plus a live demo, the 5 QPS deep limit is the one you will hit. Fan out with `auto` and reserve `deep` for the final synthesis.

### Gaps
- No documented per-endpoint daily caps for hackathon-issued keys.

---

## 12. Known gotchas for the first hours

### Takeaway
Most first-day breakage comes from copying old examples: wrong nesting (`contents` vs flat), dead params (`livecrawl`, `numSentences`, `useAutoprompt`, crawl dates, `includeText`), `lite` rejecting params, category/date 400s, the SDK fetching text by default, and Snapshot being unavailable on free keys.

### Cited Findings
- Old parameters are silently ignored or 400: `useAutoprompt` (remove it), `includeUrls`/`excludeUrls` (use `include/excludeDomains`), top-level `text`/`highlights` on `/search` (ignored, with a warning), `tokensNum` (use `maxCharacters`), `livecrawl:"always"` (use `maxAgeHours:0`; never send both), `crawledBeforeDate` (use `snapshotAsOf`), `context` (build it yourself), `includeText`/`excludeText`, crawl dates — [Best practices](https://exa.ai/docs/search/best-practices.md), [Contents quickstart](https://exa.ai/docs/contents/quickstart.md)
- `/contents` does not support `stream: true` — [Contents quickstart](https://exa.ai/docs/contents/quickstart.md)
- `lite` drops results that have no cached copy when you request text or highlights, and 400s on `maxAgeHours` even with `-1`; `false` and `[]` count as "set" — [Search quickstart](https://exa.ai/docs/search/quickstart.md)
- Stale content: default behaviour uses the cache when available; "Set [maxAgeHours] when stale page content would be unusable, such as for prices, availability" — [Search quickstart](https://exa.ai/docs/search/quickstart.md). `maxAgeHours` does not filter by publication date; use `startPublishedDate` for "recent" — [Best practices](https://exa.ai/docs/search/best-practices.md)
- `includeHtmlTags`, `verbosity` and section filters apply only to freshly fetched content (`maxAgeHours: 0`) — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- The crawler "does not attempt to bypass logins, paywalls, or CAPTCHAs" and respects robots.txt, so expect `SOURCE_NOT_AVAILABLE` / `CRAWL_HTTP_403` on gated sites — [FAQs](https://exa.ai/docs/admin/faqs.md), [Error codes](https://exa.ai/docs/admin/error-codes.md)
- `company`/`people` + date filters give a 400; `people` + `excludeDomains` gives a 400 — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- `outputSchema` over 10 properties or 2 nesting levels, or an array without `items`, gives a 400 before the search runs — [Deep Search](https://exa.ai/docs/search/deep-search.md)
- `stream: true` on `/search` without `outputSchema` just returns normal JSON — [Best practices](https://exa.ai/docs/search/best-practices.md)
- Dynamic highlights without the `Exa-Beta` header are rejected — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- SDK default: no `contents` means text (Python: max 10,000 chars) is fetched. Pass `contents=False` (Py) / `contents: false` (JS) for metadata-only speed — [exa-py api.py](https://pypi.org/project/exa-py/2.28.0/), [exa-js index.d.ts](https://www.npmjs.com/package/exa-js/v/2.28.0)
- Python SDK: snake_case keys everywhere, including nested ones (`contents={"max_age_hours": 24}`) — [Best practices](https://exa.ai/docs/search/best-practices.md)
- `resolvedSearchType` "May be an empty string. Do not branch on this value." — [exa-spec.yaml](https://exa.ai/docs/exa-spec.yaml)
- `maxAgeHours: 0` repeated within 60 s may return the same copy — [Contents quickstart](https://exa.ai/docs/contents/quickstart.md)
- Snapshot on free tier gives `403 SNAPSHOT_NOT_ON_PLAN`; not supported with `deep` — [Snapshot](https://exa.ai/docs/search/snapshot.md)
- Language auto-filtering: results come back only in the query's language — [Changelog](https://exa.ai/docs/changelog.md)

### Inferences
- **Query language:** a Finnish-language butler query returns only Finnish pages, and an English query returns English pages. For Finnish local services, consider issuing both language variants (inferred from the language-filter changelog entry; I found no documented opt-out).
- JS-heavy sites: Contents says it handles JS rendering. If text comes back empty from the cache, retry with `maxAgeHours: 0` and a higher `livecrawlTimeout` (inferred, not documented as a fix).

### Gaps
- No documented way to disable query-language filtering. No documented guidance on empty `text` for SPA sites beyond "handling JavaScript-rendered pages… automatically".
