import type { PlanData } from "@/lib/widgets/types";

export const planFixture: PlanData = {
  kind: "plan",
  steps: [
    { title: "Find flights from Helsinki to Lisbon", status: "done" },
    { title: "Check hotels near Alfama", status: "done" },
    { title: "Comparing fares and baggage rules", status: "active" },
    { title: "Check the weather for the weekend", status: "pending" },
    { title: "Put together the itinerary", status: "pending" },
  ],
};

export const planDoneFixture: PlanData = {
  kind: "plan",
  steps: planFixture.steps.map((s) => ({ ...s, status: "done" })),
};

export const planLoadingFixture: PlanData = {
  kind: "plan",
  steps: [],
};
