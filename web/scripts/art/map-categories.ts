/**
 * Which generated illustration a product tile shows, by the partner's category code. Reads the category labels
 * already in the repo (`src/server/catalog-categories.json`) and writes `src/app/_ui/art-map.json`:
 * `{ "<category code>": "<tile key>" }`. Categories with no fitting picture are left out: their tiles keep the
 * drawn pack. Re-run after adding a tile:  pnpm tsx scripts/art/map-categories.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const data = JSON.parse(readFileSync(path.join(root, "src/server/catalog-categories.json"), "utf8")) as {
  categories: Record<string, { label: string; count: number; temperature: string | null }>;
};

type Rule = [RegExp, string];

/** Tried in order within a department; the first match wins. */
const BY_DEPT: Record<string, Rule[]> = {
  "10": [
    [/yoghurt|quark|sour cream|curd|profeel|protein|rahka|viili/, "tile-yoghurt-tub"],
    [/plant cream|cream/, "tile-cream-carton"],
    [/condensed/, "tile-canned"],
    [/powder/, "tile-flour-sack"],
    [/cheese|feta|halloumi|mozzarella|slice|grated|cube|vegan/, "tile-cheese-block"],
    [/oil/, "tile-oil"],
    [/butter|margarine|spread|fat/, "tile-butter"],
    [/bread|toast|rye|roll|bun/, "tile-bread"],
    [/egg/, "tile-eggs"],
    [/milk|drink|fermented/, "tile-milk-carton"],
  ],
  "11": [[/cake|pastry|pie|bun|doughnut|muffin|sweet|cookie/, "tile-pastry"], [/.*/, "tile-bread"]],
  "17": [
    [/sausage|ham|salami|frankfurter|strip|cold|bacon|meat cut/, "tile-cold-cuts"],
    [/chicken|turkey/, "tile-poultry"],
    [/pork|beef|meat|steak/, "tile-meat"],
    [/fish|salmon|herring|shrimp/, "tile-fish"],
    [/egg/, "tile-eggs"],
    [/berry|fruit|apple|grape|melon|citrus|banana|orange|lemon|lime/, "tile-berry-tray"],
    [/cucumber|cabbage|carrot|tomato|lettuce|iceberg|salad|potato|onion|chili|pepper|cress|mimi|bunch|costa|root|herb|vegetable|mushroom|cube|leek|asparagu|arugula|peeled|rucola|spinach/, "tile-vegetables"],
    [/casserole|ready|meal|soup|hummu|fava|piping|salaattimestari|pasta|pizza|bread/, "tile-ready-meal"],
  ],
  "18": [
    [/chicken|turkey|poultry|duck/, "tile-poultry"],
    [/fish|salmon|trout|herring|shrimp|seafood|tuna|roe/, "tile-fish"],
    [/sausage|ham|salami/, "tile-cold-cuts"],
    [/.*/, "tile-meat"],
  ],
  "20": [[/.*/, "tile-cookware"]],
  "21": [
    [/juice|drink|concentrate|soup and berry|nectar|smoothie|apple and fruit/, "tile-drinks"],
    [/olive|pickled|sundried|canned|corn|bean|tomato|cucumber|pineapple|peach|fruit cocktail|brine|mushroom/, "tile-canned"],
    [/flour|starch|baking|yeast|sugar/, "tile-flour-sack"],
    [/penne|pasta|noodle|rice|grain|flake|instant|muesli|granola|lentil|porridge|couscous|bulgur|macaroni|spaghetti|semolina|barley|oat/, "tile-grain-pasta"],
    [/biscuit|wafer|cracker|cake|bar and snack|cookie/, "tile-pastry"],
    [/crispbread|tortilla|bread|koulunakki/, "tile-bread"],
    [/sauce|bouillon|fond|base|stock|mayonnaise|dressing|ketchup|salsa|tetra|filling|marmalade|puree|jam|mousse|kissel|topping/, "tile-sauce-stock"],
    [/pepper|spice|salt|seasoning|herb/, "tile-spices"],
    [/chocolate|cocoa/, "tile-chocolate"],
    [/chip|crisp|popcorn/, "tile-sweets"],
    [/oil/, "tile-oil"],
  ],
  "22": [
    [/coffee|tea|filter|espresso|cocoa drink|loose/, "tile-coffee-tea"],
    [/chocolate|cocoa/, "tile-chocolate"],
    [/drink|lemonade|carbonated|mineral|tonic|water|soda|juice|energy|syrup/, "tile-drinks"],
    [/vinegar|mustard|paste|curry|sauce|ketchup|mayonnaise|dressing/, "tile-sauce-stock"],
    [/sugar|granulated|sweetener|powder|baking/, "tile-flour-sack"],
    [/pepper|spice|salt|seasoning|herb|fine and sea|cinnamon|vanilla/, "tile-spices"],
    [/oil/, "tile-oil"],
  ],
  "30": [[/.*/, "tile-cleaning"]],
  "32": [[/.*/, "tile-cleaning"]],
  "41": [
    [/ice|scoop|sorbet|cone|popsicle/, "tile-ice-cream"],
    [/chocolate|dessert/, "tile-ice-cream"],
    [/cake|pastry|pie|pancake|doughnut|muffin|croissant|donut|waffle|dough|para/, "tile-pastry"],
    [/bread|bun|roll|baguette|loaf/, "tile-bread"],
    [/chicken|turkey/, "tile-poultry"],
    [/fish|fillet and trout|salmon|shrimp|seafood|findu|asc/, "tile-fish"],
    [/meatball|patty|burger|vegan|casserole|ready|pizza|soup|lasagne|topfood/, "tile-ready-meal"],
    [/meat|pork|beef|reindeer|lamb|steak/, "tile-meat"],
    [/currant|berry|fruit|strawberr|raspberr|blueberr|lingonberr/, "tile-berry-tray"],
    [/vegetable|green|pea|fry|potato|puree|corn|spinach|broccoli/, "tile-frozen-veg"],
    [/cheese/, "tile-cheese-block"],
  ],
  "52": [[/chocolate|praline|cocoa|tablet/, "tile-chocolate"], [/.*/, "tile-sweets"]],
  "63": [[/napkin|tissue|towel|toilet|roll|paper|dispenser|film|filter|tablecover/, "tile-disposables"], [/.*/, "tile-cleaning"]],
  "64": [[/candle|lantern|lamp|decoration/, ""], [/.*/, "tile-disposables"]],
  "84": [[/.*/, "tile-drinks"]],
  "85": [[/.*/, "tile-drinks"]],
};

const map: Record<string, string> = {};
const counts: Record<string, number> = {};
let unmapped = 0;
for (const [code, c] of Object.entries(data.categories)) {
  const rules = BY_DEPT[code.slice(0, 2)] ?? [];
  const label = c.label.toLowerCase();
  const hit = rules.find(([re]) => re.test(label));
  if (hit && hit[1]) {
    map[code] = hit[1];
    counts[hit[1]] = (counts[hit[1]] ?? 0) + c.count;
  } else unmapped += c.count;
}
writeFileSync(path.join(root, "src/app/_ui/art-map.json"), `${JSON.stringify(map, null, 0).replaceAll(",", ",\n ")}\n`);
const total = Object.values(data.categories).reduce((s, c) => s + c.count, 0);
console.log(`${Object.keys(map).length} categories mapped; products with a picture: ${total - unmapped} of ${total}`);
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join("\n"));
