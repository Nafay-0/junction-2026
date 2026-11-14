import type { IndexedProduct } from "@/core/catalog/partner";
import { fold, tokenize } from "@/core/catalog/search";

/**
 * The OpenSearch index for product search (dock-search, free-4-20 plan: one node, 20 shards per node).
 *
 * Why OpenSearch and not PostgreSQL full text: three languages per product with real stemmers (`finnish`,
 * `swedish`, `english` analyzers), BM25 ranking across them, fuzzy matching for typos, n-grams for Finnish
 * compounds ("maito" inside "kevytmaitojuoma"), and filters on claims and allergen evidence in the same query.
 *
 * Versioned index (`dock-products-v<N>`) behind the alias `dock-products`: a rebuild fills the next version,
 * then swaps the alias in one call, so searches never see a half-built index.
 */
export const SEARCH_ALIAS = "dock-products";
export const INDEX_PREFIX = `${SEARCH_ALIAS}-v`;

/**
 * Kinds of product that share words with others ("milk" in coffee milk, chocolate milk, sour milk). The same
 * idea as the in-process search (core/catalog/search.ts keeps its list private, so it is repeated here): a
 * product of a kind the query did not ask for is ranked down, not removed.
 */
export const FACETS: { id: string; words: string[] }[] = [
  { id: "coffee", words: ["coffee", "kahvi", "kaffe", "latte", "cafe", "cappuccino", "espresso", "mokka", "mocha", "barista"] },
  { id: "chocolate", words: ["chocolate", "choco", "suklaa", "choklad", "cocoa", "kaakao", "kakao"] },
  { id: "cream", words: ["cream", "kerma", "gradde", "creme", "fraiche"] },
  { id: "yoghurt", words: ["yoghurt", "yogurt", "jogurt", "soygurt", "skyr"] },
  { id: "fermented", words: ["sour", "piima", "filmjolk", "surmjolk", "kefir", "viili", "fermented", "acidophilus", "acidofilus", "gefilus", "bifidus", "kulturmjolk"] },
  { id: "quark", words: ["quark", "rahka", "kvarg"] },
  { id: "powder", words: ["powder", "jauhe", "pulver"] },
  { id: "coconut", words: ["coconut", "kookos", "kokos"] },
  { id: "peanut", words: ["peanut", "maapahkina", "jordnot"] },
  { id: "condensed", words: ["condensed", "kondensoitu", "kondenserad", "tiiviste"] },
  { id: "portion", words: ["portion", "annos", "sachet", "portioner"] },
  { id: "shake", words: ["shake", "pirtelo", "smoothie"] },
  { id: "dessert", words: ["jaatelo", "pudding", "vanukas", "dessert", "jalkiruoka", "porridge", "puuro", "glass"] },
  { id: "cheese", words: ["cheese", "juusto", "ost"] },
  { id: "butter", words: ["butter", "smor", "voi"] },
  { id: "flavoured", words: ["vanilla", "vanilja", "vanilj", "strawberry", "mansikka", "jordgubb", "banana", "banaani", "raspberry", "vadelma", "hallon", "blueberry", "mustikka", "caramel", "karamelli", "toffee"] },
  { id: "snack", words: ["snack", "valipala", "mellanmal"] },
  { id: "sauce_soup", words: ["soup", "keitto", "soppa", "sauce", "kastike", "dressing"] },
];

function hasWord(tokens: string[], text: string, word: string): boolean {
  return word.length <= 3 ? tokens.includes(word) : text.includes(word);
}

/** Facet ids present in a piece of text (folded). */
export function facetsOf(text: string): string[] {
  const folded = ` ${fold(text)} `;
  const tokens = tokenize(text);
  return FACETS.filter((f) => f.words.some((w) => hasWord(tokens, folded, w))).map((f) => f.id);
}

export const indexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0, // one node on the free plan: a replica could never be assigned (yellow forever)
  refresh_interval: "1s",
  max_ngram_diff: 1,
  analysis: {
    filter: {
      fi_stem: { type: "stemmer", language: "finnish" },
      sv_stem: { type: "stemmer", language: "swedish" },
      en_stem: { type: "stemmer", language: "english" },
    },
    tokenizer: {
      // A tokenizer, not a token filter: each gram gets its own position, so "75% of the grams" means what it says.
      dock_gram: { type: "ngram", min_gram: 4, max_gram: 5, token_chars: ["letter", "digit"] },
    },
    analyzer: {
      // Lower case, accents and Nordic letters folded (ä -> a), like fold() in the in-process search.
      dock_folded: { type: "custom", tokenizer: "standard", filter: ["lowercase", "asciifolding"] },
      // Parts of words, for Finnish and Swedish compounds: "maito" matches "kevytmaitojuoma".
      dock_gram: { type: "custom", tokenizer: "dock_gram", filter: ["lowercase", "asciifolding"] },
      // Stemmers over folded text: queries arrive folded (parseQueryText), so "leipa" still meets "leipää".
      dock_fi: { type: "custom", tokenizer: "standard", filter: ["lowercase", "asciifolding", "fi_stem"] },
      dock_sv: { type: "custom", tokenizer: "standard", filter: ["lowercase", "asciifolding", "sv_stem"] },
      dock_en: { type: "custom", tokenizer: "standard", filter: ["lowercase", "asciifolding", "en_stem"] },
    },
  },
} as const;

/** Built-in language analyzer on the name as written, a folded stemmed subfield, and a folded exact subfield. */
const nameField = (language: string, stem: string) => ({
  type: "text",
  analyzer: language,
  copy_to: "all",
  fields: { folded: { type: "text", analyzer: "dock_folded" }, stem: { type: "text", analyzer: stem } },
});

export const indexMappings = {
  dynamic: "strict",
  properties: {
    id: { type: "keyword" },
    names: {
      properties: {
        fi: nameField("finnish", "dock_fi"),
        sv: nameField("swedish", "dock_sv"),
        en: nameField("english", "dock_en"),
      },
    },
    brand: { type: "text", analyzer: "dock_folded", copy_to: "all", fields: { keyword: { type: "keyword" } } },
    /** All names and the brand, folded, plus n-grams for compounds and partial words. */
    all: { type: "text", analyzer: "dock_folded", fields: { gram: { type: "text", analyzer: "dock_gram" } } },
    claims: { type: "keyword" },
    allergens: {
      properties: {
        /** False: the manufacturer sent no allergen data; every allergen is then unknown (neither contains nor free). */
        declared: { type: "boolean" },
        contains: { type: "keyword" },
        may_contain: { type: "keyword" },
        free_from: { type: "keyword" },
      },
    },
    categoryCode: { type: "keyword" },
    salesUnit: { type: "keyword" },
    pack: {
      properties: {
        L: { type: "float" }, // per sales unit
        kg: { type: "float" },
        base_L: { type: "float" }, // per base unit
        base_kg: { type: "float" },
        certain: { type: "boolean" },
        certainMeasures: { type: "keyword" },
      },
    },
    facets: { type: "keyword" },
    nameLength: { type: "integer" },
  },
} as const;

export type ProductDoc = {
  id: string;
  names: { fi?: string; sv?: string; en?: string };
  brand?: string;
  claims: string[];
  allergens: { declared: boolean; contains: string[]; may_contain: string[]; free_from: string[] };
  categoryCode: string;
  salesUnit: string;
  pack: { L?: number; kg?: number; base_L?: number; base_kg?: number; certain: boolean; certainMeasures: string[] };
  facets: string[];
  nameLength: number;
};

/** One product as an OpenSearch document. Only what search and filters need; the full product stays in the local index. */
export function toDoc(p: IndexedProduct): ProductDoc {
  const names = [p.names.en, p.names.fi, p.names.sv].filter(Boolean).join(" ");
  return {
    id: p.id,
    names: { fi: p.names.fi, sv: p.names.sv, en: p.names.en },
    brand: p.brand ?? undefined,
    claims: p.claims,
    allergens: { declared: p.allergens.declared, contains: p.allergens.contains, may_contain: p.allergens.mayContain, free_from: p.allergens.freeFrom },
    categoryCode: p.categoryCode,
    salesUnit: p.salesUnit,
    pack: {
      L: p.pack.perSalesUnit.L,
      kg: p.pack.perSalesUnit.kg,
      base_L: p.pack.perBaseUnit.L,
      base_kg: p.pack.perBaseUnit.kg,
      certain: p.pack.certain,
      certainMeasures: p.pack.certainMeasures,
    },
    facets: facetsOf(`${names} ${p.brand ?? ""}`),
    nameLength: (p.names.en ?? p.names.fi ?? "").length,
  };
}
