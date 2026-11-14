# Source display, grounding and agent design for the Exa "Internet Butler"

Researched 13 Nov 2026. Anthropic API facts below were read from the live docs on platform.claude.com today (API version header shown in examples: `anthropic-version: 2026-10-21`). Anything not read from a source is under "Inferences" or "Gaps". Exa parameters and pricing are covered elsewhere; Exa is mentioned only where it shapes the design.

## 1. Citation UX: what the best products do, what readers check, and what "clearer than anyone" looks like

### Takeaway
The strongest pattern seen in shipping products is quote-level provenance: hover on a citation shows the exact quoted passage, and a click opens the source at that passage (NotebookLM does this). Studies say citations raise trust even when they are random, and that few users click through. So "showing sources clearly" has to mean the passage is visible without clicking, and the system has visibly checked it. A link list under the answer is not enough.

### Cited Findings
- NotebookLM: "Citations are direct quotes". Hovering a citation shows the full quoted text, and clicking jumps to the location in the source — [Google NotebookLM help](https://support.google.com/notebooklm/answer/14276569?hl=en); same hover behaviour described for chat — [NotebookLM help: Use chat](https://support.google.com/notebooklm/answer/16179559?hl=en).
- Claude's own Citations API returns the exact span (`cited_text`) plus a location pointer (character range, page range or block range) for every cited claim. That is the data a "scroll the source pane to the passage" UI needs — [Anthropic Citations docs](https://platform.claude.com/docs/en/build-with-claude/citations).
- Claude web search citations carry `url`, `title` and `cited_text` (up to 150 characters). Anthropic's docs say that when API outputs are shown to end users, "citations must be included to the original source" — [Anthropic web search tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).
- Exa's `/answer` endpoint returns `answer` plus a `citations` list of results used. Each has `title` and `url`, plus optional `publishedDate` (an estimated ISO 8601 date), `author`, `id`, `favicon`, and `text` only when requested. It does not return highlight spans per claim, so claim-level passage linking has to be built by us — [Exa Answer API reference](https://docs.exa.ai/reference/answer).
- In a large randomized experiment, users trusted generative AI search less than traditional search on average, but reference links and citations significantly increased trust, including in some conditions where the citations were not relevant. Users who actually checked sources rated responses as less trustworthy — [Human Trust in AI Search (arXiv 2504.06435)](https://arxiv.org/html/2504.06435v1). Separately, a study found that trust rose even with random citations — [Citations and Trust in LLM Generated Responses (AAAI 2025)](https://arxiv.org/pdf/2501.01303v1.pdf). (Details came from search-result summaries; the full papers were not read.)
- Low click-through: a secondhand report of Pew data says users clicked a link inside Google AI summaries on about 1% of visits to pages that had one — reported via [authoritytech.io summary](https://authoritytech.io/curated/ai-search-trust-fell-citation-premium-2026). This is unverified against the Pew original; treat it with caution.
- Liu et al. found citation recall and precision were inversely correlated with fluency and perceived utility: answers that read well were often the less well supported ones. Readers cannot judge support from how polished an answer sounds — [Liu, Zhang, Liang, "Evaluating Verifiability in Generative Search Engines", EMNLP Findings 2023](https://arxiv.org/pdf/2304.09848).

### Inferences
- Implication of the trust studies: a citation marker alone creates trust it has not earned. A design that shows the passage inline, plus a machine-checked badge ("quote found verbatim on page, fetched 13 Nov 14:02"), makes the evidence inspectable without a click. That fits the evidence that almost nobody clicks.
- Proposed "clearer than anyone" pattern for a one-minute demo (design inference, not sourced):
  1. The deliverable (letter, plan, comparison) fills the left two-thirds of the screen. Every factual sentence carries a small numbered chip, coloured by verification state: green means the quote was matched verbatim and entailment passed; amber means it was paraphrased or comes from a single source; red or grey means not verified, shown as a visible "could not confirm" gap and never silently dropped.
  2. The right pane is the source reader. Clicking a chip scrolls the fetched page text to the passage with it highlighted (we hold the full text from Exa, so we can render our own reader without iframing third-party sites). The header shows domain, source-type badge (Official / Law / News / Forum / Vendor), published date, fetched date and a freshness flag (for example "older than 12 months").
  3. A per-claim evidence table (the "receipts" view) has columns for claim, quote, source, type, date, check result and agreeing/conflicting sources. It is the auditable view, similar to Elicit and Consensus evidence tables (comparison inferred; those products were not checked this session).
  4. A conflict flag appears when two sources disagree: both quotes side by side, with the more authoritative or newer one preferred and the reason stated.
  5. A "What I could not verify" box is shown as a first-class element.
- In a demo the jump from claim to highlighted passage on the original page is the moment that reads at a distance. Rehearse it on one claim.

### Gaps
- Perplexity, Elicit, Consensus, Google AI Mode and OpenAI deep research citation UIs were not fetched this session. The comparisons above for those products come from general knowledge and should be checked by hand before going in the pitch.
- No Nielsen Norman Group article on AI citation UX turned up in search; no NN/g finding is cited.

## 2. Evidence on failure (problem statement for the pitch)

### Takeaway
Independent audits from 2023 to 2025 show AI search tools are often wrong about sources: over 60% wrong answers in the Tow Center test, 45% of news answers with a significant issue in the EBU/BBC study (31% sourcing problems), only about half of sentences fully supported in the Stanford verifiability audit, and 17–33% hallucination for purpose-built legal RAG tools.

### Cited Findings
- **Tow Center / CJR (March 2025):** 8 AI search tools were tested with 1,600 queries (20 publishers, 10 articles each). Collectively they gave incorrect answers to more than 60% of queries, answered with "alarming confidence", rarely declined, fabricated links and cited syndicated copies. Premium versions gave more confidently incorrect answers than free ones. Licensing deals did not guarantee accurate citation — [CJR Tow Center](https://www.cjr.org/tow_center/we-compared-eight-ai-search-engines-theyre-all-bad-at-citing-news.php); coverage in [Fortune](https://fortune.com/2025/03/18/ai-search-engines-confidently-wrong-citing-sources-columbia-study/). Per-tool figures from secondary coverage: Perplexity 37% wrong, ChatGPT Search 67%, Grok 3 94%. These were not confirmed against the primary report in this session — [Fortune](https://fortune.com/2025/03/18/ai-search-engines-confidently-wrong-citing-sources-columbia-study/). More than half of Gemini and Grok 3 citations led to fabricated or broken URLs (secondary report) — [Digital Content Next](https://digitalcontentnext.org/blog/2025/03/24/ai-search-has-a-news-citation-problem).
- **EBU/BBC "News Integrity in AI Assistants" (Oct 2025):** 22 public service media organisations in 18 countries rated more than 3,000 answers from ChatGPT, Copilot, Gemini and Perplexity. 45% had at least one significant issue. Sourcing was the biggest problem at 31% (missing, misleading or incorrect attribution). 20% had accuracy problems, including hallucinated or outdated details. Gemini was worst, with significant issues in 76% of answers, mostly sourcing — [journalism.co.uk](https://journalism.co.uk/nearly-half-of-ai-generated-answers-contain-an-error-ebu-bbc-report); [MediaPost](https://www.mediapost.com/publications/article/410114/ai-assistants-provide-answers-full-of-errors-stud.html). Secondary sources disagree on the language count (4 vs 14), and one source gives 72% rather than 76% for Gemini sourcing; cite "45% / 31%" as the safe headline.
- **Stanford, Liu et al. (EMNLP Findings 2023):** Bing Chat, NeevaAI, perplexity.ai and YouChat were audited with human raters. On average only 51.5% of generated sentences were fully supported by their citations (citation recall), and only 74.5% of citations supported their sentence (citation precision) — [arXiv 2304.09848](https://arxiv.org/pdf/2304.09848).
- **Stanford RegLab/HAI legal RAG study (2024; JELS 2025):** Lexis+ AI, Westlaw AI-Assisted Research and Ask Practical Law AI each hallucinated on 17% to 33% of queries, despite vendors' "hallucination-free" marketing. They did better than GPT-4 alone. Westlaw AI-AR was accurate 42% of the time and hallucinated nearly twice as often as the other tools — [Stanford HAI](https://hai.stanford.edu/news/ai-trial-legal-models-hallucinate-1-out-6-or-more-benchmarking-queries); paper: [Magesh et al., "Hallucination-Free?"](https://nlp.stanford.edu/~manning/papers/Magesh-Hallucination%E2%80%90Free-2025.pdf). Caveat: the first version was criticised for testing Practical Law rather than Westlaw's main product, and it was later augmented — [LawSites](https://www.lawnext.com/2024/05/stanford-will-augment-its-study-finding-that-ai-legal-research-tools-hallucinate-in-17-of-queries-as-some-raise-questions-about-the-results/).

### Inferences
- Pitch line (suggested): "Independent audits found AI search wrong on more than 60% of news-citation queries, and even legal tools built on retrieval hallucinated on 1 in 6 or more. Every claim our butler makes is checked against the exact sentence on the page, and when it can't check something, it says so."
- These studies measure news and legal questions, not our domain. Say "in independent audits of AI search", not "AI is wrong 60% of the time".

### Gaps
- No 2026-dated independent audit of AI search citation accuracy was found this session. One may exist; worth one quick search before the pitch.

## 3. Grounding and verification techniques that fit a weekend

### Takeaway
Anthropic documents four directly usable techniques: let Claude say "I don't know", extract word-for-word quotes first, cite a quote for each claim and retract any claim without one, and restrict answers to the provided documents. Anthropic's native Citations feature gives "guaranteed valid pointers" to the provided text and, in Anthropic's evaluations, picks more relevant quotes than prompt-based citing. Combine native citations with our own verbatim check against the fetched page and a cheap second-model entailment check per claim.

### Cited Findings
- Anthropic's "Reduce hallucinations" guide lists: allowing "I don't know" ("can drastically reduce false information"); "Use direct quotes for factual grounding", with word-for-word quote extraction first for documents over 20k tokens; "Verify with citations", including a pass after drafting that finds a supporting quote for each claim and removes any claim without one, marking the gap with `[]`; chain-of-thought verification with thinking `display: "summarized"`; best-of-N comparison; iterative refinement; and "External knowledge restriction". The guide notes these "significantly reduce hallucinations" but do not eliminate them. No numbers are given — [Anthropic docs: Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations).
- Native Citations: "citations are guaranteed to contain valid pointers to the provided documents". "In Anthropic's evaluations, the citations feature is significantly more likely to cite the most relevant quotes from documents than purely prompt-based approaches." `cited_text` does not count toward output tokens, or toward input tokens when passed back — [Anthropic Citations docs](https://platform.claude.com/docs/en/build-with-claude/citations).
- Citation granularity is controllable. Plain text and PDF are auto-chunked into sentences; "custom content" documents use our own blocks as-is, which suits bullet points or one-highlight-per-block — [Anthropic Citations docs](https://platform.claude.com/docs/en/build-with-claude/citations). For `search_result` blocks, "Splitting content into smaller, focused blocks gives Claude finer citation boundaries" — [Anthropic Search results docs](https://platform.claude.com/docs/en/build-with-claude/search-results).
- Liu et al.'s finding that fluent answers are less well supported argues for machine checks over human impressions — [arXiv 2304.09848](https://arxiv.org/pdf/2304.09848).

### Inferences
Recommended weekend pipeline (design inference):
1. **Retrieval as evidence units.** Turn each Exa result into one `search_result` block (`source` = URL, `title`), with `content` = one text block per Exa highlight or paragraph. Each citation then points to a specific block we hold, and that block maps to a highlight we can render.
2. **Native citations on.** Compose the deliverable with citations enabled, so every sentence returns `cited_text` and block indices (exact pointers, not model-typed URLs). This removes fabricated links by construction.
3. **Verbatim check (deterministic, about 1 ms).** Normalise whitespace and quotes, then confirm `cited_text` appears in the full page text we fetched. With native citations this should always pass. The check still matters for any span the model typed itself, such as in structured-output steps, and it is the green tick the UI shows.
4. **Entailment check (Haiku 5.5 or Sonnet 5.5, run in parallel per claim).** Input is claim plus quote, output is `supported | partial | not_supported`. A quote can exist and still not support the claim; the 74.5% citation-precision figure is exactly this failure. Downgrade or drop failing claims and show them in "could not verify".
5. **Source-quality and date rules.** Prefer official or primary domains; Exa domain and date filters do this at retrieval time. Flag pages older than a threshold. For any legal or price fact, show the published date and the date we fetched it.
6. **Abstain.** If no supporting quote survives, the deliverable says "Not confirmed" with what was searched.
- Expected effect: no measured number for this combination was found. Present our own eval number (section 6) rather than a borrowed one.

### Gaps
- No published measurement of the effect of quote-first prompting or of Anthropic's Citations feature, beyond the qualitative "significantly more likely" claim, was found.
- Second-model entailment (NLI-style attribution checking, for example AIS or AttrScore lines of work) was not researched with sources this session.

## 4. Anthropic API features that help (read from live docs, 13 Nov 2026)

### Takeaway
The key fact for the design: **Citations and structured outputs are incompatible (400 error)**. So split the pipeline. Use structured outputs (or strict tools) for intake, planning and extraction into a schema, and a separate citations-enabled call that writes the human-readable deliverable from `search_result` blocks. Feed Exa results to Claude as `search_result` blocks inside a custom tool's `tool_result` to get web-search-style citations over Exa content.

### Cited Findings
**Citations** — [docs](https://platform.claude.com/docs/en/build-with-claude/citations)
- Status stable. Supported on all active models, including `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`.
- Request: a `document` content block with `source` (plain text, PDF or custom content), optional `title` and `context` ("passed to the model but not used toward cited content"; useful for metadata as stringified JSON), and `"citations": {"enabled": true}`.
- Response: text blocks with a `citations` array. For plain text the type is `char_location` with `cited_text`, `document_index`, `document_title`, `start_char_index`, `end_char_index`. PDFs give `page_location`; custom content gives `content_block_location` (0-indexed, exclusive end).
- Works with prompt caching: put `cache_control: {"type": "ephemeral"}` on the document blocks. Citation blocks themselves cannot be cached. Also works with token counting and batch.
- **Warning in the docs:** "Citations cannot be used together with structured outputs." Enabling citations on any `document` or `search_result` block together with `output_config.format` (or the deprecated `output_format`) returns a 400, because citations interleave citation blocks with text.

**Search result blocks** (custom RAG, the right fit for Exa) — [docs](https://platform.claude.com/docs/en/build-with-claude/search-results)
- Shape: `{"type": "search_result", "source": "<url>", "title": "<title>", "content": [{"type": "text", "text": "..."}], "citations": {"enabled": true}}`. `source`, `title` and `content` are required. Citations are off by default.
- Used either in a `tool_result` from a custom tool (Method 1) or directly as top-level user content (Method 2); both can be mixed.
- Response citations: `type: "search_result_location"`, with `source`, `title`, `cited_text` (the concatenated text of `content[start_block_index:end_block_index]`, not counted toward output tokens), `search_result_index` (0-based across all search_result blocks in request order), `start_block_index` and `end_block_index` (exclusive).
- Constraints: citations are all-or-nothing across all search_result blocks in a request. A `tool_result` that contains any `search_result` must contain only `search_result` blocks. If the web search tool is also enabled, citations must be enabled on all search_result blocks. Under Managed Agents, search_result blocks are accepted only in tool results.

**Structured outputs** — [docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- `output_config: {"format": {"type": "json_schema", "schema": {...}}}`. Separately, `strict: true` on a tool definition enforces tool-input schemas. Both can be used together. SDK helpers: `messages.parse()` with Pydantic or Zod.
- Supported on Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5 and others.
- Limits: no recursive schemas, no `minimum`/`maximum`/`minLength`/`maxLength`, objects need `required` and `additionalProperties: false`.
- Latency: the first use of a schema compiles a grammar, which adds latency. The compiled grammar is cached for 24 hours from last use. Changing `output_config.format` invalidates the prompt cache. **Practical rule: warm every schema before the demo.**

**Web search server tool** (alternative to Exa, or a backup) — [docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- Versions: `web_search_20250305` (basic), `web_search_20260209` (dynamic filtering via code execution), `web_search_20260318` (adds `response_inclusion`). Options: `max_uses`, `allowed_domains` or `blocked_domains` (not both), `user_location`, `allowed_callers`.
- Citations always on (`web_search_result_location`, `cited_text` up to 150 characters). Results include `page_age`. Price is $10 per 1,000 searches plus tokens. Errors arrive inside a 200 response (`too_many_requests`, `max_uses_exceeded`, `unavailable`, etc.). Supports `pause_turn`.
- Why Exa over it for this challenge: we control the retrieval (neural or keyword search, date, domain and category filters, highlights, full text, past versions), and the full page text sits on our side, so we can run the verbatim check and render the source pane. With the server tool, page content comes back as `encrypted_content` we cannot read. The challenge also explicitly judges use of Exa. Keep Claude web search as a fallback only if Exa is down (inference).
- Web fetch tool exists (linked as `/agents-and-tools/tool-use/web-fetch-tool`); its page was not read this session.

### Inferences
- Model split (inference; latency numbers not sourced): Haiku 5.5 for query rewriting and per-claim entailment (many small parallel calls); Sonnet 5.5 or Opus 5.5 for extraction and composing the cited deliverable; Fable 5.2 only if the quality gain is visible within the latency budget. Measure TTFT ourselves on venue Wi-Fi (see Gaps).
- Use parallel tool calls so the model fires 3–5 Exa searches at once. Or skip the model loop and have code fan out the searches, which is cheaper and more predictable; Anthropic's "workflow over agent" advice applies (section 5).

### Gaps
- Not fetched this session and must be checked against live docs before relying on them: MCP connector (request shape, beta header), fine-grained tool streaming, adaptive/extended thinking parameters on the 5.x models, prompt caching minimums and TTLs, Agent SDK, and the web fetch tool. The claude-api skill in this environment is a good, quick, current reference.
- No published time-to-first-token figures for the 5.x models were found.

## 5. Agent architecture for arbitrary live queries (robust and fast)

### Takeaway
Anthropic's guidance favours a workflow (predefined code path) over a free-roaming agent where the task shape is known: prompt chaining with programmatic gates, parallel sectioning, and an evaluator step. Show the planning steps to the user ("prioritize transparency"). For the butler: intake → plan → parallel Exa fan-out → highlight-first reading → schema extraction → verification → cited deliverable → action artefacts, each stage streamed to the UI.

### Cited Findings
- "Building effective agents": start with the simplest solution and increase complexity "only when needed". Workflow patterns include prompt chaining with programmatic "gates" between steps, routing, parallelization (sectioning and voting), orchestrator-workers (subtasks decided from the input), and evaluator-optimizer loops. Agents "cost more and can compound errors". The principles are "Maintain simplicity" and "Prioritize transparency by explicitly showing the agent's planning steps". Invest in the agent-computer interface; apply poka-yoke to tool arguments — [Anthropic Engineering](https://www.anthropic.com/engineering/building-effective-agents).
- Claude's web search docs give scale guidance: single-fact queries typically use 1–3 searches; comparative or multi-entity research can use 10 or more — [web search tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).
- Exa `/answer` supports `stream: true` (SSE text deltas, then citations, then cost) and an `outputSchema` (JSON Schema Draft 7) for structured answers — [Exa Answer API](https://docs.exa.ai/reference/answer). Useful as a fast first look, but it gives citations per answer rather than per claim.

### Inferences
Proposed pipeline with latency budget (inference; tune by measurement):
1. **Intake (≤ 3 s):** Haiku or Sonnet with structured output turns the request into a `Case` (who, where/jurisdiction, what happened, dates, goal, missing fields). Ask at most 2–3 clarifying questions, only for fields that change the answer, such as country or date. Otherwise assume a value and show the assumption as editable.
2. **Plan (≤ 2 s, or templated):** a list of 3–6 research questions per case type (routing pattern). Each question has 2–3 Exa query phrasings and filters, for example official domains and a date range.
3. **Parallel retrieval (≤ 5 s):** fire all Exa searches concurrently with highlights only. Dedupe by URL and canonical domain. Fetch full text only for the top 3–5 pages that will be cited or verified. Hard timeout per call; use whatever has arrived.
4. **Extract (≤ 5 s):** structured output into the case schema (deadline, amount, statute, form URL, contact), with fields `value`, `source_url`, and `quote` copied exactly.
5. **Verify (≤ 3 s, parallel):** verbatim check in code, then Haiku entailment per field. A conflict detector compares values for the same field across sources.
6. **Compose (streaming, 5–15 s):** a citations-enabled call over `search_result` blocks writes the deliverable. Stream text so the screen fills.
7. **Act:** code renders the artefacts (section 6) from the verified schema, not from free text.
- **Live progress UI:** stream stage events ("Searching: 'flight delay compensation EU261 official'", "Reading europa.eu …", "3 of 4 facts verified"). Showing which pages are being read is both the transparency principle and demo theatre.
- **Bounding cost and latency:** fixed caps (searches ≤ 12, full-text fetches ≤ 5, one compose call), per-stage timeouts, and a global deadline (around 30 s) after which we compose with what we have and mark the rest unverified.
- **Empty results:** widen filters (drop the date range, then the domain restriction), rephrase once, then abstain with "searched X, Y, Z; found nothing official".
- **Contradictions:** never average. Show both, prefer official over newer over other, and say why.

### Gaps
- Anthropic's context-engineering post and any Exa agent-design blog post were not fetched this session.

## 6. Action layer, approval patterns, evaluation and demo resilience

### Takeaway
"Close to done" without logging into third-party accounts means generated artefacts the user only has to approve and send. Anthropic's own docs state the norm that end-user output must keep citations to sources. For approvals, the pattern is a review screen with every outgoing field and its source, editable, followed by a single explicit confirm.

### Cited Findings
- Anthropic: where API outputs are shown to end users, "citations must be included to the original source" — [web search tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool). This supports carrying citations into the generated letter itself, for example as footnotes.
- Anthropic recommends testing agents "in sandboxed environments with guardrails", because autonomous agents compound errors — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

### Inferences
- **Artefacts that are realistic in a weekend** (no third-party login): (a) a ready-to-send letter or email with statute and policy citations as footnotes, opened through a `mailto:` link with subject and body pre-filled, or copied with one tap; (b) a filled PDF of the official form, with fields mapped from the verified schema using a PDF form library (pdf-lib in JS or pypdf in Python), or, where filling is not possible, a deep link to the exact official form plus a "fields to enter" checklist with values; (c) `.ics` calendar files for each deadline, with the source quote in the event description; (d) a comparison table with one recommended option and the reason, each cell cited; (e) a "watch" that re-runs the key searches (Exa Monitors or a scheduled re-query) and alerts when the cited passage changes, shown as a diff of old and new quote.
- **Approval pattern:** the review screen lists the recipient, subject, body and attachments. Each factual phrase is linked to its evidence chip, and fields we inferred rather than found are highlighted as "please check". Primary button: "Open in my mail app" or "Download filled form". Nothing is sent by us. This keeps the user as the final approver, which is the challenge's own wording.
- **Proof / eval:** build 25–30 real cases across 2–3 task types. For each, record the human-checked ground-truth key facts from official pages. Report (1) the share of claims whose quote was found verbatim on the fetched page and judged supporting by a human spot check; (2) key-fact accuracy for our system against the same Claude model with no search (shows value beyond training data); (3) the abstention rate, meaning how often it said "could not verify" instead of guessing. Report sample size, show one failure honestly, and do not compare against the CJR or Stanford numbers as if the setups were the same.
- **Demo resilience:** cache Exa responses and LLM outputs by request hash for the rehearsed cases. Add a replay mode that replays the recorded event stream at real speed with a small "replay" badge (be honest if asked). Warm structured-output grammars and the prompt cache before the session. Set per-call timeouts with partial results. Use a tethered phone hotspot as backup network. If Exa times out, use the cache; if there is no cache, say so on screen. Let the judges' own query run live with the progress stream visible, so that slowness looks like work rather than a hang.

### Gaps
- No published guideline from Anthropic or others specifically on approval UX for consumer agents (review screen, diff, one-tap confirm) was fetched; the pattern above is design inference.
- Exa Monitors and Websets mechanics are covered by other researchers.
