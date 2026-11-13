import "server-only";

import { generateText, isStepCount, streamText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { exaContents, exaSearch } from "@/lib/exa/client";
import { domainOf, toSource, type ResearchAgent, type ResearchData, type Source } from "@/lib/widgets/types";
import { agentProviderOptions, workerProviderOptions } from "../providers";
import { clip, errorMessage, type ToolContext } from "./context";

/*
 * Deep research: the question is split into angles and one sub-agent per angle works in
 * parallel on the fast model, each with its own Exa search and read tools and its own
 * context. Their progress streams to the UI as it happens. The main model then writes the
 * report from their findings, and that streams in too.
 */

const MAX_SOURCES_PER_AGENT = 8;

function researcherTools(ctx: ToolContext, agent: ResearchAgent, changed: () => void, signal?: AbortSignal) {
  const addSources = (sources: Source[]) => {
    for (const s of sources) {
      if (agent.sources.length >= MAX_SOURCES_PER_AGENT) break;
      if (!agent.sources.some((x) => x.url === s.url)) agent.sources.push(s);
    }
  };
  return {
    search: tool({
      description: "Search the live web. Describe the pages you want in natural language. Returns pages with quoted passages.",
      inputSchema: z.object({
        query: z.string(),
        recency: z.enum(["week", "month", "year"]).optional().describe("Only pages published within this window."),
      }),
      execute: async ({ query, recency }) => {
        const step = { type: "search" as const, label: query, domains: [] as string[] };
        agent.steps.push(step);
        changed();
        try {
          const days = recency === "week" ? 7 : recency === "month" ? 31 : recency === "year" ? 366 : undefined;
          const res = await exaSearch(
            {
              query,
              numResults: 5,
              startPublishedDate: days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined,
              userLocation: ctx.country,
              contents: { highlights: { maxCharacters: 700 } },
            },
            { meter: ctx.meter, signal },
          );
          step.domains = [...new Set(res.results.map((r) => domainOf(r.url)))].slice(0, 5);
          addSources(res.results.slice(0, 4).map((r) => toSource({ ...r, snippet: clip(r.highlights?.[0], 240) })));
          changed();
          if (res.results.length === 0) return "No results. Try different wording.";
          return res.results
            .map((r, i) => `[${i + 1}] ${r.title ?? ""}\n${r.url}${r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : ""}\n${(r.highlights ?? []).slice(0, 2).map((h) => `> ${clip(h, 650)}`).join("\n")}`)
            .join("\n\n");
        } catch (err) {
          return `Search failed: ${errorMessage(err)}`;
        }
      },
    }),
    read: tool({
      description: "Read the full text of one page you found, when the quoted passages are not enough.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        const step = { type: "read" as const, label: domainOf(url), domains: [domainOf(url)] };
        agent.steps.push(step);
        changed();
        try {
          const res = await exaContents({ urls: [url], text: { maxCharacters: 6000 } }, { meter: ctx.meter, signal });
          const page = res.results[0];
          if (!page?.text) return "Could not read that page.";
          step.label = page.title ? clip(page.title, 70) : step.label;
          addSources([toSource(page)]);
          changed();
          return `# ${page.title ?? url}\n${url}\n\n${page.text}`;
        } catch (err) {
          return `Could not read the page: ${errorMessage(err)}`;
        }
      },
    }),
  };
}

async function runResearcher(ctx: ToolContext, question: string, agent: ResearchAgent, changed: () => void, signal?: AbortSignal) {
  agent.status = "working";
  changed();
  try {
    const result = await generateText({
      model: ctx.worker.model,
      providerOptions: workerProviderOptions(ctx.worker.info),
      tools: researcherTools(ctx, agent, changed, signal),
      stopWhen: isStepCount(6),
      abortSignal: signal,
      instructions:
        `You are one researcher in a small team. Today is ${ctx.today}.\n` +
        "Work on your angle only; the others cover the rest. Run two to four searches (several at once when they are independent), read a page only when the quoted passages leave out something you need, then stop and write up.\n" +
        "Your write-up goes to the lead, who has not seen your searches: 120 to 200 words of markdown with the concrete facts, numbers, dates and conditions you found. " +
        "Put a markdown link to the page after each fact, with the site name as the link text, like [kela.fi](https://www.kela.fi/...). Only link pages you actually got back from a search or read. " +
        "End with one line on what you could not confirm, if anything.",
      prompt: `The question the team is answering: ${question}\n\nYour angle: ${agent.title}`,
    });
    ctx.meter.addWorker(ctx.worker.info.id, result.totalUsage);
    agent.findings = result.text.trim() || "No findings.";
    agent.status = "done";
  } catch (err) {
    agent.findings = `This angle could not be completed: ${errorMessage(err)}`;
    agent.status = "failed";
  }
  changed();
}

export function deepResearchTool(ctx: ToolContext, mainModel: LanguageModel) {
  return tool({
    description:
      "Research a question in depth with a team of sub-agents working in parallel, then show a sourced report. " +
      "Use it when a good answer needs several independent angles: comparisons, 'should I', rules that depend on circumstances, anything with more than two moving parts. " +
      "Takes 30 to 60 seconds. Not for simple lookups: use webSearch for those.",
    inputSchema: z.object({
      question: z.string().describe("The full question, with the user's circumstances and constraints."),
      angles: z
        .array(z.string())
        .min(2)
        .max(4)
        .describe("Two to four independent angles, one per sub-agent, each a specific sub-question that can be researched on its own."),
    }),
    async *execute({ question, angles }, { abortSignal }): AsyncGenerator<ResearchData> {
      const state: ResearchData = {
        kind: "research",
        question,
        status: "researching",
        agents: angles.map((title, i) => ({ id: `r${i + 1}`, title, status: "queued", steps: [], sources: [] })),
        sources: [],
        stage: "Researchers are searching in parallel",
      };
      const snapshot = (): ResearchData => structuredClone(state);

      // Sub-agents mutate `state`; `changed` wakes this generator so it can send a fresh snapshot.
      let wake: (() => void) | undefined;
      const changed = () => wake?.();
      let finished = false;
      const all = Promise.allSettled(state.agents.map((agent) => runResearcher(ctx, question, agent, changed, abortSignal))).then(() => {
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
        await new Promise((r) => setTimeout(r, 120));
        if (!finished) yield snapshot();
      }
      await all;

      const seen = new Set<string>();
      state.sources = state.agents.flatMap((a) => a.sources).filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
      state.status = "writing";
      state.stage = "Writing the report";
      yield snapshot();

      try {
        const findings = state.agents.map((a) => `## ${a.title}\n${a.findings ?? "No findings."}`).join("\n\n");
        const writer = streamText({
          model: mainModel,
          providerOptions: agentProviderOptions(ctx.model),
          abortSignal,
          instructions:
            `You are writing the final report for a research task. Today is ${ctx.today}.\n` +
            "Write for the person who asked: lead with the direct answer in two or three sentences, then the reasoning in short sections with plain headings, " +
            "a small table where a comparison is clearer as one, and finish with what is uncertain or depends on their circumstances. 200 to 350 words. " +
            "Keep every source link from the findings next to the fact it supports, as a markdown link with the site name as its text. Do not add facts or links that are not in the findings. " +
            "No preamble and no closing offer.",
          prompt: `Question: ${question}\n\nFindings from the researchers:\n\n${findings}`,
        });
        let text = "";
        let lastSent = 0;
        for await (const delta of writer.textStream) {
          text += delta;
          if (Date.now() - lastSent > 150) {
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
      // The last value yielded is the tool's result.
      yield snapshot();
    },
    toModelOutput: ({ output }) => {
      if (output.status !== "done") return { type: "text", value: "Research in progress." };
      return {
        type: "text",
        value:
          "The report below is now shown to the user in full, with its sources. Do not repeat or summarise it at length. " +
          "Add one or two sentences with the single most useful takeaway or next step for this user.\n\n" +
          (output.report ?? ""),
      };
    },
  });
}
