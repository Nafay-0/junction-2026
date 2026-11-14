import { toSource, type SiftData, type SiftItem, type SiftVerdict } from "@/lib/widgets/types";

type Cell = ["yes" | "no" | "unknown", number];

const page = (title: string, url: string, cells: Cell[], publishedDate?: string): SiftItem => ({
  ...toSource({ url, title, publishedDate }),
  verdicts: cells.map(([answer, confidence]): SiftVerdict => ({ answer, confidence })),
});

const wishes: SiftData["wishes"] = [
  { label: "Under 30 min", test: "the recipe takes 30 minutes or less from start to finish" },
  { label: "No meat or fish", test: "the recipe contains no meat and no fish" },
  { label: "No nuts", test: "the recipe contains no nuts or peanuts" },
  { label: "One pan", test: "the recipe is cooked in a single pan or pot" },
];

// A real run: 40 recipe pages from Exa, checked by the decision model on 14 November 2026.
const items: SiftItem[] = [
  page("20-Minute Chickpea Soup", "https://www.eatingwell.com/20-minute-chickpea-soup-11816278", [["yes", 0.99], ["yes", 0.91], ["yes", 0.97], ["yes", 0.99]], "2026-10-02"),
  page("Marry Me Chickpeas (Easy 20 Minute Dinner) - Cooking With Ayeh", "https://cookingwithayeh.com/marry-me-chickpeas/", [["yes", 0.99], ["yes", 0.96], ["yes", 0.61], ["yes", 1]]),
  page("Crispy Chickpea & Kale Skillet with Warm Tahini Drizzle | Cache & Cook", "https://cacheandcook.com/what-to-make-with/30-minute-vegetarian-dinners/crispy-chickpea-kale-skillet-with-warm-tahini-drizzle", [["yes", 0.95], ["yes", 0.91], ["yes", 0.7], ["yes", 0.97]]),
  page("Garlic Broccoli Stir Fry With Chickpeas | Flavorful Recipe - Elavegan", "https://elavegan.com/garlic-broccoli-stir-fry/", [["yes", 0.97], ["yes", 0.97], ["yes", 0.52], ["yes", 0.96]]),
  page("Skillet Chickpeas With Spinach And Tomatoes", "https://food52.com/recipes/87169-skillet-chickpeas-with-spinach-and-tomatoes", [["yes", 0.91], ["yes", 0.9], ["yes", 0.67], ["yes", 0.87]]),
  page("Chickpea Curry | America's Test Kitchen", "https://www.americastestkitchen.com/recipes/chickpea-curry", [["yes", 0.84], ["yes", 0.92], ["yes", 0.64], ["yes", 0.93]]),
  page("Turmeric Coconut Cauliflower Curry Recipe | Feasting At Home", "https://www.feastingathome.com/cauliflower-curry/", [["yes", 0.97], ["yes", 0.96], ["unknown", 0.52], ["yes", 0.99]]),
  page("Creamy Lemon Chickpea Pasta Recipe | The Kitchn", "https://www.thekitchn.com/creamy-lemon-chickpea-pasta-recipe-23705130", [["no", 0.82], ["yes", 0.93], ["yes", 0.59], ["yes", 0.71]]),
  page("Chickpea Shakshuka with Feta", "https://www.bonappetit.com/recipe/chickpea-shakshuka", [["yes", 0.88], ["yes", 0.94], ["yes", 0.83], ["no", 0.66]]),
  page("Golden Rice With Za'atar-Roasted Chickpeas & Broccoli", "https://plantbasednews.org/veganrecipes/dinner/golden-rice/", [["no", 0.98], ["yes", 0.89], ["no", 0.51], ["no", 0.86]], "2026-11-09"),
  page("Chorizo and chickpeas", "https://food52.com/recipes/35888-chorizo-and-chickpeas", [["unknown", 0.57], ["no", 0.99], ["unknown", 0.64], ["yes", 0.87]]),
];

export const siftFixture: SiftData = {
  kind: "sift",
  title: "Chickpea dinners that fit",
  what: "a recipe",
  wishes,
  items,
  checked: 40,
  skipped: 3,
  judgements: 200,
  judgedMs: 713,
  sources: items,
  exaCostUsd: 0.037,
};

export const siftLoadingFixture: SiftData = {
  kind: "sift",
  title: "Chickpea dinners that fit",
  what: "a recipe",
  wishes,
  items: items.slice(0, 5).map((item) => ({ ...item, verdicts: undefined })),
  checked: 40,
  sources: [],
  stage: "Checking 40 pages against 4 wishes",
};
