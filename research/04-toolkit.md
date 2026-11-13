# 04 — Technical toolkit for Junction 2026

Prepared 2026-11-13 (event day 1). Research only: nothing was installed or changed on the machine.

**How claims are marked**
- **[V]** = checked today on the provider's own page (URL given, or listed in the Sources section at the end).
- **[V-local]** = checked today on this MacBook (read-only commands such as `--version`, `which`, `npm view`).
- **[M]** = from memory, not checked today. Treat it as a lead to confirm.

---

## 0. Six things that change the plan

1. **Your Claude Code is too old for the orchestrator model.** Fable 5.2 needs Claude Code **v2.1.321 or later**, and Opus 5.5 needs v2.1.280 or later [V: code.claude.com/docs/en/model-config]. This machine has two CLI installs, and both fall short of 2.1.321. The first `claude` on PATH is the npm global **2.1.309**, installed under nvm's Node 25. The native install at `~/.local/bin/claude` is **2.1.281** [V-local]. The current release is 2.1.323 (12 Nov) [V: changelog]. Fix this first (section 6, step 1).
2. **Node 25 is end-of-life.** Its last release was v25.9.0 on 2026-03-31. The current LTS lines are v26.13.1 and v24.22.3 [V: nodejs.org/en/about/previous-releases]. nvm is installed, and Node 18 and 20 are also present [V-local].
3. **Two deadlines fall tonight.** The preliminary submission closes **Fri 13 Nov at 23:59**. The platform page says 23:55, so aim for 23:30. Final submissions close **Sun 10:00**. Hacking starts at 19:30 today. Submissions are open-sourced under **MIT**, so treat the repo as public and keep secrets out of git [V: 2026.hackjunction.com, hackjunction.app/hackathons/junction-2026].
4. **Some partners are already known.** Tech partners are OpenAI Codex, NVIDIA, Featherless, Modal, Qualia, CRACI, Atech.dev, Scailab, IronShard, Cloudinary, Wendy, Aiven and Oxylabs. Challenge partners include Exa, MariaDB, Hostinger, Meta, Intel, AstraZeneca, S-Pankki, City of Espoo and others. Anthropic and Google DeepMind are also listed. Arduino runs a **Hardware Lab** with UNO Q boards, 3D printers and LeRobot arms. The site confirms that partners "provide credits to their platforms", but it gives no amounts [V: same pages]. Where a partner tool is a close second choice, prefer it, because partner prizes reward using their tech.
5. **Cloudflare quick tunnels do not support Server-Sent Events.** They also cap at 200 in-flight requests and carry no uptime guarantee [V: Cloudflare docs]. A streamed LLM UI behind `trycloudflare.com` will break. Use the Vercel deployment, or ngrok, which is already installed and configured [V-local].
6. **Tonight's model rule needs settings, not only CLAUDE.md.** Two built-in subagents run below the floor: `claude-code-guide` runs on **Haiku** and `statusline-setup` on **Sonnet**. Automatic safety fallback from Fable or Opus 5.5 can also drop a turn to **Opus 5 or Opus 4.8** [V: sub-agents, model-config docs]. Section 4.2 gives settings that enforce the rule.

---

## 1. Default stack (one pick per layer, plus one fallback)

| Layer | Default pick | Why | Fallback |
|---|---|---|---|
| Web framework | **Next.js 16** (App Router, TS); 16.4.6 is current [V-local npm] | Claude Code, the `vercel` plugin skills and v0-style examples all assume it; front end and API routes ship as one deploy | **Vite 8 + React 19** SPA with a separate **FastAPI** service, when the core is Python (CV/ML) |
| UI kit | **shadcn/ui** (CLI 4.23) + **Tailwind v4.3** [V-local npm], with the `frontend-design` skill | You own the component code, so Claude can restyle it freely; the `vercel:shadcn` skill is already installed | Mantine (more out-of-the-box components and charts) [M] |
| Hosting/deploy | **Vercel Hobby** via CLI | Preview and production URLs in about a minute; the `vercel` plugin is installed | **Modal** for Python, GPU, long-running or websocket servers ($30/mo free compute, a tech partner) [V] |
| Database | **Supabase** (Postgres + pgvector) | One signup covers DB, auth, storage, realtime and vectors | **Convex** (reactive TypeScript backend; 1M function calls/mo free) [V], or **Aiven** Postgres free (a tech partner) [V] |
| Auth | **Supabase Auth**, or none: a hard-coded demo user | Judges never sign up; auth is usually wasted hours | **Clerk Hobby**: 50k MRU, no card, 3 social logins [V] |
| File storage | **Supabase Storage** (1 GB, 50 MB max upload) [V] | Same client, same row-level security | **Cloudinary** (tech partner; image/video transforms) [M on tiers] or Vercel Blob |
| Realtime/websockets | **Supabase Realtime** (200 concurrent connections, 2M msgs/mo) [V] | Live dashboards and multi-device demos with no server to run | **Convex** (realtime by default); for audio/video, **LiveKit** (below) |
| Background jobs | **None at first.** Stream the response, and use Next.js `after()`/`waitUntil` for fire-and-forget work [M] | In 36 hours a queue is usually the wrong abstraction | **Modal** functions (`.spawn()`) for heavy Python or GPU jobs; Vercel Functions cap at 300 s on Hobby [V] |
| LLM access | **Claude API direct** (`@anthropic-ai/sdk` 1.8.0 [V-local]): Sonnet 5.5 for interactive paths, Haiku 5.5 for bulk or classification, Opus 5.5 for the hard reasoning step | Best tool use and structured outputs; the participant's main expertise | **Vercel AI Gateway** (one key across providers, no markup; small free tier) [V], or OpenAI/Gemini direct |
| Embeddings/vector | **pgvector in Supabase** + **Voyage voyage-4-lite** (200M free tokens) [V] | No extra vector DB; Voyage pairs well with Claude | **Gemini Embedding 2** (free tier, multimodal: text, image, audio, video) [V] (see the EEA caveat in section 7) |
| Speech-to-text | **Deepgram** Nova-3 or Flux streaming; $200 credit, no card, 150 concurrent streams [V] | Lowest-friction streaming STT, and the credit outlasts the weekend | **Groq whisper-large-v3-turbo** (batch) [V], or local `mlx-whisper` [M] |
| TTS and realtime voice agent | **Speech-to-speech:** OpenAI **gpt-realtime-2.1-mini** ($10/$20 per 1M audio tokens in/out) [V]. **Claude as the brain:** **LiveKit Agents** (free Build plan) + Deepgram + Claude + **Cartesia Sonic-3.6** or **ElevenLabs Flash** [V] | Realtime-mini is the fastest way to a natural-feeling voice demo; the LiveKit pipeline keeps Claude in the loop at roughly 1 s extra latency [M] | **Gemini 3.8 Live** (free tier, $0.005/min audio in when paid) [V], or **ElevenLabs Agents** (no-code; about 15 free min) [third-party sources, unverified] |
| Image/video generation | **fal.ai**: FLUX.2 $0.012/MP; Kling v2.6 Pro $0.07/s; Seedance 2.0 [V] | One API across many models; fast queue | **Gemini Nano Banana 2.1** ($0.0336 per 1K image) [V], or OpenAI **gpt-image-2** [V] |
| Computer vision (hosted) | **Claude or Gemini vision** for scene understanding; **Roboflow** for detection/segmentation (free: 10 credits/mo ≈ 80k inferences, private projects, no card) [V] | A VLM answers "what is happening"; Roboflow hosts YOLO26-class detectors with no GPU setup | **Modal** GPU (T4 $0.164/h, H100 $1.097/h) for your own model [V] |
| Computer vision (on-device, 18 GB) | **MediaPipe Tasks in the browser** (hands, pose, face, object detection; WASM/WebGPU) [M] | Runs on judges' phones, works without wifi, no server | **Ultralytics YOLO26** on the M3 Pro (MPS) [V: license AGPL-3.0]; a small VLM through **Ollama** (0.40.16 [V-local brew]) in the 2–9B range (e.g. lfm3-vl 2b, bonsai-2 9b, d3 9b) [V: ollama.com/search]. Avoid 27B models (about 16 GB at 4-bit) next to Chrome and Docker |
| Maps/geo | **MapLibre GL JS + OpenFreeMap**: free, no API key, no view limits [V] | Nothing to sign up for or exhaust mid-demo | **Mapbox** (50k web map loads/mo; 100k geocoding and directions requests free) [V] |
| Payments (test) | **Stripe sandbox**: `stripe sandbox create` gives working test keys with **no account registration** [V] | The `stripe` plugin and `stripe:test-cards` skill are installed | Not needed |
| SMS/phone/WhatsApp | **Twilio trial** ($15 credit; can reach **verified numbers only**, at most 5) [V] | Standard; the WhatsApp sandbox is quick | **LiveKit** Build plan: 1 free US number, 50 inbound min [V], for "call this number" demos |
| Email | **Resend** free (3,000/mo, **100/day**, 3 domains) [V] | Simple API and React Email | Not needed; show the email in-app instead |
| Web search/scraping | **Exa** (challenge partner; $10 free credit, reset monthly; no card) [V] + **Firecrawl** (1,000 pages/mo; no card; 10 req/min) [V] | Exa for semantic search and finding links, Firecrawl for clean page markdown; the Exa partnership may carry a prize | **Tavily** (1,000 credits/mo, no card) [V], **Oxylabs** (tech partner) [M on terms], or Claude's server-side `web_search_20260209` tool [V-skill] |
| Mobile delivery | **PWA**: responsive Next.js + manifest + "Add to Home Screen" | A QR code to an https URL works on every judge's phone with no store review and no builds | **Expo Go** (58.0.25 [V-local]) for native sensors; avoid **EAS builds**, whose free queue can wait **90+ min** [V] |
| Analytics/observability | **Vercel Web Analytics** (one component; included on Hobby) [M] | Gives a "real usage" graph for the pitch at near-zero cost | **Sentry** (via the Student Pack: 50k errors) [V], or skip it |

**Hardware (Arduino Hardware Lab):** Arduino UNO Q boards are on site [V]. The simplest stack is board → serial/USB or Wi-Fi → a small local bridge on the laptop (Python `pyserial`, or Node with Web Serial in Chrome) → Supabase Realtime → web UI. Web Serial lets the browser talk to the board directly over USB, so no server is needed [M].

---

## 2. Free tiers, card requirements and demo-time limits

| Service | What's free today | Card or approval? | Limits that bite in a live demo | Source |
|---|---|---|---|---|
| Vercel Hobby | 100 GB transfer, 1M invocations, 4 h active CPU, 360 GB-h memory per month; 100 deploys/day | No card [M] | **1 concurrent build** (teammates queue behind each other); functions **300 s max**; runtime logs kept **1 h**; **cannot connect a repo owned by a GitHub organization** (use a personal repo or CLI deploys); 120 s proxy timeout | [V] vercel.com/docs/limits, /fair-use-guidelines |
| Supabase Free | 2 active projects; 500 MB DB; 1 GB storage; 5 GB egress; 50k MAU; 200 realtime connections; 500k edge invocations | No card [M] | Pauses after 1 week idle (harmless this weekend); shared CPU with 500 MB RAM, so heavy queries are slow | [V] supabase.com/pricing |
| Convex Free | 1M function calls, 0.5 GB DB, 1 GB file storage, 1 GB egress | Not stated | 1 GB egress | [V] convex.dev/pricing |
| Claude API | Pay as you go; no free credit stated | Card plus prepaid credit | **New orgs can start in an "Evaluation tier" below the published limits.** Start tier (cap $500/mo): Opus 5.5 4,000 RPM / 2M ITPM / 400k OTPM; Fable 5.2 4,000 RPM / 500k ITPM / 100k OTPM. **Ramp limits** return 429 on sudden bursts even under the cap; the spend-cap 429 has **no `retry-after`** | [V] platform.claude.com/docs/en/api/rate-limits |
| Claude prices (runtime) | Haiku 5.5 $0.10/$0.50; Sonnet 5.5 $2/$10; Opus 5.5 $4/$20; Fable 5.2 $8/$40 per MTok | n/a | Opus 5.5's default effort is `medium`; Fable turns can run for minutes, so keep Fable out of the request path | [V-skill, cached 2026-11-03] platform.claude.com/docs/en/about-claude/pricing |
| Gemini API | Free tier on 3.8 Flash, 3.6 Flash, Flash-Lite, Live models and embeddings; image and video models are **not** free | Free tier needs a project; Tier 1 needs billing (instant upgrade) | Free-tier limits are **not published per model** ("see AI Studio"); free-tier data is used for training; **EEA/UK serving may require paid services** (conflicting sources) | [V] aistudio.google.com/docs/pricing, /rate-limits |
| OpenAI | Pay as you go | Card | gpt-realtime-2.1-mini $10/$20 audio per 1M; transcription $0.003–0.006/min; gpt-image-2. Tier-based limits [M] | [V] developers.openai.com/api/docs/pricing |
| Deepgram | **$200 credit that does not expire** | **No card** | 150 concurrent STT streams on pay-as-you-go; TTS and agent limits vary by plan and region | [V] deepgram.com/pricing |
| ElevenLabs Free | 10k credits/mo | Not stated | **2 concurrent requests**; **no commercial license** on Free; Starter is $1 for the first month | [V] elevenlabs.io/pricing |
| Cartesia Free | 20k credits/mo + $1 of voice-agent usage | Not stated | **2 concurrent TTS** requests | [V] cartesia.ai/pricing |
| LiveKit Cloud Build | 1,000 agent-session min, 5,000 WebRTC min, $2.50 inference credit (~50 min) | **No card** | **5 concurrent agent sessions**; 1 agent deployment; cold starts after idle; the inference credit runs out fast, so bring your own STT/TTS keys | [V] livekit.com/pricing |
| Groq | Free plan (limits shown in the console) | No card [M] | Even the Developer-plan base limits are low (e.g. gpt-oss-120b 30 RPM / 8K TPM; whisper 20 RPM, 7,200 audio-s/h), and Free is lower still | [V] console.groq.com/docs/rate-limits |
| fal.ai | Pay per use | Not stated on pricing page | Video jobs take tens of seconds; pre-generate demo assets | [V] fal.ai/pricing |
| Modal Starter | **$30/mo compute** | Not stated | 10 GPU concurrency; cold starts of 10–60 s on first GPU call [M] (keep a warm container during judging) | [V] modal.com/pricing |
| Roboflow Free | 10 credits/mo (~80k inferences), private projects | **No card** | "Standard" API rate limits (unspecified) | [V] roboflow.com/pricing |
| Mapbox | 50k web map loads, 100k geocoding and 100k directions requests/mo | Not stated | Token restrictions and URL allowlists can break on preview URLs [M] | [V] mapbox.com/pricing |
| OpenFreeMap | Unlimited public map views | No key | No SLA | [V] openfreemap.org |
| Stripe | Unlimited sandboxes; anonymous sandbox from the CLI | **No registration** for `stripe sandbox create` | None that matter | [V] docs.stripe.com/sandboxes |
| Twilio trial | $15 credit | Signup with phone verification | **Calls and SMS go only to verified numbers (max 5, SMS-verified)**; trial-message prefix [M]; judges' phones cannot receive messages unless verified | [V] twilio.com/docs/usage/trials (via search) |
| Resend Free | 3,000/mo | Domain verification for real recipients [M] | **100 emails/day** | [V] resend.com/pricing |
| Exa | $10 credit, refilled monthly (≈2,500 lite searches) | **No card** | Rate limits not published | [V] exa.ai/pricing |
| Firecrawl Free | 1,000 credits/mo | **No card** | **10 req/min** for scrape/search; 2 concurrent browsers | [V] firecrawl.dev/pricing |
| Tavily Free | 1,000 credits/mo | No card | Not published | [V] tavily.com/pricing |
| Voyage AI | 200M free tokens per text model | Not stated | Not published | [V] docs.voyageai.com/docs/pricing |
| Clerk Hobby | 50k MRU per app | **No card** | Clerk branding; 7-day sessions; no SMS or passkeys | [V] clerk.com/pricing |
| Expo Free | 15 Android + 15 iOS builds | Not stated | **90+ min queue at peak**; iOS device builds need an Apple Developer account [M] | [V] expo.dev/pricing |
| ngrok Free | 1 dev domain (static), 20k requests, 1 GB transfer out | Configured on this Mac [V-local] | **1 GB transfer cap stops traffic**; 4k req/min; a browser interstitial on free domains [M] (skip it with the `ngrok-skip-browser-warning` header) | [V] ngrok.com/pricing |
| Cloudflare quick tunnel | Free, no account | None | **No SSE**, 200 in-flight requests, no uptime guarantee | [V] Cloudflare docs |
| Featherless | No free tier stated (Developer $50/mo) | Card | n/a (a tech partner; partner credits may apply) | [V] featherless.ai/pricing |
| Aiven Free | PostgreSQL (1 CPU / 1 GB RAM / 1 GB disk), Valkey, OpenSearch, Kafka | Not stated | No region choice; no connection pooling | [V] aiven.io/pricing |

**Sign up now; these take time or have approval steps:**
1. **Anthropic Console: add prepaid credit today** and make one test call. A new or low-history org can sit in the Evaluation tier with reduced limits, and those limits rise only with usage history [V]. If you already have an org with paid history, use it.
2. **Junction Discord and platform** (discord.gg/nDgvafhRU4): partner credit codes are usually handed out there. Claim Modal, Featherless, OpenAI, Cloudinary, Aiven and Oxylabs codes early, because some arrive by email with a lag [speculative].
3. **Twilio**, only if SMS or phone is plausible: register, then **verify every teammate's phone** (5 max, SMS-only verification) [V].
4. **Google AI Studio with billing linked**, only if Gemini Live or Nano Banana is in play. The Tier 1 upgrade is instant [V], and paid status also removes the EEA free-tier ambiguity.
5. **Deepgram, fal.ai, Modal, Exa, Roboflow, Supabase**: each takes a couple of minutes with no card. Do it now so keys are in the password manager before the idea is chosen.
6. **Apple Developer account**, only if a native iOS build is unavoidable; enrollment can take a day or more [M]. Prefer a PWA or Expo Go.

---

## 3. Hackathon credits and perks

| Program | What | Status |
|---|---|---|
| Junction 2026 tech partners | "Companies provide credits to their platforms"; tech partners are OpenAI Codex, NVIDIA, Featherless, Modal, Qualia, CRACI, Atech.dev, Scailab, IronShard, Cloudinary, Wendy, Aiven and Oxylabs; Anthropic and Google DeepMind are also listed | **Confirmed that credits exist** [V]; amounts and redemption are **unknown**, so check the Discord or platform |
| Arduino Hardware Lab | UNO Q boards, components, 3D printers, LeRobot arms, hardware mentors | **Confirmed** [V] |
| MLH | Listed as a supporter; MLH events often bundle partner perks such as domains and cloud credits | **Speculative** for this event |
| Deepgram | $200 signup credit, no expiry, no card | **Confirmed** [V] |
| Modal | $30/mo free; startup credits by application; academic credits up to $10k by application | **Confirmed** [V]; the applications are slow, so skip them for this weekend |
| Exa (challenge partner) | $10/mo free; partner prize likely | Credit **confirmed** [V]; prize details **unknown** |
| Voyage AI | 200M free tokens | **Confirmed** [V] |
| LiveKit, Firecrawl, Tavily, Roboflow, Clerk, Resend | Free tiers above | **Confirmed** [V] |
| GitHub Student Developer Pack | Azure $100, Copilot Student, MongoDB Atlas $50, Sentry (50k errors), Clerk Pro, **Stripe $25 fee credit**, free .TECH domain and a Namecheap .me domain for a year, JetBrains, Heroku $13/mo for 24 months, Appwrite Education | **Confirmed list** [V]; verification time not stated, so do not depend on it this weekend |
| Anthropic student programs (Claude Campus / Builder Clubs) | Club-run hackathon credits; Spring 2026 campus applications closed | **Not usable here** [V via search]; any Anthropic credits at Junction would come through the organizers [**speculative**] |
| Google Cloud | Junction 2025 listed Google Cloud credits; the 2026 list has Google DeepMind instead | **Speculative** for 2026 |
| Vercel AI Gateway | Small monthly free credit on a subset of models | **Confirmed** [V]; too small to rely on |

---

## 4. Claude Code setup for the build

### 4.1 Versions and installs (do first)
- Remove the npm-global copy so the native auto-updating binary wins, then update it. Expect **≥ 2.1.321** (2.1.323 is current) [V].
- Once Node moves to 24 with nvm, packages installed globally under Node 25 drop off PATH. That is another reason not to keep Claude Code in npm globals.
- The VS Code extension bundles its own binary, so its version can differ from the terminal's. Check `claude --version` in both after updating.

### 4.2 Enforcing the model rule (orchestrator on Fable 5.2, every subagent on Opus 5.5 or Fable 5.2)

How Claude Code picks a model:
- A subagent's model comes from, in order: the per-call `model` → the agent file's `model` frontmatter → `CLAUDE_CODE_SUBAGENT_MODEL` → the main model [V: sub-agents].
- When the main session runs on Fable, the built-in **Explore** runs on Opus (Opus 5.5 on the Anthropic API). **Plan** and **general-purpose** inherit. **claude-code-guide runs on Haiku** and **statusline-setup on Sonnet** [V].
- `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` together with `CLAUDE_CODE_SUBAGENT_MODEL` applies one model to every subagent, Explore, agent-team teammates and workflow agents, **ignoring frontmatter** (v2.1.257+) [V: sub-agents, agent-teams, workflows].
- On the Anthropic API, `opus` resolves to Opus 5.5 and `fable` to Fable 5.2 [V: model-config].

**Recommended `.claude/settings.json` (strict, the simplest to trust):**
```json
{
  "model": "fable",
  "env": {
    "CLAUDE_CODE_SUBAGENT_MODEL": "opus",
    "CLAUDE_CODE_SUBAGENT_MODEL_FORCE": "1"
  },
  "permissions": {
    "deny": ["Agent(claude-code-guide)", "Agent(statusline-setup)"]
  },
  "worktree": { "baseRef": "head" }
}
```
- This guarantees no subagent, teammate or workflow agent runs on Sonnet or Haiku. That holds even for plugin agents whose frontmatter says `model: sonnet`; many plugin templates do, including skill prompts that default to Sonnet. The `vercel:*` agents' frontmatter was not checked [M].
- The trade-off is that a subagent cannot run on Fable. When Fable quality matters for delegated work, use a **fork**: the Agent tool's `fork` type, or `/subtask` / `/fork`, which inherits the orchestrator's model per the tool's own description. Whether FORCE also rewrites forks is not documented, so check with `/tasks` the first time [M].
- **Looser alternative:** drop `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, keep `CLAUDE_CODE_SUBAGENT_MODEL=opus` and the two deny rules, and set `model: fable` or `model: opus` explicitly in any custom agent files. This allows Fable subagents, but a plugin agent with `model: sonnet` in its frontmatter would then run on Sonnet. Strict mode is safer under a hard rule.
- **Automatic safety fallback:** when a Fable or Opus 5.5 request is flagged in the **cyber** category it re-runs on **Opus 4.8**, and in the **bio** category on **Opus 5**, then **stays there** [V: model-config]. This is a real risk with **defence** or **health/AstraZeneca** challenges. The model-config page documents an "Ask before switching" option: enable it so you choose. After any fallback notice, run `/model fable`. (`availableModels`, which would block fallbacks outright, is managed-settings only [V].)
- The **auto-mode permission classifier** is a separate model call, not a coding agent. If you want it on Opus too, `CLAUDE_CODE_AUTO_MODE_MODEL` exists [V: changelog]. Its exact semantics were not checked [M].
- The **global** `~/.claude/CLAUDE.md` says "Sonnet is the default subagent". The project CLAUDE.md already overrides it in prose, and the settings above make the override mechanical.
- **Fable usage billing:** depending on the plan, Fable can bill to usage credits and show a consent prompt. In background or teammate sessions that prompt can expire after 5 minutes, ending the turn [V: model-config]. Accept it once at the start of the session.

### 4.3 Permissions that cut prompts without being reckless
- **Auto mode** is the built-in starting mode on v2.1.283+ for terminal and VS Code. To make it the default, set `"permissions": {"defaultMode": "auto"}` in **`~/.claude/settings.json`**; a project-level value does not take effect [V: permission-modes]. In VS Code, pick **Auto** from the mode indicator.
- Auto mode blocks or asks for **production deploys**, force-pushes, `git reset --hard`, and `curl | bash` by default [V]. Expect a prompt on `vercel --prod`. That is acceptable: it is a sensible human checkpoint.
- Add these to the project `.claude/settings.json` (the `*` goes after the subcommand, per the docs) [V: permissions]:
```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm *)", "Bash(npm run *)", "Bash(npx shadcn@latest *)", "Bash(bun *)",
      "Bash(uv run *)", "Bash(uv add *)", "Bash(git add *)", "Bash(git commit *)",
      "Bash(git switch *)", "Bash(git worktree *)", "Bash(vercel deploy *)", "Bash(vercel env pull *)",
      "Bash(supabase *)", "Bash(stripe *)", "Bash(gh pr *)", "WebFetch"
    ],
    "deny": ["Bash(git push --force *)", "Bash(rm -rf /*)", "Bash(vercel --prod *)"]
  }
}
```
  Remove the `vercel --prod` deny if you want Claude to ship production builds itself. Bare `WebFetch` allows fetches without prompting while leaving the sandbox allowlist unchanged [V]. Avoid rules like `Bash(git * main)`, which also match `git push origin main` [V].
- Do not use `bypassPermissions` outside a container [V].

### 4.4 MCP servers, plugins and skills worth having
- **Already installed, needs authorizing:** `context7` (docs lookup), `vercel` and `stripe` MCPs are **unauthenticated** in this environment. Run `/mcp` in an interactive session and sign in. **MCP_DOCKER fails to connect.** Disable it or start Docker Desktop's MCP toolkit, otherwise it adds startup noise.
- **Browser testing:** `playwright` and `chrome-devtools-mcp` are installed. Use one of them, Playwright for scripted flows and DevTools for console, network and Lighthouse, and run a "click through the demo path" check before each deploy.
- **Design-to-code:** the Figma connector is live (claude.ai). Use it only if a teammate designs in Figma; otherwise use `frontend-design` + shadcn.
- **Database:** add the Supabase MCP with `claude mcp add`; the hosted server URL and flags were not checked [M]. Alternatively, let Claude use the `supabase` CLI, which is often simpler.
- **Deploy:** the `vercel:deploy`, `vercel:env`, `vercel:ai-sdk`, `vercel:shadcn` and `vercel:nextjs` skills are installed.
- **Video:** `remotion-best-practices` skill + the Remotion documentation MCP (installed).
- **Research:** the bundled `/deep-research` workflow (cross-checked, cited report) for quick technical questions mid-hack [V: workflows].
- Skip adding anything else unless the challenge demands it.

### 4.5 Parallel work for a 1–4 person team [V: worktrees, agents, agent-teams, workflows]
- **Each person runs one orchestrator in their own worktree:** `claude -w <feature>`. The default base is the remote default branch; `worktree.baseRef: "head"` (above) branches from local work instead. Add `.claude/worktrees/` to `.gitignore`, and add a `.worktreeinclude` listing `.env.local` so keys follow into each worktree.
- **Split by file ownership:** for example `app/(ui)` / `app/api` / `lib/ai` / `hardware/`. Merge small and often to `main`, and let Vercel previews show each branch.
- **Agent view** (`claude agents`, research preview): dispatch background sessions for independent chores (seed data, README, demo video, tests) and check status on one screen. Background sessions move into their own worktree before editing.
- **Subagents with `isolation: worktree`** for parallel mechanical changes; **`/batch`** splits one large change into 5–30 worktree-isolated subagents.
- **Agent teams** are experimental and use many more tokens. Use them only for research or review, not parallel implementation. Teammates follow `CLAUDE_CODE_SUBAGENT_MODEL` under FORCE [V].
- **Dynamic workflows / `ultracode`:** good for "audit every route" or "fix until `tsc` passes" loops. Set the size guideline to `small` (`/config workflowSizeGuideline=small`) so they stay fast and cheap [V].
- **Cross-session messaging** lets sessions in different worktrees pass findings to each other [V].
- **Remote Control** lets you steer a running session from your phone while away from the desk (claude.ai/code or the mobile app) [V: docs index].
- **Artifacts** publish a page such as a live status board, a judge one-pager or a pitch to a private claude.ai URL from inside Claude Code [V: docs index].
- Other 2026 additions worth knowing: `/goal` (keep working until a condition holds), `/loop` (poll a deploy), CLI computer use on macOS, and experimental **Code Mode** (v2.1.323) [V: changelog/docs index].

### 4.6 A compact project CLAUDE.md for 48 hours
Keep it under about 60 lines. It loads into every turn and every subagent. Template:
```markdown
# <Project> — Junction 2026
## Model policy (hard rule)
Orchestrator Fable 5.2; subagents Opus 5.5 or Fable 5.2 only; never Sonnet/Haiku. Pass `model` explicitly.
## What we are building (3 lines max)
One-sentence pitch. Primary user. The single demo path judges will see.
## Stack
Next.js 16 App Router + TS, shadcn/Tailwind v4, Supabase (db/auth/storage/realtime), Claude API (claude-sonnet-5-5 interactive, claude-haiku-5-5 bulk), Vercel.
## Commands
pnpm dev | pnpm build | pnpm lint | pnpm typecheck | vercel deploy (preview) | vercel --prod (ask first)
## Rules
- Demo path first: every change must keep `/demo` working end to end. Run `pnpm build` before claiming done.
- Never commit secrets; env lives in .env.local and Vercel env. Repo becomes public (MIT).
- Every external API call: timeout, one retry, and a DEMO_MODE=replay fallback reading fixtures/.
- Prefer editing existing components over new abstractions. No new deps without saying why.
- Mobile-first layouts; test at 390px width.
## Ownership (who edits what)
<name>: app/(ui) · <name>: app/api, lib/ai · <name>: hardware/
## Status (update every few hours)
Done / doing / next. Deadline: final submission Sun 10:00.
```

---

## 5. Demo production

- **Screen recording:** macOS **Cmd+Shift+5** (built in) or QuickTime. Use **OBS** if you need webcam picture-in-picture or scene switching [M]. Record at 1080p or higher, with the browser at 110–125% zoom. `ffmpeg` is installed for trimming: `ffmpeg -ss 00:00:03 -to 00:01:30 -i in.mov -c:v libx264 -crf 20 out.mp4`.
- **Product video:** **Remotion** is free for individuals and companies of up to 3 people [V]. Plan a 60–90 s video: hook (5 s), problem (10 s), screen-capture clips (45 s), tech and impact (15 s), CTA/QR. Use the `remotion-best-practices` skill. Render early on Saturday, not at 09:30 Sunday.
- **Pitch deck:** an Artifact deck (the Slides type exports to .pptx/PDF) or **Google Slides** through the connected Google tools. Use five slides: problem, demo, how it works, why now/impact, team. Keep the live demo as the centrepiece.
- **QR code to the live app:** `npx qrcode-terminal https://<app>.vercel.app` for a quick terminal QR (0.12.0 [V-local]), or `brew install qrencode` and then `qrencode -s 12 -o qr.png https://<app>.vercel.app` for a slide-quality PNG. Put the QR on the last slide and on a printed card at the table.
- **Stable public URL:** use the Vercel production alias `<project>.vercel.app`, which stays the same across deploys. For a local service such as a hardware bridge or local model, use **ngrok** with your static free dev domain (configured on this Mac [V-local]); mind the **1 GB** transfer cap [V]. **Do not use quick Cloudflare tunnels for streaming UIs** (no SSE [V]). A named Cloudflare tunnel needs an account and domain [M].
- **When venue wifi fails (2,000 people on one network):**
  1. **Phone hotspot, tested beforehand** with the real demo.
  2. **Run the app locally:** `pnpm build && pnpm start` on the laptop, with the phone and laptop on the hotspot.
  3. **`DEMO_MODE=replay`:** during rehearsal, record every LLM, STT and TTS response to `fixtures/<hash>.json` keyed by input, then replay them with realistic delays. Build this on Saturday afternoon; it takes about an hour with Claude.
  4. **Local model fallback:** a small Ollama model, pulled **before** arriving or on good wifi.
  5. **A pre-recorded 90 s video**, kept on the desktop, as the last resort.
- **Warm up before going on stage:** hit each endpoint once, to warm Vercel and Modal cold starts and the Claude prompt cache, and to raise the ramp-limit ceiling [V: rate-limits].

---

## 6. Pre-flight checklist (first hour, in priority order)

These are for the participant to run; nothing here has been executed.

**A. Fix the toolchain (about 15 min)**
```bash
# 1. Claude Code: remove the npm copy, update the native one (expect >= 2.1.321)
npm uninstall -g @anthropic-ai/claude-code
claude update && claude --version          # ~/.local/bin/claude; if 'command not found', open a new shell
# 2. Node LTS via nvm (Node 25 is EOL); re-install globals under it
nvm install 24 && nvm alias default 24 && node -v
npm i -g vercel@latest pnpm               # Vercel CLI 65.15.0, pnpm 12.18.0 today [V-local npm]
# (do not rely on /usr/local/bin/corepack 0.17 or /usr/local/bin/node v18, which are stray old installs)
# 3. Modern git (2.56.1); /opt/homebrew/bin is ahead of /usr/local/bin on PATH, so it wins
brew install git && hash -r && git --version
# 4. Service CLIs
brew install supabase/tap/supabase stripe/stripe-cli/stripe qrencode
brew upgrade cloudflared                  # installed 2026.8.2 -> 2026.11.0 (optional)
```
Node 26 is the "latest LTS" [V]. Node 24 is suggested because tooling and Vercel runtime support for 24 is the most settled; Vercel's default runtime was not checked [M]. Either LTS is fine with Next 16 (`node >=20.9.0` [V-local npm]).

**B. Log in (about 10 min)**
```bash
vercel login && supabase login && gh auth status
stripe sandbox create --help              # anonymous sandbox, no registration [V]
```
In Claude Code, run `/mcp` and authorize **context7**, **vercel** and **stripe**. Disable **MCP_DOCKER** if you won't use it.

**C. Sign up and get keys (about 15 min; see section 2):** Anthropic credit and a test call, the Junction Discord partner-credit channel, then Deepgram, Supabase, Exa and fal.ai. Add Modal, Twilio (verify phones) and Google AI Studio with billing only if the idea needs them. Put every key into one shared password-manager note and into `vercel env` later.

**D. Prove the deploy path before choosing the idea (about 15 min)**
```bash
pnpm create next-app@latest app --ts --tailwind --app --eslint --use-pnpm   # flags [M]; the wizard asks otherwise
cd app && pnpm dlx shadcn@latest init && git init && git add -A && git commit -m "scaffold"
vercel deploy && vercel --prod             # confirm a public URL works from the venue network AND your phone
```
Then add `.claude/settings.json` (section 4.2 + 4.3), `CLAUDE.md` (section 4.6), `.worktreeinclude` (`.env.local`), and `.claude/worktrees/` in `.gitignore`. Generate the QR code. Submit a **placeholder preliminary submission before 23:30 tonight**.

**E. Only if relevant to the idea (on good wifi, these are large downloads)**
```bash
brew install ollama && ollama pull <2-9B vision model>    # e.g. lfm3-vl:2b or bonsai-2:9b (names from ollama.com today [V])
uv pip install ultralytics mediapipe     # inside a uv venv: CV prototyping on the M3 Pro (MPS)
```

---

## 7. Risks and traps

**Machine and version traps**
- **Claude Code below 2.1.321** cannot run Fable 5.2. There are two installs (npm 2.1.309 shadows native 2.1.281) [V-local, V docs]. This is the highest-priority fix.
- **Node 25 is EOL** [V]. Some native modules and CLIs only publish prebuilt binaries for LTS lines, which causes `node-gyp` builds or crashes on install [M]. With nvm, global packages are per Node version, so after switching, `vercel` and `pnpm` must be reinstalled. A stray **Node v18 at `/usr/local/bin/node`** and **corepack 0.17** exist; nvm's PATH entry comes first, but scripts that hard-code `/usr/local/bin` would get v18 [V-local].
- **git 2.33** (Nov 2021) works with Claude Code worktrees (the docs only require ≥2.31 for plugin evals and cloud uploads [V]). Newer worktree and sparse-checkout ergonomics are missing, and Apple/Homebrew security fixes since 2021 are absent. Upgrading takes one command.
- **Vercel CLI 64.2** is one major behind (65.15) [V-local]. Plugin skills may assume newer flags [M].
- **Hobby and GitHub orgs:** a team repo under a GitHub organization cannot be connected to a Vercel Hobby project [V]. Use a personal-account repo, or deploy with the CLI only. Also, **1 concurrent build** means four people pushing previews will queue [V].
- **Auto mode in VS Code:** `claudeCode.initialPermissionMode` doesn't accept `auto`; choose it from the mode indicator [V].
- **Ultralytics YOLO26 is AGPL-3.0** [V]. This is compatible with publishing an open repo, but note the license in the README, since submissions are MIT [V]. Prefer MediaPipe (Apache-2.0 [M]) if license purity matters.
- **18 GB RAM:** Chrome + Docker + Next dev + VS Code + a 9B model at about 6 GB is fine. A 27B model (about 16 GB at 4-bit) will swap. Quit Docker if it isn't used.

**API, quota and latency traps during the demo**
- **Anthropic Evaluation tier and ramp limits:** a fresh org has lower limits, and sudden bursts (four judges scanning the QR at once) can 429 with `ramp_limit_exceeded` even under the RPM cap. Mitigate with a warm-up, prompt caching (cached reads don't count toward ITPM) [V], a short `max_tokens`, and a replay fallback.
- **Spend cap:** the 429 has no `retry-after`, so SDK retries just fail [V]. Check the cap in Console → Spend limits.
- **Latency:** never put Fable 5.2 or Opus 5.5 at high effort in the interactive path. Use Sonnet 5.5 or Haiku 5.5, **streaming**, and an explicit `effort` (Opus 5.5 defaults to `medium`) [V-skill]. Pre-compute expensive results.
- **Voice:** concurrency caps are tiny on free tiers (ElevenLabs 2, Cartesia 2 TTS, LiveKit 5 agent sessions, $2.50 LiveKit inference ≈ 50 min) [V]. Only the presenter's device should open a voice session during judging. Bring your own Deepgram and TTS keys to LiveKit.
- **Gemini free tier:** per-model limits are unpublished, free-tier prompts are used for training, and Google's terms may restrict free use when serving EEA/UK users (conflicting sources) [V/partly unverified]. Link billing if Gemini is in the demo path.
- **Groq free tier** TPM is low (Developer base is 8K TPM on the 120B model) [V]. Fine for whisper bursts, risky as the main LLM.
- **Twilio trial** only reaches verified numbers [V]. Demo SMS to your own phone on screen, or show a call to a LiveKit number.
- **Expo EAS** free queue can exceed 90 min [V]. Use a PWA or Expo Go.
- **Cloudflare quick tunnels** break SSE streaming [V]. **ngrok free** stops at 1 GB of transfer [V].
- **Vercel function timeout** is 300 s on Hobby [V]. Long agent runs belong on Modal, or in the client as streamed steps.
- **Safety-classifier fallback:** cyber- or bio-flagged turns in Claude Code switch to Opus 4.8 or Opus 5 [V]. In the product, Fable, Opus 5.5 and Sonnet 5.5 can return `stop_reason: "refusal"`, so handle it and consider server-side `fallbacks` [V-skill]. This matters most for defence and health challenges.
- **Conference wifi:** pull Docker images, Ollama models and npm caches early; keep the hotspot ready; keep `DEMO_MODE=replay`.

---

## Sources (fetched 2026-11-13)
- Junction: https://2026.hackjunction.com/ · https://hackjunction.app/hackathons/junction-2026
- Node.js releases: https://nodejs.org/en/about/previous-releases
- Vercel: https://vercel.com/docs/limits · https://vercel.com/docs/limits/fair-use-guidelines · https://vercel.com/docs/ai-gateway/pricing
- Supabase: https://supabase.com/pricing · Convex: https://www.convex.dev/pricing · Aiven: https://aiven.io/pricing · Clerk: https://clerk.com/pricing
- Claude API: https://platform.claude.com/docs/en/api/rate-limits · pricing via the claude-api skill (cached 2026-11-03), https://platform.claude.com/docs/en/about-claude/pricing
- Claude Code docs: https://code.claude.com/docs/en/permissions · /permission-modes · /sub-agents · /model-config · /agents · /agent-teams · /workflows · /worktrees · /setup · /changelog · https://code.claude.com/docs/llms.txt
- Gemini: https://aistudio.google.com/docs/pricing · https://aistudio.google.com/docs/rate-limits · EEA question: https://discuss.ai.google.dev/t/clarification-on-only-paid-services-for-eea-ch-uk/107860
- OpenAI: https://developers.openai.com/api/docs/pricing
- Voice: https://deepgram.com/pricing · https://elevenlabs.io/pricing · https://elevenlabs.io/pricing/api · https://cartesia.ai/pricing · https://livekit.com/pricing · https://console.groq.com/docs/rate-limits
- Media/CV: https://fal.ai/pricing · https://roboflow.com/pricing · https://modal.com/pricing · https://ollama.com/search?c=vision · https://github.com/ollama/ollama/releases/latest · YOLO26: https://www.ultralytics.com/blog/meet-ultralytics-yolo26-a-better-faster-smaller-yolo-model · https://featherless.ai/pricing
- Maps: https://www.mapbox.com/pricing · https://openfreemap.org/
- Payments/comms: https://docs.stripe.com/sandboxes · https://www.twilio.com/docs/usage/trials · https://resend.com/pricing
- Search/scrape: https://exa.ai/pricing · https://www.firecrawl.dev/pricing · https://www.tavily.com/pricing · https://docs.voyageai.com/docs/pricing
- Mobile: https://expo.dev/pricing
- Tunnels: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/ · https://ngrok.com/pricing
- Video: https://www.remotion.dev/license
- Student pack: https://education.github.com/pack
- Not reachable today: openai.com/api/pricing (403; the developers.openai.com page was used instead), posthog.com/pricing (content truncated; PostHog not recommended for that reason).
