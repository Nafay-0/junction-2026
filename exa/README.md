# Exa project: "The Internet Butler"

**Owner:** Asadullah (`Asadullah378`). **Status:** challenge chosen, idea not locked yet (Fri 13 Nov, 22:00).

Dock, the Valio Aimo project, is a separate project in this repo, owned by Nafay. It lives in `web/` and `infra/`. Everything for this project lives in `exa/`.

## The brief

Taken from the participant platform; the full table is in `research/05-official-briefs.md`.

- **Ask:** a personal agent that takes a tedious real-life task off someone's hands using live web search. It is demoed on a real case, including queries the judges type in themselves.
- **Judging:** use of Exa, usefulness to a specific group, shown sources, originality, live demo. No weights published.
- **Prizes:** $2,500 + $5,000 Exa credits / $1,500 / $500.
- **Credits:** Exa gives $50 per participant (platform: Developer Tools and Assets).
- **Exa workshop:** Sat 16:30–17:00, Loft (4th floor).

## What the brief implies for the build

- **Judges bring their own queries.** The agent has to handle input nobody rehearsed, live. A single scripted path will not survive judging.
- **Sources are scored.** Every claim the agent makes links to the page it came from.
- **One specific group, one tedious task.** "Usefulness to a specific group" penalises general assistants. Name the group in the first sentence of the pitch.
- **The result is the demo, not the chat.** Show the finished task (the form filled, the list ranked, the letter drafted), with the sources beside it. A chat window as the main demo is on the playbook's avoid list (`research/03-winning-playbook.md`, 4.5).
- **Expect a crowd.** This is likely the most crowded software challenge, so the angle has to carry it.
- **The main prize applies too.** Peer reviewers score Innovation, Impact and Implementation at the table on Sunday 10:30.

## Research (Fri 13 Nov, 23:15)

- **Report:** `exa/reports/Exa Internet Butler playbook.md`. Read it before building; Exa's API changed a lot in 2026 and older examples break.
- **Notes behind it:** `exa/research_notes/Exa Internet Butler playbook/` (API reference, Websets/Monitors/MCP, pricing and limits, Exa's demos and past winners, task and audience, source display and agent design).

## Candidate ideas, ranked by the research (none locked)

1. **Internationals in Finland: "what changed for me since I arrived, and what must I do by when."** Finland changed residence, benefit and tax rules repeatedly in 2025 and 2026, so a model answering from memory is wrong. About 610,000 foreign-language residents; many are at the venue. Output: a dated timeline of rule changes with the quoted official text, plus drafted messages and calendar deadlines for the user to approve.
2. **Price-increase and terms-change fighter:** paste a provider's notice; get the terms you signed up under, your right to cancel, alternatives, and a drafted termination.
3. **EU261 flight-claim builder:** biggest money figure, but crowded, and needs flight data Exa does not have.

Ideas named in Exa's brief (rent checker, benefits finder, restaurant picker) will be crowded, and Exa's own Places demo already does the restaurant one.

## Open questions

- **Two projects, one team of two.** Can one team submit two separate projects (Dock and this), and is each eligible for the main prize? Peer review needs someone at each table, and every participant must also review their assigned projects. Ask the organisers.
- **Exa key:** claim the $50 credit and put the key in `exa/.env.local`.
- **Does Exa cover kela.fi, migri.fi and vero.fi well?** Untested. Exa returns results only in the query's language. Run about ten real queries in English and Finnish before locking idea 1.
- **Do hackathon credits unlock Snapshot (past page versions) and Websets?** Snapshot is not on the free tier, and its docs describe only a rolling 5-month window. Ask Exa's staff. Idea 1 must work without it, from dated official news pages.

## Layout

Nothing built yet. The stack is chosen once the idea is locked.

## Secrets

Keys go in `exa/.env.local`, which the root `.gitignore` already ignores. Variable names go in `exa/.env.example` with empty values.
