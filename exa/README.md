# Hovi: the Exa "Internet Butler" project

**Owner:** Asadullah (`Asadullah378`). **Status (Sat 14 Nov, 05:30):** steps 1 and 2 are built and run locally. Step 2, the live browser, works end to end on a test site and on real shops and booking pages; real sites that put up a "verify you are human" check are handed to the user. Not deployed yet.

Hovi is a general web agent for Exa's challenge "The Internet Butler". You hand it a task; it searches the live web with Exa, answers with live widgets instead of plain text (a map, fare cards, price charts, a gallery, a research report), and ends with buttons that take the task as far as it can go. "Hovi" is a working title, set in `web/src/lib/brand.ts`.

Dock, the Valio Aimo project, is a separate project in this repo, owned by Nafay. It lives in `/web` and `/infra` at the repo root. Everything for Hovi lives in `exa/`.

## The plan, in three steps

1. **Agent with live widgets (built).** Exa is read-only: search, read, structured data. Widgets, sub-agents, parallel tools, a visible plan, clarifying questions, model switching, usage and cost tracking.
2. **Live web actions (built).** The agent acts in a real browser the user watches live, hands the page over for sign-ins and human checks, asks for approval before anything that commits the user, and never pays.
3. **Phone app and voice (after that).** Installable web app, voice input, more autonomy (Exa Monitors that keep watching).

## Run it

```bash
cd exa
cp .env.example .env.local   # fill in the five keys
cd web
pnpm install
pnpm dev                     # http://localhost:3000
```

- `pnpm smoke` checks that Claude (through AWS) and Gemini answer with your keys. `pnpm smoke options` sends one small request per model and job (agent, sub-agent, extraction) with the exact thinking settings the app uses, so a setting a model rejects shows up there and not in front of a user.
- `pnpm test:guard` checks the live browser's safety rules as a table (no browser needed). `pnpm test:browser 3000` runs them end to end against a pretend shop (`/dev/sandbox.html`) with the dev server running: card numbers, passwords and pay buttons must be refused, commitments must ask first.
- `/dev/browser` shows the live browser panel driven by a script, with a button for every state.
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

**Custom widget.** When none of the fixed widgets fits, the agent composes its own with the `showWidget` tool, block by block: charts (pie, donut, bar, stacked bar, horizontal bar, line, area, scatter, radar), stat tiles, tables, lists and timelines, progress bars, images, callouts and buttons. A button can open a link, copy text, or send a follow-up to the agent, so the widget can continue the task. For something no block can express (a calculator, a custom diagram) there is an `html` block: a self-contained fragment that runs in a sandboxed frame with no network access and the app's colours passed in. Blocks appear as the model writes them. The block shapes are in `web/src/lib/widgets/types.ts` ("Custom widget"), the tool in `web/src/lib/agent/tools/compose.ts`.

Every widget shows its sources. Every answer shows the model, the time, the number of Exa calls and the cost; the top bar adds them up for the conversation.

## The live browser (step 2)

When the task is to do something on a site (reserve a table, fill a basket, take a booking through the provider's form, fill in an application, change something in an account), the agent opens a real Chrome on the server and works in it while the user watches.

**What the user sees.** The browser opens beside the chat by itself: browser on the left, chat on the right, with a divider to drag. It can fill the window (the chat is then one tap away) or be closed; on a phone it is a full-screen sheet. The agent's pointer glides to what it is about to press, the target gets a ring and a caption ("Clicking 'Reserve a table'"), typed text appears as it is typed. The chat shows the same steps as a trail.

**What stays with the user.** Three things, enforced in code (`web/src/lib/browser/guard.ts`), not left to the model:
- **Payment: never.** The agent cannot type into card, bank or security-code fields, cannot press a button that pays, and cannot submit a form that holds card fields. It does nothing at all on payment providers' pages. It takes the task to the payment page and hands it over; the user may pay there themselves.
- **Passwords, one-time codes and human checks: the user's.** The agent cannot type into them. It hands the page over with a "your turn" card; the user types straight into the live browser, then hands it back.
- **Commitment: with approval.** Anything that submits, sends, books, orders, posts, deletes, signs up or accepts terms stops for a yes. The card says exactly what will happen, the button is ringed in the live browser, and nothing runs until the user approves. Approvals are signed by the server, so one cannot be forged by editing the conversation.
Reading, navigating, searching, filling in a form, adding to a basket and refusing cookies need no approval.

**What the agent can read.** It reads the page as text (Chrome's accessibility tree, cut down to what is in view), never as a picture. Values of password, card and code fields are removed before the text reaches the model, including ones the user typed while in control. What the user types during a hand-over goes to Chrome and nowhere else: it is not logged or stored.

**Sign-ins.** Kept in a browser profile per visitor (`web/.browser-profiles/`, not committed) so the user signs in once. "Forget sign-ins" in the browser's menu wipes it.

**Assumptions and limits, stated plainly.**
- The browser runs on the machine that runs the app (a real Chrome through Playwright). That rules out serverless hosting; a public demo needs a small server or a tunnel to a laptop. `BrowserSession` is the one place a hosted browser would plug in.
- Chrome runs hidden and sends the same browser name a visible Chrome would; nothing else is disguised, and sites can still tell it is automated. The agent does not solve CAPTCHAs: it detects the common ones and hands them to the user. Some sites will refuse an automated browser altogether; the agent then says so and gives the link.
- The safety rules are patterns (field names, button texts in seven languages, known payment hosts). They err towards asking, and they can miss an unusual page. The approval step is the second line: a commitment the patterns miss is still one the model is told to mark.
- One browser per visitor, at most four at once on a server; idle ones close after twenty minutes.
- Anyone who knows a visitor's browser id (a random value in their browser's storage) could watch that browser. Fine for a demo, not for production: that needs accounts.

Code: `web/src/lib/browser/` (`protocol.ts` the contract, `session.ts` the browser, `guard.ts` the rules, `snapshot.ts` what the model reads, `client.ts` the interface's side), `web/src/components/browser/` (the panel), `web/src/lib/agent/tools/browser.ts` (the agent's four tools), and the approval policy in `web/src/app/api/chat/route.ts`.

**Edit, retry, copy.** Hovering a message you sent shows copy and edit; editing turns it into a text box, and resending replaces that message and everything below it. Under each answer are copy (the answer as markdown, plus the research report if there is one) and try again, which answers the same request afresh and also drops everything below. Both wait until the agent has finished or been stopped.

**Report export.** A finished research report has its own copy and download buttons in the card's header. Copy puts markdown and a formatted version on the clipboard, so it pastes with headings, tables and links into a document or an email. Download offers markdown, a self-contained web page, or the print dialog for a PDF; each holds only that report and its numbered sources (`web/src/lib/export.ts`).

**Saved conversations.** Every conversation is saved as it happens and listed in a sidebar on the left (a drawer on phones) that can be closed. Conversations can be reopened, renamed and deleted, and the one that was open comes back after a refresh. They are stored in the browser's IndexedDB (`web/src/lib/conversations.ts`): there is no account and no server database, so they do not follow the user to another device.

**Exact location.** When a task depends on where the user is ("near me", "the closest"), the agent shows a card asking to share their location. Accepting triggers the browser's own permission prompt; the position is saved in the browser, named through a reverse lookup (`/api/geo/reverse`, coordinates rounded to about 100 m), sent with later messages, and used by Exa's "near me" search. The map then shows the user's position, each place's distance and directions from where they are. If the browser blocks it or the user says no, the agent carries on with the approximate place or one the user types, and does not ask again. The location button in the message box turns it on and off at any time. Places also show whether they are open right now, worked out in the place's own time zone.

## How it is built

- **Stack:** Next.js 16, React 19, Tailwind 4, shadcn/ui, Vercel AI SDK 7. One app, one deployment.
- **Models:** Claude (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2) through Claude Platform on AWS (`@ai-sdk/anthropic-aws`) and Gemini (4 Carbon, 4 Hydrogen) through Google AI Studio, switchable per message. Sub-agents and extraction run on the fast model of the same family (Haiku 5.5 or Gemini 4 Hydrogen). The thinking settings differ by family and by model (Gemini 4 rejects the "minimal" level; only Haiku lets Claude's thinking be switched off), so they are decided per model and job in one file, `web/src/lib/agent/options.ts`. Prices are in `web/src/lib/agent/models.ts`; Gemini 4 Carbon's list price doubles on 1 Dec 2026.
- **Why the AI SDK and not Pydantic AI or a hand-written loop:** see `research_notes/Agent runtime choice/`. Short version: one codebase, and each tool's output type is the widget's input type.
- **Code map** (all under `web/src`):
  - `lib/widgets/types.ts`: the contract between tools and widgets.
  - `lib/exa/client.ts`: the Exa client (search, contents, agent runs), with cost tracking and a 5-minute cache.
  - `lib/agent/tools/`: the 22 tools. `lib/agent/instructions.ts`: the system prompt.
  - `app/api/chat/route.ts`: the agent loop, usage metadata, context trimming, prompt caching.
  - `components/butler/`: the chat interface. `components/widgets/`: the widgets. `WIDGETS.md` at the app root is the guide for building one.

## Research

- `reports/Exa Internet Butler playbook.md`: Exa's API as of 13 Nov 2026, costs and how to stand out. Read it before touching the Exa calls; Exa changed a lot in 2026.
- `research_notes/`: the notes behind it, and the runtime comparison.

## Open questions

- **Two projects, one team of two.** Can one team submit two projects (Dock and this), and is each eligible for the main prize? Someone has to be at each table during peer review. Ask the organisers.
- **Deployment.** Not done. The app needs a public address for the submission's demo link and for phones at the table. With the live browser it must be a server that can run Chrome (or a tunnel to the laptop), not a serverless host.
- **Human checks inside the live browser.** Detected and handed to the user, but nobody has yet tried passing one by hand in the automated Chrome; some may refuse it.
- **Hotels are slow** (up to a minute through Jinko). A faster source would improve the trip demo.
- **Not yet checked on a phone.** The layout is responsive, but nobody has used it on one.
