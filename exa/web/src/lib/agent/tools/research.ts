import "server-only";

import { generateText, isStepCount, Output, streamText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { decide, decisionsConfigured, type DecisionQuestion, type YesNoAnswer } from "@/lib/decisions/client";
import { exaContents, exaSearch, type ExaResult } from "@/lib/exa/client";
import { domainOf, toSource, type ResearchAgent, type ResearchData, type ResearchStep, type Source } from "@/lib/widgets/types";
import type { ResearchDepth } from "../depth";
import { agentProviderOptions, extractionProviderOptions, workerProviderOptions } from "../providers";
import { clip, errorMessage, type ToolContext } from "./context";

/*
 * Deep research: the question is split into angles and one sub-agent per angle works in
 * parallel on the fast model, each with its own Exa search and read tools and its own
 * context. Their progress streams to the UI as it happens. The main model then writes the
 * report from their findings, and that streams in too.
 *
 * How far it goes is the request's depth (`depth.ts`), set by the user's mode and effort:
 * - Standard: two to four sub-agents, a handful of searches each. Half a minute to a minute.
 * - Deep and beyond: more sub-agents, several wordings per search, and every page a search
 *   returns is checked against the angle by the decision model before the sub-agent sees it,
 *   so more pages mean more evidence instead of more noise.
 * - Deeper and Exhaustive: a second round. The lead reads what came back and sends a few more
 *   sub-agents after the gaps and the contradictions, then writes a long, structured report.
 *
 * The whole run has a time budget. When it runs low the sub-agents are told to write up what
 * they have, and the report is written from that: a late answer is better than none.
 */

/** Sources shown beside one angle, and listed under the whole report. The counts say how many there were in all. */
const SHOWN_PER_AGENT = 8;
const LISTED_SOURCES = 500;
/** Sources that carry their quoted passage in the list. Past that, a few hundred passages would only make the message heavy. */
const WITH_SNIPPET = 40;
/** Before the time is up, sub-agents are told to write up; this long after that, the ones still going are cut off. */
const WRITE_UP_SECONDS = 20;
/** Follow-up sub-agents answer one pointed question: they need fewer steps than the first round. */
const FOLLOW_UP_STEPS = 5;

/** What one run keeps that the interface does not need in full: every source, and what has been seen. */
type Run = {
  ctx: ToolContext;
  depth: ResearchDepth;
  question: string;
  /** Every distinct page a search has turned up, kept or not. */
  checked: Set<string>;
  /** Everything each sub-agent kept, in the order it was found. */
  kept: Map<string, Source[]>;
  /** Pages each sub-agent has already been given, so it is not handed the same passage twice. */
  given: Map<string, Set<string>>;
  /** What each sub-agent's searches and reads returned, kept so its findings can still be written up if it is cut short. */
  notes: Map<string, string[]>;
  changed: () => void;
  /** When sub-agents are told to stop searching and write up, and the signal that cuts off the ones still going after that. */
  writeUpAt: number;
  signal: AbortSignal;
};

/** The most of its notes a cut-short sub-agent is given back to write up from. */
const NOTES_CHARS = 45_000;

function note(run: Run, agent: ResearchAgent, text: string): string {
  const notes = run.notes.get(agent.id) ?? [];
  run.notes.set(agent.id, notes);
  notes.push(text);
  return text;
}

const pageKey = (url: string) => url.replace(/#.*$/, "").replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "");

function keep(run: Run, agent: ResearchAgent, sources: Source[]) {
  const kept = run.kept.get(agent.id) ?? [];
  run.kept.set(agent.id, kept);
  for (const source of sources) {
    if (kept.length >= run.depth.sourcesPerAgent) break;
    if (!kept.some((x) => x.url === source.url)) kept.push(source);
  }
  agent.sources = kept.slice(0, SHOWN_PER_AGENT);
  agent.sourceCount = kept.length;
}

/**
 * Which of these pages bear on the angle, most relevant first. One request to the decision model
 * answers for all of them at once. If it cannot be asked, every page is kept in the order Exa gave.
 */
async function relevant(run: Run, agent: ResearchAgent, pages: ExaResult[], signal?: AbortSignal): Promise<ExaResult[]> {
  if (!run.depth.triage || pages.length < 3 || !decisionsConfigured()) return pages;
  const questions: Record<string, DecisionQuestion> = {};
  pages.forEach((_, i) => {
    questions[`p${i + 1}`] = {
      type: "noul",
      instructions: `Look only at Page ${i + 1}. Does that page contain specific information that helps answer this: ${agent.title}?`,
      criteria: {
        true_description: "It gives facts, figures, rules, dates, findings or first-hand detail that bear on it",
        false_description: "It is about something else, only mentions the subject in passing, or has nothing specific to offer",
      },
    };
  });
  const input = pages.map((r, i) => `[Page ${i + 1}] ${r.title ?? ""}\n${r.url}\n${(r.highlights ?? []).map((h) => clip(h.replace(/\s+/g, " "), 700)).join("\n")}`).join("\n\n");
  try {
    const judged = await decide(`The overall question: ${run.question}\n\n${input}`, questions, { meter: run.ctx.meter, signal, timeoutMs: 8000 });
    const scored = pages.map((page, i) => ({ page, p: (judged.answers[`p${i + 1}`] as YesNoAnswer | undefined)?.noul ?? 0.5, rank: i }));
    const fit = scored.filter((row) => row.p >= 0.5).sort((a, b) => b.p - a.p || a.rank - b.rank);
    // A search that turns up nothing on the subject still hands back its best guesses, marked as such by their order.
    return (fit.length ? fit : scored.sort((a, b) => b.p - a.p).slice(0, 2)).map((row) => row.page);
  } catch {
    return pages;
  }
}

/** One page as a sub-agent reads it in a search result: the strongest pages get more of their text. */
function passage(r: ExaResult, n: number, full: boolean): string {
  const date = r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : "";
  const quotes = (r.highlights ?? [])
    .slice(0, full ? 2 : 1)
    .map((h) => `> ${clip(h, full ? 650 : 380)}`)
    .join("\n");
  return `[${n}] ${r.title ?? ""}\n${r.url}${date}\n${quotes}`;
}

function researcherTools(run: Run, agent: ResearchAgent, signal?: AbortSignal) {
  const { ctx, depth, changed } = run;
  const several = depth.queriesPerSearch > 1;
  const recency = z.enum(["week", "month", "year"]).optional().describe("Only pages published within this window.");

  const search = async (queries: string[], window: "week" | "month" | "year" | undefined): Promise<string> => {
    const step: ResearchStep = { type: "search", label: queries.length > 1 ? `${queries[0]} (and ${queries.length - 1} more)` : queries[0], domains: [] };
    agent.steps.push(step);
    changed();
    try {
      const days = window === "week" ? 7 : window === "month" ? 31 : window === "year" ? 366 : undefined;
      const answers = await Promise.allSettled(
        queries.map((query) =>
          exaSearch(
            {
              query,
              numResults: depth.resultsPerSearch,
              startPublishedDate: days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined,
              userLocation: ctx.country,
              contents: { highlights: { maxCharacters: 700 } },
            },
            { meter: ctx.meter, signal },
          ),
        ),
      );
      const lists = answers.map((a) => (a.status === "fulfilled" ? a.value.results : []));
      const failed = answers.find((a) => a.status === "rejected") as PromiseRejectedResult | undefined;
      if (lists.every((list) => list.length === 0)) return failed ? `Search failed: ${errorMessage(failed.reason)}` : "No results. Try different wording.";

      // The standard depth is the plain search it has always been: every result, as Exa ranked them.
      if (!several && !depth.triage) {
        const results = lists[0];
        step.domains = [...new Set(results.map((r) => domainOf(r.url)))].slice(0, 5);
        for (const r of results) run.checked.add(pageKey(r.url));
        keep(run, agent, results.slice(0, 4).map((r) => toSource({ ...r, snippet: clip(r.highlights?.[0], 240) })));
        changed();
        return note(run, agent, results.map((r, i) => passage(r, i + 1, true)).join("\n\n"));
      }

      // Taken in turn from each wording, one entry per page, and only pages this sub-agent has not been given yet.
      const given = run.given.get(agent.id) ?? new Set<string>();
      run.given.set(agent.id, given);
      const fresh: ExaResult[] = [];
      const inCall = new Set<string>();
      for (let rank = 0; rank < depth.resultsPerSearch; rank++) {
        for (const list of lists) {
          const r = list[rank];
          if (!r) continue;
          const key = pageKey(r.url);
          run.checked.add(key);
          if (inCall.has(key) || given.has(key)) continue;
          inCall.add(key);
          fresh.push(r);
        }
      }
      if (fresh.length === 0) return "Nothing new: every page these searches found, you have already been given. Try a different angle of attack, or write up.";

      const fit = await relevant(run, agent, fresh, signal);
      const handed = fit.slice(0, depth.passagesPerSearch);
      for (const r of handed) given.add(pageKey(r.url));
      step.checked = fresh.length;
      step.kept = fit.length;
      step.domains = [...new Set(fit.map((r) => domainOf(r.url)))].slice(0, 5);
      keep(run, agent, fit.map((r) => toSource({ ...r, snippet: clip(r.highlights?.[0], 240) })));
      changed();

      const strongest = Math.ceil(handed.length / 2);
      const more = fit.length - handed.length;
      const dropped = fresh.length - fit.length;
      const notes = [more > 0 ? `${more} more pages on the subject were kept as sources but are not quoted here.` : "", dropped > 0 ? `${dropped} pages that did not bear on your angle were left out.` : ""].filter(Boolean).join(" ");
      return note(run, agent, `Most relevant first.\n\n${handed.map((r, i) => passage(r, i + 1, i < strongest)).join("\n\n")}${notes ? `\n\n${notes}` : ""}`);
    } catch (err) {
      return `Search failed: ${errorMessage(err)}`;
    }
  };

  const read = async (urls: string[]): Promise<string> => {
    const step: ResearchStep = { type: "read", label: urls.length > 1 ? `${domainOf(urls[0])} and ${urls.length - 1} more` : domainOf(urls[0]), domains: [...new Set(urls.map(domainOf))].slice(0, 5) };
    agent.steps.push(step);
    changed();
    try {
      const res = await exaContents({ urls, text: { maxCharacters: 6000 } }, { meter: ctx.meter, signal });
      const pages = res.results.filter((page) => page.text);
      if (pages.length === 0) return urls.length > 1 ? "Could not read those pages." : "Could not read that page.";
      if (pages.length === 1 && pages[0].title) step.label = clip(pages[0].title, 70);
      for (const page of pages) run.checked.add(pageKey(page.url));
      keep(run, agent, pages.map((page) => toSource(page)));
      changed();
      return note(run, agent, pages.map((page) => `# ${page.title ?? page.url}\n${page.url}\n\n${page.text}`).join("\n\n---\n\n"));
    } catch (err) {
      return `Could not read ${urls.length > 1 ? "the pages" : "the page"}: ${errorMessage(err)}`;
    }
  };

  return {
    search: several
      ? tool({
          description: `Search the live web. Give up to ${depth.queriesPerSearch} differently worded descriptions of the pages you want: they run at once, and you get back the pages that bear on your angle, most relevant first, with quoted passages.`,
          inputSchema: z.object({
            queries: z.array(z.string()).min(1).max(depth.queriesPerSearch).describe("Natural-language descriptions of the pages to find, each worded differently or aimed at a different kind of source."),
            recency,
          }),
          execute: ({ queries, recency }) => search(queries, recency),
        })
      : tool({
          description: "Search the live web. Describe the pages you want in natural language. Returns pages with quoted passages.",
          inputSchema: z.object({ query: z.string(), recency }),
          execute: ({ query, recency }) => search([query], recency),
        }),
    read: several
      ? tool({
          description: "Read the full text of up to three pages you found, when the quoted passages are not enough: exact figures, conditions, tables, methods.",
          inputSchema: z.object({ urls: z.array(z.string().url()).min(1).max(3) }),
          execute: ({ urls }) => read(urls),
        })
      : tool({
          description: "Read the full text of one page you found, when the quoted passages are not enough.",
          inputSchema: z.object({ url: z.string().url() }),
          execute: ({ url }) => read([url]),
        }),
  };
}

/** What a sub-agent is told. The standard depth keeps the wording it has always had. */
function researcherInstructions(run: Run, agent: ResearchAgent, steps: number): string {
  const { ctx, depth } = run;
  const cite =
    "Put a markdown link to the page after each fact, with the site name as the link text, like [kela.fi](https://www.kela.fi/...). Only link pages you actually got back from a search or read. " +
    "End with one line on what you could not confirm, if anything.";
  if (depth.level === 0) {
    return (
      `You are one researcher in a small team. Today is ${ctx.today}.\n` +
      "Work on your angle only; the others cover the rest. Run two to four searches (several at once when they are independent), read a page only when the quoted passages leave out something you need, then stop and write up.\n" +
      `Your write-up goes to the lead, who has not seen your searches: ${depth.findingsWords} words of markdown with the concrete facts, numbers, dates and conditions you found. ` +
      cite
    );
  }
  const second = agent.round === 2;
  return (
    `You are one researcher in a team of specialists working on a ${depth.label.toLowerCase()} research task. Today is ${ctx.today}.\n` +
    (second
      ? "The first round has reported. You have been sent after one thing it left open; settle that and nothing else.\n"
      : "Work on your angle only; the others cover the rest.\n") +
    `Each search call takes up to ${depth.queriesPerSearch} differently worded queries, and you may make several calls in one step. ` +
    (second ? "Run two to four searches in all" : `Run ${depth.searchesPerAgent} searches in all`) +
    ": word them differently, aim them at different kinds of source (official and primary sources, data, studies, reputable reporting, critics), and follow up on what the first ones turn up. " +
    `Then ${second ? "read in full the one or two pages that settle it" : depth.readsPerAgent}. You have ${steps} steps, and the last is your write-up, so do not spend them one search at a time.\n` +
    "Weigh what you find: prefer primary and recent sources, note the date of anything that can go out of date, and when sources disagree say so and say which you trust more and why.\n" +
    `Your write-up goes to the lead, who has not seen your searches: ${second ? "150 to 250" : depth.findingsWords} words of markdown, dense with the concrete facts, numbers, dates, conditions and named examples you found, grouped under two or three short bold labels. ` +
    cite
  );
}

/**
 * A sub-agent that did not get to its write-up (it used its last step on a search, it ran out of
 * time, or the model stumbled) still found things. This writes its findings up from what its
 * searches and reads returned, in one short call with no tools.
 */
async function writeUpFromNotes(run: Run, agent: ResearchAgent, steps: number, user: AbortSignal | undefined): Promise<string> {
  const { ctx } = run;
  const notes = (run.notes.get(agent.id) ?? []).join("\n\n---\n\n");
  if (!notes.trim()) return "";
  const timeout = AbortSignal.timeout(25_000);
  const result = await generateText({
    model: ctx.worker.model,
    providerOptions: workerProviderOptions(ctx.worker.info),
    abortSignal: user ? AbortSignal.any([user, timeout]) : timeout,
    instructions: researcherInstructions(run, agent, steps),
    prompt:
      `The question the team is answering: ${run.question}\n\nYour angle: ${agent.title}` +
      (agent.why ? `\n\nWhy the lead sent you: ${agent.why}` : "") +
      "\n\nYour time for searching is up. Below is everything your searches and reads returned. Write up your findings from it now, as described; do not ask for more searches.\n\n" +
      notes.slice(-NOTES_CHARS),
  });
  ctx.meter.addWorker(ctx.worker.info.id, result.totalUsage);
  return result.text.trim();
}

async function runResearcher(run: Run, agent: ResearchAgent, steps: number, signal: AbortSignal, user: AbortSignal | undefined) {
  const { ctx, depth, changed } = run;
  agent.status = "working";
  changed();
  // Claude can be told "no more tools" for its last step and writes up with everything in view.
  // Gemini sometimes calls a tool anyway, which is an error, so there the search simply stops a
  // step early (or when the time comes) and the write-up is a call of its own, from the notes.
  const closes = ctx.worker.info.provider === "claude";
  let text = "";
  let problem: unknown;
  try {
    const result = await generateText({
      model: ctx.worker.model,
      providerOptions: workerProviderOptions(ctx.worker.info),
      tools: researcherTools(run, agent, signal),
      stopWhen: closes ? isStepCount(steps) : [isStepCount(Math.max(1, steps - 1)), () => Date.now() >= run.writeUpAt],
      prepareStep: ({ stepNumber }) => (closes && (stepNumber >= steps - 1 || Date.now() >= run.writeUpAt) ? { toolChoice: "none" as const } : undefined),
      abortSignal: signal,
      instructions: researcherInstructions(run, agent, steps),
      prompt:
        `The question the team is answering: ${run.question}\n\nYour angle: ${agent.title}` +
        (agent.why ? `\n\nWhy the lead sent you: ${agent.why}` : "") +
        (depth.level > 0 && ctx.country ? `\n\nThe person asking is in ${ctx.country}; prefer sources that apply there when the answer depends on the country.` : ""),
    });
    ctx.meter.addWorker(ctx.worker.info.id, result.totalUsage);
    // Text written before a last round of tool calls is a remark, not a write-up.
    const last = result.steps.at(-1);
    text = last && last.toolCalls.length > 0 ? "" : result.text.trim();
  } catch (err) {
    problem = err;
  }
  // Stopped by the user: nothing more is wanted. Otherwise, whatever it found is still worth writing up.
  if (!text && !user?.aborted) {
    try {
      text = await writeUpFromNotes(run, agent, steps, user);
    } catch (err) {
      problem ??= err;
    }
  }
  if (text) {
    agent.findings = text;
    agent.status = "done";
  } else {
    const kept = run.kept.get(agent.id)?.length ?? 0;
    agent.findings =
      signal.aborted || !problem
        ? `This angle ran out of time before it was written up${kept ? `; it had found ${kept} sources` : ""}.`
        : `This angle could not be completed: ${errorMessage(problem)}`;
    // The standard depth has always called an angle with nothing to say "done" with "No findings.": keep that when nothing went wrong.
    if (!problem && !signal.aborted) agent.findings = "No findings.";
    agent.status = problem || signal.aborted ? "failed" : "done";
  }
  changed();
}

/**
 * The second round. The lead reads what the first round found and names what is still open: a
 * contradiction, a claim that rests on a weak source, a figure that needs checking, a part of the
 * question nobody covered. Returns nothing when the findings already answer the question.
 */
async function planFollowUps(run: Run, mainModel: LanguageModel, agents: ResearchAgent[], signal: AbortSignal): Promise<Array<{ angle: string; why: string }>> {
  const { ctx, depth } = run;
  if (depth.followUps === 0) return [];
  try {
    const findings = agents.map((a) => `## ${a.title}\n${clip(a.findings, 2600)}`).join("\n\n");
    const result = await generateText({
      model: mainModel,
      providerOptions: extractionProviderOptions(ctx.model),
      abortSignal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
      output: Output.object({
        schema: z.object({
          followUps: z
            .array(
              z.object({
                angle: z.string().describe("A specific question one researcher can settle with a few searches."),
                why: z.string().describe("What is open and what would settle it, in one sentence."),
              }),
            )
            .max(depth.followUps),
        }),
      }),
      prompt:
        `You lead a research team. Today is ${ctx.today}. The question: ${run.question}\n\n` +
        `The first round of researchers has reported (below). Before the report is written you may send up to ${depth.followUps} more researchers. ` +
        "Name the follow-ups that would most improve the answer: findings that contradict each other, a claim that matters and rests on a weak or single source, a figure that needs checking against a primary source, " +
        "or an important part of the question that nobody covered. Each must be specific and researchable on its own, and must not repeat an angle already covered. " +
        "Return fewer, or none, if the findings already answer the question well.\n\n" +
        findings,
    });
    ctx.meter.addWorker(ctx.model.id, result.totalUsage);
    return (result.output?.followUps ?? []).filter((f) => f.angle.trim()).slice(0, depth.followUps);
  } catch {
    return [];
  }
}

/** What the lead is told about writing the report. The standard depth keeps the brief it has always had. */
function writerInstructions(ctx: ToolContext, depth: ResearchDepth): string {
  const links =
    "Keep every source link from the findings next to the fact it supports, as a markdown link with the site name as its text. Do not add facts or links that are not in the findings. " +
    "No preamble and no closing offer.";
  if (depth.level === 0) {
    return (
      `You are writing the final report for a research task. Today is ${ctx.today}.\n` +
      "Write for the person who asked: lead with the direct answer in two or three sentences, then the reasoning in short sections with plain headings, " +
      `a small table where a comparison is clearer as one, and finish with what is uncertain or depends on their circumstances. ${depth.reportWords} words. ` +
      links
    );
  }
  return (
    `You are writing the final report of a ${depth.label.toLowerCase()} research task, from the findings of a team of researchers. Today is ${ctx.today}.\n` +
    "Write for the person who asked, who wants the analysis and not just the conclusion:\n" +
    "- Open with the direct answer in a short paragraph: what you would tell them if you had one minute.\n" +
    "- Then the analysis in sections with plain headings (## for sections), each built on the evidence: the numbers, dates, conditions and named examples the researchers found, not generalities.\n" +
    "- Use a table wherever options, figures or conditions are compared side by side.\n" +
    "- Where sources disagree, say so, say which you trust more and why. Where the researchers' findings conflict with each other, resolve it or say it is unresolved.\n" +
    "- Separate what is established from what is likely and what is uncertain, and say what the answer depends on in the reader's own circumstances.\n" +
    "- Finish with what to do next, in a few concrete steps, when the question calls for a decision.\n" +
    `${depth.reportWords} words, and no longer: depth is not padding. Every paragraph should carry facts or judgement, and nothing should be said twice. ` +
    links
  );
}

/** Every source the team kept, one entry each, the best of each angle first, cut to what a message can carry. */
function allSources(run: Run, agents: ResearchAgent[]): { listed: Source[]; total: number } {
  const lists = agents.map((a) => run.kept.get(a.id) ?? []);
  const seen = new Set<string>();
  const all: Source[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) {
      const source = list[rank];
      if (!source || seen.has(pageKey(source.url))) continue;
      seen.add(pageKey(source.url));
      all.push(source);
    }
  }
  // Past the first few, an entry is its address and its title: the interface works out the rest.
  const listed = all.slice(0, LISTED_SOURCES).map((s, i) => (i < WITH_SNIPPET ? s : { url: s.url, title: s.title, domain: s.domain, publishedDate: s.publishedDate }));
  return { listed, total: all.length };
}

export function deepResearchTool(ctx: ToolContext, mainModel: LanguageModel) {
  const depth = ctx.depth;
  const deep = depth.level > 0;
  return tool({
    description:
      "Research a question in depth with a team of sub-agents working in parallel, then show a sourced report. " +
      "Use it when a good answer needs several independent angles: comparisons, 'should I', rules that depend on circumstances, anything with more than two moving parts. " +
      (deep
        ? `At the depth the user has chosen (${depth.label.toLowerCase()}) the team is larger, checks ${depth.level === 3 ? "hundreds of" : "many more"} pages${depth.followUps ? ", goes back for a second round on what the first left open," : ""} and writes a long, structured report. `
        : "") +
      `Takes ${depth.takes}. Not for simple lookups: use webSearch for those.`,
    inputSchema: z.object({
      question: z.string().describe("The full question, with the user's circumstances and constraints."),
      angles: z
        .array(z.string())
        .min(2)
        .max(depth.maxAngles)
        .describe(
          deep
            ? `${depth.minAngles} to ${depth.maxAngles} independent angles, one per sub-agent, each a specific sub-question that can be researched on its own. Cover the question from every side that matters: the facts, the numbers, the rules, the alternatives, the risks and the critics.`
            : "Two to four independent angles, one per sub-agent, each a specific sub-question that can be researched on its own.",
        ),
    }),
    async *execute({ question, angles }, { abortSignal }): AsyncGenerator<ResearchData> {
      const started = Date.now();
      const budgetMs = depth.budgetSeconds * 1000;
      const state: ResearchData = {
        kind: "research",
        question,
        status: "researching",
        agents: angles.map((title, i) => ({ id: `r${i + 1}`, title, status: "queued", steps: [], sources: [], ...(depth.followUps ? { round: 1 as const } : {}) })),
        sources: [],
        stage: "Researchers are searching in parallel",
        ...(deep ? { depth: depth.label } : {}),
        ...(depth.followUps ? { round: 1 as const } : {}),
      };

      // Sub-agents mutate `state`; `changed` wakes this generator so it can send a fresh snapshot.
      let wake: (() => void) | undefined;
      const changed = () => wake?.();
      const run: Run = { ctx, depth, question, checked: new Set(), kept: new Map(), given: new Map(), notes: new Map(), changed, writeUpAt: 0, signal: abortSignal ?? new AbortController().signal };
      /**
       * What the interface is sent. At the standard depth that is everything, every time, as it
       * always was. A large team changes many times a second and carries hundreds of sources, so
       * while it works the interface gets what it draws (the angles, their steps, a few sources
       * and the counts) and the findings and the full source list arrive once, at the end.
       */
      const snapshot = (whole = !deep): ResearchData => {
        if (deep) {
          state.pagesChecked = run.checked.size;
          if (state.status === "researching") state.sourceCount = state.agents.reduce((n, a) => n + (a.sourceCount ?? 0), 0);
        }
        if (whole) return structuredClone(state);
        return structuredClone({
          ...state,
          sources: [],
          agents: state.agents.map((a) => ({
            ...a,
            findings: undefined,
            // Once the report is being written the lanes are history: their last steps are enough.
            steps: state.status === "researching" ? a.steps : a.steps.slice(-3),
            stepCount: a.steps.length,
            sources: a.sources.slice(0, 3).map(({ url, title, domain }) => ({ url, title, domain })),
          })),
        });
      };
      /** How often the interface hears from a working team: a large one would otherwise send many updates a second. */
      const beat = deep ? 900 : 120;

      /** Send a round of sub-agents and report on them until they are all in, or until `until`, whichever is first. */
      async function* round(agents: ResearchAgent[], steps: number, until: number): AsyncGenerator<ResearchData> {
        run.writeUpAt = until - WRITE_UP_SECONDS * 1000;
        const cutOff = AbortSignal.timeout(Math.max(1000, until - Date.now()));
        const signal = abortSignal ? AbortSignal.any([abortSignal, cutOff]) : cutOff;
        let finished = false;
        const all = Promise.allSettled(agents.map((agent) => runResearcher(run, agent, steps, signal, abortSignal))).then(() => {
          finished = true;
          changed();
        });
        yield snapshot();
        while (!finished) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 2500);
          });
          // Batch bursts of changes into one update.
          await new Promise((r) => setTimeout(r, beat));
          if (!finished) yield snapshot();
        }
        await all;
      }

      // With a second round to come, the first gets the larger share of the time.
      const firstUntil = started + (depth.followUps ? budgetMs * 0.62 : budgetMs);
      yield* round(state.agents, depth.stepsPerAgent, firstUntil);

      // The second round: only if there is time for it to do something, and only what the lead asks for.
      const left = () => started + budgetMs - Date.now();
      if (depth.followUps && !abortSignal?.aborted && left() > 45_000 && state.agents.some((a) => a.status === "done")) {
        state.round = 2;
        state.stage = "Reading the findings for gaps and contradictions";
        yield snapshot();
        const followUps = await planFollowUps(run, mainModel, state.agents, run.signal);
        if (followUps.length && left() > 30_000 && !abortSignal?.aborted) {
          const first = state.agents.length;
          const second: ResearchAgent[] = followUps.map((f, i) => ({ id: `r${first + i + 1}`, title: f.angle.trim(), why: f.why.trim() || undefined, status: "queued", steps: [], sources: [], round: 2 }));
          state.agents.push(...second);
          state.stage = `Following up on ${second.length === 1 ? "one open point" : `${second.length} open points`}`;
          yield* round(second, FOLLOW_UP_STEPS, started + budgetMs);
        }
      }

      const sources = allSources(run, state.agents);
      state.sources = sources.listed;
      if (deep) state.sourceCount = sources.total;
      state.status = "writing";
      state.stage = "Writing the report";
      yield snapshot();

      try {
        const findings = state.agents.map((a) => `## ${a.title}${a.round === 2 ? " (follow-up)" : ""}\n${a.findings ?? "No findings."}`).join("\n\n");
        const writer = streamText({
          model: mainModel,
          // The report is where the thinking pays off, but not without limit: at the top of the dial it would think for minutes.
          providerOptions: agentProviderOptions(ctx.model, Math.min(ctx.effort, 3) as 1 | 2 | 3),
          abortSignal,
          instructions: writerInstructions(ctx, depth),
          prompt:
            `Question: ${question}\n\n` +
            (deep ? `The team checked ${run.checked.size} pages and kept ${sources.total} as sources.\n\n` : "") +
            `Findings from the researchers:\n\n${findings}`,
        });
        let text = "";
        let lastSent = 0;
        for await (const delta of writer.textStream) {
          text += delta;
          if (Date.now() - lastSent > (deep ? 450 : 150)) {
            lastSent = Date.now();
            state.report = text;
            yield snapshot();
          }
        }
        ctx.meter.addWorker(ctx.model.id, await writer.totalUsage);
        state.report = text.trim();
      } catch (err) {
        state.report = state.agents.map((a) => `### ${a.title}\n\n${a.findings ?? ""}`).join("\n\n");
        state.error = state.report ? undefined : errorMessage(err);
      }
      state.status = "done";
      state.stage = undefined;
      // The last value yielded is the tool's result: the whole of it, findings and sources included.
      yield snapshot(true);
    },
    toModelOutput: ({ output }) => {
      if (output.status !== "done") return { type: "text", value: "Research in progress." };
      // A deep run has already done the searching: the main agent adds its judgement, it does not start the research again.
      const scale =
        output.depth && output.sourceCount
          ? ` It rests on ${output.sourceCount} sources kept from ${output.pagesChecked ?? output.sourceCount} pages checked by ${output.agents.length} researchers${output.agents.some((a) => a.round === 2) ? " in two rounds" : ""}. ` +
            "That research is done: do not repeat its searches or re-read its sources. Search again only for a single point the report itself says is missing and that would change the answer."
          : "";
      return {
        type: "text",
        value:
          `The report below is now shown to the user in full, with its sources.${scale} Do not repeat or summarise it at length. ` +
          "Add one or two sentences with the single most useful takeaway or next step for this user.\n\n" +
          (output.report ?? ""),
      };
    },
  });
}
