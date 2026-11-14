# Exa pricing, rate limits, latency, efficient use and differentiation (read 13 Nov 2026)

All pages were read on 13 November 2026 unless a different date is given. Exa's docs moved to `exa.ai/docs/...`, and `docs.exa.ai/llms.txt` now points there. No live API calls were made, because we have no key yet, so every latency figure below comes from Exa or a third party.

## 1. Current price list, and what the $50 credit buys

### Takeaway
Exa is pay-as-you-go and bills per request. A standard `auto` search costs $0.007 for up to 10 results, `lite` costs $0.004, and `deep` costs $0.012. Contents are $1 per 1,000 pages per content type, and Answer is $0.005. At these prices $50 covers about 1,400 to 2,400 runs of a typical 3 to 5 search agent, so the budget is not the constraint. Wasteful development loops and Agent `high`/`xhigh`/metered runs are what can eat it. Websets is billed separately and the API credits do not cover it.

### Cited findings
**Search (`/search`), base price covers up to 10 results per request** ([pricing](https://exa.ai/pricing); [docs pricing](https://exa.ai/docs/admin/pricing.md))
| Type | $ per 1k requests | Per call | Each result above 10 | AI page summary |
|---|---|---|---|---|
| `lite` (new, recommended) | $4 | $0.004 | $1 / 1k results | none (not supported) |
| `instant` (legacy) | $4 | $0.004 | $1 / 1k | $1 / 1k pages |
| `auto` (default, recommended), `fast` (legacy) | $7 | $0.007 | $1 / 1k | $1 / 1k pages |
| `deep-lite` | $12 | $0.012 | same as standard | same |
| `deep` (recommended for research) | $12 | $0.012 | same | same |
| `deep-reasoning` (legacy, replaced `/research`) | $15 | $0.015 | same | same |

- The docs say "Each request to an endpoint is one billable call, so a $7 per 1k rate equals $0.007 per call." Exa has "no subscription and no minimum spend." ([docs pricing](https://exa.ai/docs/admin/pricing.md))
- The changelog entry of 3 Mar 2026 says "Search with contents is $7 per 1k requests (10 results)", with summaries at $1/1k and contents at "$1 per 1k pages per content type". Regular Deep became 20% cheaper on 4 Mar 2026. Lite at $4/1k arrived on 19 Oct 2026. ([changelog](https://exa.ai/docs/changelog.md))
- **Contents (`/contents`):** $1 per 1k pages for each content type (`text`, `highlights`, `summary`). The docs say "`/contents` bills each content type separately, so one page with `text` and `highlights` counts as two." ([docs pricing](https://exa.ai/docs/admin/pricing.md))
- **AI page summary:** "An Exa-generated summary of a page, produced by an extra LLM call on our side", at $1 per 1k pages. ([docs pricing](https://exa.ai/docs/admin/pricing.md))
- **Answer (`/answer`):** $5 per 1k requests ($0.005). ([pricing](https://exa.ai/pricing))
- **Monitors (`/monitors`):** $2 per 1k requests, plus $1/1k for each result above 10 and $1/1k pages for summaries. Monitors launched on 30 Mar 2026 as scheduled searches with webhook delivery. ([pricing](https://exa.ai/pricing); [changelog](https://exa.ai/docs/changelog.md))
- **Exa Agent (`/agent/runs`, launched 16 Jun 2026)** ([pricing](https://exa.ai/pricing)):
  - Fixed effort, per request: `minimal` $0.012, `low` $0.025, `medium` $0.10, `high` $0.50, `xhigh` $1.00.
  - Metered: `auto` (the default) caps at $5 per run, and `ultra` caps at $20 per run. Usage costs $0.10 per Agent Compute Unit, $0.005 per search tool call, $0.02 per email contact and $0.07 per phone contact. Exa Connect partner data is charged on top (Fiber.ai $0.02/credit; Baselayer $0.10 to $4.00 per order).
- **Livecrawl, subpages and findSimilar** have no separate price on the pricing page or the pricing docs. `livecrawl` is deprecated in favour of `contents.maxAgeHours` (`0` means live, and `livecrawl: "always"` maps to `maxAgeHours: 0`). `subpages` is deprecated on `/search`; it is used on `/contents` instead. ([search reference](https://exa.ai/docs/reference/search.md); [best practices](https://exa.ai/docs/search/best-practices.md))
- **Past page versions:** `contents.snapshotAsOf` (which replaced `crawledBeforeDate`) returns the newest stored version as of a given date and never fetches live. ([search reference](https://exa.ai/docs/reference/search.md)) The billing page says "The Free tier does not include Exa Snapshot." ([billing](https://exa.ai/docs/admin/billing.md))
- **Websets:** "Websets is billed in Websets credits, which are separate from Search API credits." The Websets API "requires a paid Websets plan." The Free plan "caps a webset at 25 verified results." Prices appear only at websets.exa.ai/billing, which needs a login. ([Websets quickstart](https://exa.ai/docs/websets/quickstart.md))
- **MCP:** The hosted server is at `https://mcp.exa.ai/mcp`, with the tools `web_search_exa`, `web_fetch_exa`, `web_search_advanced_exa` (opt-in) and `agent_run`. Keyless use is free but rate-limited, at "3 QPS and 150 calls per day" according to the changelog of 2 Feb 2026. With a key or OAuth, calls run on the team's plan and rate limits. No MCP-specific surcharge is listed. ([MCP docs](https://exa.ai/docs/get-started/exa-mcp.md); [changelog](https://exa.ai/docs/changelog.md))
- **Free tier:** $10 in credits each calendar month ("up to 2,500 Lite searches"), no card needed, plus a one-time $10 bonus after onboarding. Unused monthly credit does not carry over. ([pricing](https://exa.ai/pricing); [billing](https://exa.ai/docs/admin/billing.md))
- **Out of credit:** requests return `402 Payment Required`. An API key that reaches its assigned budget also returns 402. ([billing](https://exa.ai/docs/admin/billing.md))
- **Cost per response:** every response carries a `costDollars` field (an estimate, with `total` and breakdowns for search, summary and contents). ([search reference](https://exa.ai/docs/reference/search.md))

### Worked budgets (inferences from the prices above, assuming `auto` at $0.007 and contents bundled into the search call)
| Design | Exa cost per run | Runs per $50 |
|---|---|---|
| (a) 3 to 5 `auto` searches with highlights, 5 results each | $0.021 to $0.035 (4 searches: $0.028) | about 1,430 to 2,380 |
| (a') the same with `lite` (cached only) | $0.012 to $0.020 | about 2,500 to 4,170 |
| (b) 10 to 15 `auto` searches plus 10 full-text pages through `/contents` | $0.07 to $0.105, plus $0.01 = $0.08 to $0.115 | about 435 to 625 |
| (b') the same, with text fetched inside the search calls | $0.07 to $0.105 | about 475 to 715 |
| (c) one `deep` call with `outputSchema` | $0.012 (deep-reasoning $0.015) | about 4,170 (3,330) |
| (c') one Exa Agent run at `medium` / `high` / `xhigh` | $0.10 / $0.50 / $1.00 | 500 / 100 / 50 |
| (c'') one Agent run in metered `auto` mode, worst case | up to $5 | as few as 10 |
| Add summaries to 5 results | +$0.005 per search | — |

### Inferences
- The cheapest design that still gives quotable evidence is one `deep` call ($0.012) with `outputSchema`: it returns `output.grounding`, with citations and confidence for each field. The fastest cheap option is 1 to 3 parallel `auto` searches with highlights ($0.007 each), where the highlights are verbatim quotes and the LLM cites URLs.
- The judging load is small. Even 200 judge queries at $0.03 to $0.10 each comes to $6 to $20, so most of the $50 goes on development. Each team member gets a code. Note that rate limits apply per team, across all keys.
- The changelog says "search with contents" costs $7/1k, so text or highlights inside `/search` appear to be included, while `/contents` bills each type. Check this against `costDollars` on the first call.

### Gaps
- No public price for Websets credits, per item or per enrichment (login needed), nor whether a hackathon code can activate a paid Websets plan. Ask the Exa staff at the venue.
- No confirmation that the hackathon code unlocks Snapshot (past versions) or Websets. The billing page says Snapshot is excluded from the Free tier only, so redeeming credit, which moves the team to pay-as-you-go, probably enables it. This is unconfirmed.
- `findSimilar` appears in the cost description of the search reference, but its current status and price could not be confirmed. It is absent from the changelog and the pricing pages.
- No separate surcharge is listed for `maxAgeHours: 0` (livecrawl) or for subpages.

## 2. Rate limits and concurrency

### Takeaway
By default, `/search`, `/answer` and `/chat/completions` allow 10 QPS each, deep types 5 QPS, `/contents` 100 QPS, Agent 5 QPS with 50 runs active at once, and Websets 20 QPS. The limits apply to the whole team across all keys, and going over returns 429. This is plenty for a booth demo if the agent runs fewer than about 10 searches in parallel.

### Cited findings
- Default limits per endpoint: "/search", "/answer", "/chat/completions" at "10 QPS"; deep types at "5 QPS"; "/contents" at "100 QPS"; "/agent/runs", "/responses" at "5 QPS and 50 active runs"; "/websets/*" at "20 QPS". ([billing](https://exa.ai/docs/admin/billing.md))
- "Limits apply to the whole team across all API keys." A team that adds $1,000 in credits within 30 days gets "25 QPS for 90 days". Enterprise ($12,000 a year) also gets 25 QPS, and anything higher goes through sales. ([billing](https://exa.ai/docs/admin/billing.md))
- Each Agent run start counts as two requests against QPS. Starting a run past the concurrency limit returns `429 CONCURRENCY_LIMIT_REACHED`. ([billing](https://exa.ai/docs/admin/billing.md))
- On exceeding a limit, the docs say "requests return `429 Too Many Requests`". The client should honour `Retry-After` or back off exponentially. ([billing](https://exa.ai/docs/admin/billing.md))
- Keyless MCP is capped at 3 QPS and 150 calls a day. ([changelog](https://exa.ai/docs/changelog.md))
- Exa's comparison page concedes Tavily publishes a higher request limit (1,000 RPM, against Exa's "10+ QPS"). ([Exa vs Tavily](https://exa.ai/versus/tavily))

### Inferences
- With 10 QPS shared by the team, a fan-out of 5 parallel searches per user query supports about two simultaneous judges. Use a small semaphore (8 at a time) and one retry on 429 with backoff.
- Do not run development load tests and the demo on the same team at the same time.

### Gaps
- No hackathon-specific limits are published. Ask Exa staff whether event teams get raised QPS.

## 3. Latency by mode (published and independent)

### Takeaway
Plan on roughly 0.4 to 0.7 s per call for `lite`/`instant`/`fast`, 1.2 to 1.4 s for `auto` (p90 about 1.9 s), about 4 s for `deep-lite`, 4 to 15 s for `deep`, and 12 to 40 s or more for `deep-reasoning`. `outputSchema` adds about 2 s, and `maxAgeHours: 0` adds an unquantified amount. A demo that "answers in seconds" should run 2 to 4 parallel `auto` or `lite` searches with highlights (about 1.5 to 2 s wall time), or one streamed `deep-lite`/`deep` call.

### Cited findings
- Exa's published figures: `deep-lite` "~4 seconds", `deep` "4–15 seconds", `deep-reasoning` "12–40 seconds". ([pricing](https://exa.ai/pricing)) The reference describes deep-lite as having "a consistent 4-second latency". ([search reference](https://exa.ai/docs/reference/search.md))
- The changelog gives Fast a p50 under 425 ms (29 Jul 2025), Instant under 150 ms (5 Feb 2026), Deep at 4 to 12 s and Deep Reasoning at 12 to 50 s (4 Mar 2026). ([changelog](https://exa.ai/docs/changelog.md))
- "`outputSchema` adds about 2 seconds of synthesis latency to any type except `lite`." ([search reference](https://exa.ai/docs/reference/search.md))
- The best-practices guide does not give per-type figures. It advises: "Don't assume `lite` is faster unless you have tested it." `maxAgeHours: 0` "adds latency". ([best practices](https://exa.ai/docs/search/best-practices.md))
- Independent results:
  - **WebSearchAPIs, run 11 Nov 2026** (308 calls per configuration, 5 results): Exa fast p50/p90/p99 = 0.57/0.67/2.14 s; Exa auto = 1.40/1.91/3.82 s. Competitors: Parallel fast 1.00 s p50, Tavily fast 1.07 s, Linkup fast 2.16 s, Firecrawl 2.15 s. Exa returns about 2,000 tokens per search at p50. ([websearchapi.space](https://websearchapi.space/blog/best-web-search-api))
  - **openbenchmarks, measured 21 Oct 2026** (300 company-news questions): Exa instant 398 ms mean / 97.7% accuracy; Exa fast 652 ms / 99.3%; Brave 601 to 630 ms; Firecrawl 510 ms; Perplexity 1.38 s; Linkup fast 1.57 s; Tavily basic 1.88 s / advanced 4.29 s. On developer questions, Exa auto with scrape took 1.19 s and Exa deep with scrape 3.97 s; Parallel turbo was the fastest at 333 ms. ([openbenchmarks](https://openbenchmarks.com/web-search/fastest-search-api))
  - **cloro, 11 Nov 2026** (vendor-run; cloro is one of the tested APIs): Exa median 0.74 s, the fastest of 6. Brave 1.21 s, Tavily 2.00 s, Parallel 2.99 s, SerpApi 8.2 s. ([cloro](https://cloro.dev/blog/web-search-api-benchmark/))
  - **Exa's own page (vendor claim):** p95 of 1.4 to 1.7 s against Tavily's 3.8 to 4.5 s in an enterprise evaluation. ([Exa vs Tavily](https://exa.ai/versus/tavily))
- Long Agent research over MCP returns `status: "running"` and must be polled with `runId`. ([MCP docs](https://exa.ai/docs/get-started/exa-mcp.md))

### Inferences
- From Espoo, add roughly 100 to 200 ms of transatlantic round trip per call if Exa serves from the US (unverified), plus venue Wi-Fi jitter. Budget 2 to 3 s for the retrieval step and stream the LLM answer. Use a phone hotspot as a fallback.
- Use `deep` only for a visible "deep dive" step, with streaming (`stream: true` with `outputSchema`) so judges see progress.

### Gaps
- No published figures for Answer or for `/contents` latency with and without live crawl. The Exa page's claim that highlights take under 100 ms is a vendor statement. No benchmark measured from Europe was found.

## 4. Efficiency practices (ranked) and pitfalls

### Takeaway
Use a single `/search` call that also returns `contents.highlights`, a low `numResults` (5), the `auto` or `lite` type, descriptive natural-language queries, and filters only for hard constraints. Save `deep` for genuine multi-hop synthesis, and cache everything you show in the demo.

### Cited findings and ranked practices
1. **Search and contents in one call, highlights by default.** The docs' baseline is "a natural-language query and `contents: {highlights: true}`", and "Exa sizes each result's excerpts to its relevance". ([best practices](https://exa.ai/docs/search/best-practices.md)) Exa claims 500 characters of highlights are comparable to the first 8,000 characters of a page. ([Exa vs Tavily](https://exa.ai/versus/tavily), vendor claim)
2. **Request one content view.** "Views can be combined, but each is billed separately." A summary "Adds one extra language model call per result", which costs both latency and money. ([best practices](https://exa.ai/docs/search/best-practices.md)) Cap full text with `text.maxCharacters`.
3. **Keep `numResults` low.** It "trades off context size against recall", and each result above 10 costs extra. ([best practices](https://exa.ai/docs/search/best-practices.md); [pricing](https://exa.ai/pricing)) LLM-side cost: about 2,000 tokens per Exa search adds "$8.99–$17.07 per 1,000" searches in model input cost. ([websearchapi.space](https://websearchapi.space/blog/best-web-search-api))
4. **Write descriptive queries.** "Describe the pages you want, including subject, source type, and time period. Avoid bags of keywords." Pass `objective` when an LLM writes the query. "A different search type can't fix an underspecified query." ([best practices](https://exa.ai/docs/search/best-practices.md)) `useAutoprompt` has been removed. ([changelog](https://exa.ai/docs/changelog.md))
5. **Filters only for hard constraints.** Use `includeDomains`/`excludeDomains` (hostname, path prefix or wildcard) and `start/endPublishedDate`. Crawl-date filters are ignored, and `site:` operators should not be used. ([best practices](https://exa.ai/docs/search/best-practices.md)) Categories: company, publication, news, personal site, financial report, people. `company` and `people` do not support date filters. ([search reference](https://exa.ai/docs/reference/search.md))
6. **Freshness only where correctness needs it.** "Avoid `maxAgeHours: 0` unless freshness is required." Keep `livecrawl` and `maxAgeHours` out of the same request. `lite` rejects `maxAgeHours`. ([best practices](https://exa.ai/docs/search/best-practices.md)) `maxAgeHours` accepts up to 720; `-1` means cache only. ([search reference](https://exa.ai/docs/reference/search.md))
7. **Use `deep` with `outputSchema` instead of search plus a second LLM extraction pass**, when the task needs iteration. The output is validated, with at most 10 properties and 2 levels of nesting, and `output.grounding` gives citations for each field. ([deep search](https://exa.ai/docs/search/deep-search.md)) The guide also says: "Use `deep` only when the retrieval process needs iteration, not just because the output is JSON." ([best practices](https://exa.ai/docs/search/best-practices.md))
8. **Run parallel queries under a concurrency cap** (inferred from the 10 QPS limit) and log `requestId`, `searchTime` and `costDollars`. ([best practices](https://exa.ai/docs/search/best-practices.md))
9. **Cache demo results locally**, keyed on normalised query and parameters, and pre-warm the scripted demo queries (inference). Set per-key budgets so a runaway loop hits 402 instead of draining the team. ([billing](https://exa.ai/docs/admin/billing.md))

### Pitfalls
- Calling Agent `high`/`xhigh` ($0.50 to $1) or metered `auto` (up to $5 per run) inside a loop. This is the main way to burn the $50. ([pricing](https://exa.ai/pricing))
- Requesting summaries on every result, or text plus highlights plus summary together, each billed separately. ([docs pricing](https://exa.ai/docs/admin/pricing.md))
- Setting `numResults` to 25 or more with full text. That costs more on Exa and more in LLM tokens.
- Retrying on timeout without honouring `Retry-After`, which can trigger 429 cascades across the team. ([billing](https://exa.ai/docs/admin/billing.md))
- Using deprecated parameters such as `useAutoprompt`, `includeText`, `numSentences` or the top-level `text`/`highlights` fields. `text`/`highlights`/`summary` belong under `contents`. ([best practices](https://exa.ai/docs/search/best-practices.md))
- Passing Exa `warnings` to the model. Only `notices` should go to it. ([best practices](https://exa.ai/docs/search/best-practices.md))
- Sending personal data in `userIdentifier`. Use an opaque ID. ([best practices](https://exa.ai/docs/search/best-practices.md))

### Gaps
- No primary-source measurement of the token difference between highlights, text and summary beyond the third-party figure of about 2,000 tokens per search.

## 5. What Exa does that others do not, and where it is weaker

### Takeaway
Exa's distinctive strengths are its own meaning-based index (2T+ URLs tracked, 100B pages served), dedicated entity indexes (1B+ people, companies with structured attributes, 350M+ publications), query-dependent highlights returned inside the search call, stored past page versions (`snapshotAsOf`), schema-grounded deep search with per-field citations, Websets (verified lists), Monitors (scheduled searches with webhooks), and top or near-top speed in independent 2026 benchmarks. It is weaker on multi-hop questions answered in a single call, on very fresh events compared with SERP-based tools, on price per search, and probably on Finnish-language content.

### Cited findings
- **Index:** "As of October 2026, Exa's index tracks over 2 trillion URLs and serves 100 billion pages." It "can search by meaning, accept natural-language queries, and return page contents in the same request." ([FAQ](https://exa.ai/docs/admin/faqs.md))
- **Entity search (vendor figures, 4 Aug 2026):** people R@1 Exa 75.5% vs Tavily 40.5%; company R@1 81.5% vs 61.3%; publications R@1 63.3% vs 31.8%. Exa cites 1B+ people profiles, 350M+ academic works and domain lists of up to 1,200 entries. ([Exa vs Tavily](https://exa.ai/versus/tavily)) The People Search benchmark (17 Dec 2025) and Company Search benchmark (22 Jan 2026) have open-sourced evaluation harnesses. ([people benchmark](https://exa.ai/blog/people-search-benchmark); [company benchmark](https://exa.ai/blog/company-search-benchmarks))
- **Websets:** in Exa's older evaluation, Websets returned "over 20x more correct" results than Google on complex queries. ([websets evals](https://exa.ai/blog/websets-evals), vendor claim)
- **Past versions:** `snapshotAsOf` returns the stored version as of a given date. ([search reference](https://exa.ai/docs/reference/search.md)) No comparable feature was documented in the competitor material reviewed (inference; not exhaustively checked).
- **Structured output with grounding:** deep `outputSchema` plus `output.grounding` gives citations and confidence for each field. ([deep search](https://exa.ai/docs/search/deep-search.md))
- **Accuracy and speed (independent or semi-independent):**
  - cloro: Exa 97.3% on SimpleQA Verified (2nd, statistically tied) at 0.74 s, the fastest. FreshQA 83.0%, mid-pack, behind SerpApi 88.5% and cloro 88.3%. FRAMES (multi-hop) 64.0%, behind SerpApi 77.4%, because a single results page often lacked every needed fact. ([cloro](https://cloro.dev/blog/web-search-api-benchmark/))
  - WebSearchAPIs: Exa had the top Datacircle single-call accuracy (92) and the fastest p50/p90, but is "the most expensive of the top tier". Its response schema shows no date field, while Parallel and Linkup returned dates. ([websearchapi.space](https://websearchapi.space/blog/best-web-search-api))
  - openbenchmarks: Exa fast scored 99.3% on company news, the highest in the table. ([openbenchmarks](https://openbenchmarks.com/web-search/fastest-search-api))
- **Price:** Exa auto at $7/1k compares with $5/1k for Brave, Tavily, Perplexity, Linkup and Firecrawl, and $1 for Parallel fast. ([openbenchmarks](https://openbenchmarks.com/web-search/fastest-search-api); [websearchapi.space](https://websearchapi.space/blog/best-web-search-api))
- **Language:** since 5 Nov 2025, "Exa now detects your query language and returns results only in that language", by default. No override is documented in that changelog entry. ([language filtering changelog](https://docs.exa.ai/changelog/language-filtering-default)) `userLocation` takes an ISO country code (for example `FI`) to localise results. ([search reference](https://exa.ai/docs/reference/search.md)) The only third-party language evidence is a Japanese review rating support "partial", based on editorial estimates. ([aipicks.jp](https://aipicks.jp/tool/exa-ai/japanese))

### Inferences
- What to show the judges, given the criterion "information that could not have come from training data": (1) `maxAgeHours`-fresh content from pages that change, such as prices, opening hours and deadlines; (2) `snapshotAsOf` diffs ("this rule changed on date X"); (3) people, company or personal-site category search to find a specific provider or expert; (4) deep `outputSchema` with per-field grounding shown as clickable citations; (5) a Monitor that keeps watching after the session ends, which suits the "butler" framing.
- Finnish sites: because of the query-language filter, query in Finnish (or Swedish) to get kela.fi/vero.fi/migri.fi pages, or query in English with `includeDomains: ["kela.fi","vero.fi","migri.fi","europa.eu"]` to reach their English pages. Test this early, since English queries may suppress Finnish-only pages.
- Pair Exa with a maps or places source for local business data, hours and maps. No source showed Exa indexing local listings.

### Gaps
- No independent evidence was found on Exa's coverage of Finnish or Nordic government sites (kela.fi, vero.fi, migri.fi) or on Finnish-language quality. Verify with 10 or so test queries on day 1.
- No independent benchmark compares Exa with Claude's or OpenAI's built-in web search tools.
- `findSimilar`'s current availability is unconfirmed.
- Whether the language filter can be turned off is unconfirmed (it may be in the full search reference beyond the portion read).
