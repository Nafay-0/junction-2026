# Hovi: the Exa "Internet Butler" project

**Owner:** Asadullah (`Asadullah378`). **Status (Sat 14 Nov, 00:45):** step 1 is built and runs locally. Not deployed yet.

Hovi is a general web agent for Exa's challenge "The Internet Butler". You hand it a task; it searches the live web with Exa, answers with live widgets instead of plain text (a map, fare cards, price charts, a gallery, a research report), and ends with buttons that take the task as far as it can go. "Hovi" is a working title, set in `web/src/lib/brand.ts`.

Dock, the Valio Aimo project, is a separate project in this repo, owned by Nafay. It lives in `/web` and `/infra` at the repo root. Everything for Hovi lives in `exa/`.

## The plan, in three steps

1. **Agent with live widgets (built).** Exa is read-only: search, read, structured data. Widgets, sub-agents, parallel tools, a visible plan, clarifying questions, model switching, usage and cost tracking.
2. **Live web actions (next).** The agent acts in a browser the user can watch, asks the user to sign in where needed, and asks for approval before the last step.
3. **Phone app and voice (after that).** Installable web app, voice input, more autonomy (Exa Monitors that keep watching).

## Run it

```bash
cd exa
cp .env.example .env.local   # fill in the five keys
cd web
pnpm install
pnpm dev                     # http://localhost:3000
```

- `pnpm smoke` checks that Claude (through AWS) and Gemini answer with your keys.
- `/dev/widgets` shows every widget with sample data. `?only=flights,hotels` narrows it, `?loading=1` shows loading states, `?still=1` turns animation off.
- `pnpm typecheck`, `pnpm lint` and `pnpm build` all pass.

## What it does today

| Task | Widget | Where the data comes from | Typical time |
|---|---|---|---|
| Places, restaurants, "near me" | Map with cards, hours, directions | Exa's place records (search limited to `exa.ai`) | 1 s |
| Weather | Forecast strip | Exa's weather pages | 1 to 2 s |
| Stock prices | Live chart, refreshes every 30 s | Exa's market pages (`/contents`) | under 1 s |
| Prediction markets | Odds and 30-day chart, refreshes every 20 s | Polymarket's public API, plus Exa news to explain the move | 2 s |
| Flights | Fare cards with booking links | Jinko through Exa Connect (Exa Agent) | 20 to 30 s |
| Hotels | Cards with photos and live rates | Jinko through Exa Connect (Exa Agent) | 30 to 60 s |
| Products | Cards that appear one by one, compare view | Exa search, then a fast model lines them up | 10 s |
| Images | Gallery with lightbox | Exa search with image links | 3 s |
| Research | Parallel sub-agents, then a sourced report | Exa search and contents, 3 to 4 sub-agents | 30 s |
| Anything else | Text with source pills | Exa search and contents | 5 to 10 s |

The model can also show a comparison table, key facts, a plan, clarifying questions (answered with taps) and action buttons (book, call, directions, calendar, email).

Every widget shows its sources. Every answer shows the model, the time, the number of Exa calls and the cost; the top bar adds them up for the conversation.

## How it is built

- **Stack:** Next.js 16, React 19, Tailwind 4, shadcn/ui, Vercel AI SDK 7. One app, one deployment.
- **Models:** Claude through Claude Platform on AWS (`@ai-sdk/anthropic-aws`) and Gemini through Google AI Studio, switchable per message. Sub-agents and extraction run on the fast model of the same family. Prices are in `web/src/lib/agent/models.ts`.
- **Why the AI SDK and not Pydantic AI or a hand-written loop:** see `research_notes/Agent runtime choice/`. Short version: one codebase, and each tool's output type is the widget's input type.
- **Code map** (all under `web/src`):
  - `lib/widgets/types.ts`: the contract between tools and widgets.
  - `lib/exa/client.ts`: the Exa client (search, contents, agent runs), with cost tracking and a 5-minute cache.
  - `lib/agent/tools/`: the 16 tools. `lib/agent/instructions.ts`: the system prompt.
  - `app/api/chat/route.ts`: the agent loop, usage metadata, context trimming, prompt caching.
  - `components/butler/`: the chat interface. `components/widgets/`: the widgets. `WIDGETS.md` at the app root is the guide for building one.

## Research

- `reports/Exa Internet Butler playbook.md`: Exa's API as of 13 Nov 2026, costs and how to stand out. Read it before touching the Exa calls; Exa changed a lot in 2026.
- `research_notes/`: the notes behind it, and the runtime comparison.

## Open questions

- **Two projects, one team of two.** Can one team submit two projects (Dock and this), and is each eligible for the main prize? Someone has to be at each table during peer review. Ask the organisers.
- **Deployment.** Not done. The app needs a public address for the submission's demo link and for phones at the table.
- **Hotels are slow** (up to a minute through Jinko). A faster source would improve the trip demo.
- **Not yet checked on a phone.** The layout is responsive, but nobody has used it on one.
