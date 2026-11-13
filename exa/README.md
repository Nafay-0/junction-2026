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

## Starting points raised so far (none chosen)

- **Benefits you are owed:** describe your situation and get the benefits, refunds or subsidies you qualify for, each with its source.
- **Rent-increase checker:** paste the notice and learn whether the increase is legal where you live, with the rule it rests on.

## Open questions

- **Two projects, one team of two.** Can one team submit two separate projects (Dock and this), and is each eligible for the main prize? Peer review needs someone at each table, and every participant must also review their assigned projects. Ask the organisers.
- **Exa key:** claim the $50 credit and put the key in `exa/.env.local`.

## Layout

Nothing built yet. The stack is chosen once the idea is locked.

## Secrets

Keys go in `exa/.env.local`, which the root `.gitignore` already ignores. Variable names go in `exa/.env.example` with empty values.
