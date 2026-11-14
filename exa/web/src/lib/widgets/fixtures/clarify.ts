import type { ClarifyAnswer, ClarifyInput } from "@/lib/widgets/types";

export const clarifyFixture: ClarifyInput = {
  intro: "Before I look at trains and places to stay, two or three details will help.",
  questions: [
    {
      id: "destination",
      question: "Where would you like to go?",
      type: "single",
      options: [
        { label: "Tallinn", description: "2 h ferry, old town and food halls" },
        { label: "Turku", description: "2 h train, archipelago and cafés" },
        { label: "Nuuksio", description: "45 min bus, hiking and a cabin" },
      ],
    },
    {
      id: "interests",
      question: "What do you want to do there?",
      type: "multi",
      options: [
        { label: "Food" },
        { label: "Museums" },
        { label: "Nature" },
        { label: "Sauna" },
        { label: "Nightlife" },
      ],
    },
    {
      id: "budget",
      question: "What is your budget for two people?",
      type: "text",
      placeholder: "For example, €400 in total",
    },
  ],
};

export const clarifyLoadingFixture: ClarifyInput = {
  questions: [
    {
      id: "destination",
      question: "Where would you like to go?",
      type: "single",
      options: [{ label: "Tallinn" }],
    },
  ],
};

export const clarifyAnswerFixture: ClarifyAnswer = {
  answers: {
    destination: "Tallinn",
    interests: ["Food", "Sauna"],
    budget: "About €400 in total",
  },
};
