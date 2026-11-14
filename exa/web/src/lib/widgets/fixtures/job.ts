import type { JobItem } from "@/lib/jobs/types";
import type { JobCardData } from "@/lib/widgets/types";

const DAY = 86_400_000;
/** A fixed moment, so the fixture is the same on every load: Monday 16 November 2026, 08:00 in Helsinki. */
const MONDAY = Date.UTC(2026, 10, 16, 6, 0);

const news: JobItem = {
  id: "0b7c1f0e-5a51-4c0e-9a39-6f3f1a2b4c5d",
  title: "Morning AI news",
  description: "The five AI stories worth knowing about each weekday morning, with one line on why each matters.",
  prompt: "Search for AI news from the last 24 hours. Pick the five stories that matter most to someone who builds with AI: model releases, pricing changes, research with results, regulation. Skip opinion pieces and funding rounds under 100 million. For each: a headline, one line on why it matters, and the source. If fewer than five are worth it, send fewer.",
  schedule: { kind: "cron", cron: "0 8 * * 1-5" },
  scheduleText: "Every weekday at 08:00",
  timeZone: "Europe/Helsinki",
  status: "active",
  mode: "fast",
  effort: 1,
  nextRunAt: MONDAY,
  runCount: 0,
  createdAt: MONDAY - 2 * DAY,
  updatedAt: MONDAY - 2 * DAY,
  running: false,
};

const price: JobItem = {
  ...news,
  id: "7e0f3d2a-9c41-4b77-8d15-2b6a9f0c1e33",
  title: "RTX 5090 price watch",
  description: "Tell me when an RTX 5090 drops under 2,000 euros at a Finnish shop.",
  prompt: "Check the price of the RTX 5090 at Finnish shops.",
  schedule: { kind: "every", every: 6, unit: "hours" },
  scheduleText: "Every 6 hours",
  untilAt: MONDAY + 5 * DAY,
  status: "paused",
  nextRunAt: MONDAY + 3_600_000,
  runCount: 9,
  lastRunAt: MONDAY - 5 * 3_600_000,
};

export const jobCreatedFixture: JobCardData = { kind: "job", action: "created", job: news, nextRuns: [MONDAY, MONDAY + DAY, MONDAY + 2 * DAY], sources: [] };
export const jobLoadingFixture: JobCardData = { kind: "job", action: "created", draft: { title: "Morning AI news", scheduleText: "Every weekday at 08:00" }, stage: "Setting up the job", sources: [] };
export const jobListFixture: JobCardData = { kind: "job", action: "list", jobs: [news, price], sources: [] };
export const jobDeletedFixture: JobCardData = { kind: "job", action: "deleted", job: price, sources: [] };
export const jobRefusedFixture: JobCardData = { kind: "job", action: "refused", draft: { title: "Every-minute check" }, error: "A job can run at most every 5 minutes.", sources: [] };
