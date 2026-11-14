# Beryl

**Your internet butler.** Ask for anything. Beryl searches the live web with Exa, answers with something you can use, and in the desktop app it gets the job done in a real browser while you watch.

Built at Junction 2026 (13 to 15 November, Espoo) for Exa's challenge, "The Internet Butler".

- Live at [beryl.zeroanomaly.tech](https://beryl.zeroanomaly.tech). Accounts are by invitation for now.
- On the web, as a desktop app for Mac and Windows, and on a phone.

## What it does

- **Ask for anything.** Answers arrive as live cards, not a page of links: stock prices, places on a map with opening hours, flights, weather, product comparisons, images. Every card shows its sources.
- **Sift.** For "find me the ones that…" questions. Exa returns about 100 pages with their text, and Gemini's Decisions API checks every page against every wish in one request. You get a grid of yes, no, or "the page does not say". In our test it checked 100 pages against four wishes and answered in about nine seconds.
- **Research.** A team of sub-agents searches in parallel and Beryl writes one report with its sources.
- **The live browser.** In the desktop app Beryl opens a real browser and works the site itself: it clicks, types and fills forms. You can take over at any moment.
- **Voice.** A live call that listens, searches and answers out loud while the cards arrive on screen.
- **Jobs.** "Every weekday at 8, email me the three biggest AI stories." It runs on schedule and emails you the result.
- **Modes and cost.** You pick a mode and an effort, never a model. Every answer shows what it used and what it cost.
- **Background work.** A chat keeps working when you close the tab or open another one.

## What it will not do

The rules are in code, not left to the model.

- It never enters payment details, passwords or one-time codes. Those pages are handed to you.
- Anything that commits you (a booking, an order, a message) waits for your press on Approve.
- It does not hide from a site that it is an agent.

## What it runs on

- **Exa** is how Beryl sees the web: search with page text and highlights, place records and market pages.
- **Gemini** does three jobs. Gemini 4 Hydrogen and Gemini 4 Carbon run the agent in two of the four modes, Gemini 3.8 Live runs voice, and the Gemini Decisions API runs Sift.
- **Claude** Sonnet 5.5 and Opus 5.5 run the other two modes.
- Next.js, React and Postgres, with one server for the web and the desktop app. The desktop app is Electron.

## Run it

You need Node 24, pnpm and a Postgres database.

```bash
cd exa
cp .env.example .env.local   # the keys, DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD
cd web
pnpm install
pnpm dev                     # the web app, on http://localhost:3000
pnpm desktop                 # the desktop app, on the same server
```

Sign in with the admin email and password from `.env.local`.

## Read more

| File | What is in it |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | How each part works, every command and test, and where the code is |
| [DEPLOYMENT.md](DEPLOYMENT.md) | How the live site is set up on Google Cloud, and how to deploy |
| [CLAUDE.md](CLAUDE.md) | The rules the coding agents follow in this folder |
| [web/WIDGETS.md](web/WIDGETS.md) | How to add a card |
| [reports/](reports/) | Our notes on Exa's API |

The team's other project, for Valio Aimo's challenge, is separate and lives at the root of this repository.

By Zero Anomaly.
