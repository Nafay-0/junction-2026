/**
 * The search evaluation's request set: what cooks type into the store's search box or say to the agent, in English,
 * Finnish and Swedish, each with the product kinds that count as right.
 *
 * Expected answers are knowledge-map kind slugs (`slug`, never a category code), so a case names a kind of thing
 * ("barista_oat_drink"), not a product. A product is right when its kind's slug is listed in `right` and it meets
 * the case's constraints (claims, allergens, brand, pack, product id) by the partner's data. `check-cases.ts`
 * verifies every case against the index and the map: run `pnpm tsx eval/search/check-cases.ts`.
 *
 * The words are the cooks' own; no product name is copied from the partner's data.
 */

export type SearchCase = {
  id: string; // "en-plain-01", unique
  lang: "en" | "fi" | "sv" | "mixed";
  /** The user's three kinds of request. */
  kind: "exact" | "recipe" | "describe";
  tags: ("plain" | "variant" | "use" | "dish" | "ingredient" | "typo" | "mixed_language" | "not_sold" | "dietary" | "standin_only" | "brand" | "pack" | "code" | "inflected")[];
  /** The words as a cook would type or say them into the store's search or the agent. */
  text: string;
  /** Knowledge-map kind SLUGS (the `slug`, never the category code) that count as right. Empty for not_sold and standin_only. */
  right: string[];
  /** Kind slugs acceptable only as a stand-in (a different kind that could do the job). Required for standin_only; optional elsewhere. */
  standins?: string[];
  /** Constraints a right product must meet from the partner data (claims as Dock slugs: lactose_free, gluten_free, vegan, organic, low_lactose...). */
  claims?: string[];
  /** Allergens a right product must not contain or may-contain (milk, nuts, peanuts, gluten, eggs...). */
  allergenFree?: string[];
  /** Folded (lower-case, no accents) substring a right product's brand must contain. */
  brand?: string;
  /** Pack content a right product's sales unit must hold (perSalesUnit), e.g. { amount: 10, unit: "L" }. */
  pack?: { amount: number; unit: "L" | "kg" };
  /** Products that are right although the knowledge map files them under a broader kind (checked by hand). */
  alsoRight?: string[];
  /** For product-code requests: the one right product id. */
  productId?: string;
  /** Kept unseen while the parent tunes. Exactly 30 cases, spread over kinds, languages and tags. */
  holdout?: boolean;
  note?: string;
};

// ---------- kinds that several cases share ----------

const MILK = ["skimmed_milk", "low_fat_milk", "semi_skimmed_milk", "whole_milk"];
const WHIPPING = ["whipping_cream", "high_fat_whipping_cream"];
const COOKING_CREAM = ["cooking_cream_10", "cooking_cream_15", "low_fat_cream"];
const CREAM = [...WHIPPING, ...COOKING_CREAM, "coffee_cream"];
const HARD_ITALIAN = ["hard_grating_cheese", "grated_hard_italian_cheese", "hard_cheese_flakes"];
const BACON = ["streaky_bacon_slices", "back_bacon_slices", "bacon_cubes_raw", "cooked_bacon_slices", "cooked_bacon_pieces", "bacon", "bacon_and_pork_cubes"];
const CARBONARA_PORK = [...BACON, "pancetta", "pancetta_bacon", "guanciale"];
const DISHWASHER = ["machine_dishwashing_powder", "machine_dishwashing_liquid", "machine_dishwashing_solid", "dishwasher_all_in_one_tablets", "dishwashing_detergent_rinse_aid_combo", "dishwasher_rinse_aid", "rinse_aid", "dishwasher_cleaner", "dishwasher_salt"];
const DISHWASHER_DETERGENT = ["machine_dishwashing_powder", "machine_dishwashing_liquid", "machine_dishwashing_solid", "dishwasher_all_in_one_tablets", "dishwashing_detergent_rinse_aid_combo"];
const BEEF_MINCE = ["beef_mince", "lean_beef_mince", "medium_beef_mince", "beef_burger_mince", "raw_minced_beef", "beef_pork_mince"];
/** The "beetroot" kind is left out: it mixes frozen cuts with beetroot nuggets. */
const FRESH_BEETROOT = ["red_beetroot", "peeled_beetroot", "chioggia_beetroot", "yellow_beetroot", "beetroot_dice", "beetroot_wedges"];
const PICKLED_BEETROOT = ["pickled_grated_beetroot", "pickled_beetroot_cubes", "pickled_shredded_beetroot", "pickled_sliced_beetroot", "pickled_beetroot_strips", "pickled_whole_beetroot"];
const POTATOES = ["baking_potatoes", "early_potatoes", "small_potatoes", "waxy_potatoes", "floury_potatoes", "all_purpose_potatoes", "specialty_fingerling_potatoes", "peeled_potatoes_for_mashing", "peeled_portion_potatoes", "peeled_whole_potatoes", "peeled_whole_potato", "whole_small_potatoes", "potato_cubes", "diced_potato"];
const FRIES = ["straight_french_fries", "coated_french_fries", "skin_on_fries", "crinkle_fries", "seasoned_fries", "julienne_potatoes", "specialty_fries", "twister_fries"];
const RAW_SALMON = ["salmon_fillet", "salmon_portions", "salmon_pre_cut", "salmon_loin", "salmon_whole", "salmonid_fillet_portions", "salmonid_cubes_strips_minced", "salmon_belly"];
const SMOKED_SALMON = ["smoked_salmon_slices", "cold_smoked_salmon", "smoked_salmon_fillet", "salmonid_smoked_cured"];
const TORTILLAS = ["tortillas_and_corn_chips", "small_corn_tortillas", "small_wheat_tortillas", "medium_wheat_tortillas", "medium_corn_wheat_tortillas", "large_wheat_tortillas", "extra_large_wheat_tortillas", "tortilla_wrap"];
const PIZZA_CHEESE = ["mixed_grated_cheese", "pizza_cheese", "grated_mozzarella", "mozzarella_block", "melting_cheese", "frozen_mozzarella_julienne", "sliced_mozzarella"];
const BURGER_BUNS = ["standard_hamburger_buns", "brioche_burger_buns", "potato_burger_buns", "pretzel_burger_buns", "specialty_burger_buns", "sesame_burger_bun", "plain_burger_bun", "hamburger_bun", "gluten_free_burger_buns"];
const GLOVES = ["powder_free_nitrile_disposable_gloves", "powdered_nitrile_disposable_gloves", "powdered_vinyl_disposable_gloves", "disposable_ldpe_gloves"];
const REFUSE_BAGS = ["small_refuse_bags", "medium_refuse_bags", "large_refuse_bags", "extra_large_refuse_bags"];
const NAPKINS = ["single_ply_napkin", "two_ply_napkin", "three_ply_napkin", "premium_nonwoven_napkin", "cocktail_napkin", "one_ply_tissue_napkins", "two_ply_tissue_napkins", "three_ply_tissue_napkins", "paper_dinner_napkin", "premium_airlaid_napkin", "airlaid_napkins", "towel_napkin", "dispenser_napkins", "small_dispenser_napkins", "standard_folded_dispenser_napkins", "pocket_napkins"];
const OVEN_CLEANER = ["oven_grill_cleaner", "oven_cleaner", "automatic_oven_detergent", "automatic_oven_cleaning_system_product"];
const YEAST = ["fresh_yeast", "dry_yeast", "instant_yeast"];
const THICKENER = ["light_sauce_thickener", "dark_sauce_thickener", "cornstarch", "potato_starch", "modified_cornstarch_thickener", "cold_swelling_thickener", "arrowroot_starch"];
const PLANT_MINCE = ["plant_based_mince_crumbles", "plant_mince", "plant_based_mince", "pea_mince", "textured_soy_mince", "textured_pea_mince", "fermented_bean_crumbles"];
const CANNED_TOMATO = ["crushed_tomatoes", "whole_peeled_tomatoes", "diced_tomatoes", "strained_tomatoes"];
const PLAIN_PLANT_DRINK = ["plain_oat_drink", "plain_almond_drink", "plain_soya_drink", "rice_drink", "oat_soya_blend"];
const THICK_YOGHURT = ["greek_yoghurt_plain", "turkish_yoghurt", "bulgarian_yoghurt", "turkish_cooking_yoghurt"];
const PLAIN_YOGHURT = ["natural_yoghurt", "fat_free_natural_yoghurt", "greek_yoghurt_plain", "turkish_yoghurt", "bulgarian_yoghurt", "icelandic_yoghurt"];
const GRILL_CHEESE = ["halloumi", "halloumi_slices", "halloumi_grilling_cheese", "smoked_halloumi", "bread_cheese_squeaky_cheese", "grilling_cheese", "saganaki_frying_cheese"];
const HALLOUMI = ["halloumi", "halloumi_slices", "halloumi_grilling_cheese", "smoked_halloumi"];
const WHEAT_FLOUR = ["fine_wheat_flour", "semi_coarse_wheat_flour", "coarse_wheat_flour", "all_purpose_flour_mix", "special_wheat_flour", "cake_wheat_flour"];
const PIZZA_FLOUR = ["pizza_flour_00", "pizza_flour", "strong_wheat_flour", "durum_wheat_flour"];
const DEEP_FRY = ["deep_frying_oil", "palm_frying_oil"];
const RAPESEED = ["rapeseed_oil", "cold_pressed_rapeseed_oil"];
const COCONUT = ["coconut_milk", "coconut_cream", "condensed_coconut_milk"];
const LASAGNE_CHEESE = ["grated_mozzarella", "pizza_cheese", "mixed_grated_cheese", "grated_emmental", "grated_cheddar", "mozzarella_block", "melting_cheese", ...HARD_ITALIAN];
const PASTA = ["long_spaghetti_pasta", "ribbon_pasta", "short_tubular_pasta", "short_shaped_pasta"];
/** Fresh dill the map files under "fresh herbs" (checked by hand). */
const DILL_MISFILED = ["461032"];
const DILL = ["dill", "fresh_dill", "dill_crowns", "frozen_chopped_dill"];
const LEEK = ["leek", "leeks", "sliced_leek", "diced_leek"];
const CUCUMBER = ["fresh_cucumber", "sliced_cucumber", "diced_cucumber", "cucumber_strips"];
const GARLIC = ["fresh_garlic", "peeled_garlic", "garlic_paste", "preserved_garlic"];
const ONION = ["yellow_onion", "onions", "red_onion", "white_onion", "sweet_onion", "peeled_yellow_onion", "peeled_red_onion", "diced_onion", "sliced_onion", "diced_red_onion", "sliced_red_onion", "shallot"];
const CARROT = ["carrot", "carrots", "peeled_carrot", "carrot_dice", "carrot_chunks", "sliced_carrot", "carrot_sticks"];
const MUSHROOMS = ["white_button_mushrooms", "brown_mushrooms", "portobello_mushrooms", "shiitake_mushrooms", "oyster_mushrooms", "king_oyster_mushrooms", "fresh_chanterelle_mushrooms", "wild_mushrooms", "mushrooms", "sliced_mushrooms", "preserved_mixed_forest_mushrooms", "preserved_champignons"];
const EGGS = ["chicken_eggs"];
const LIQUID_EGG = ["liquid_whole_egg"];
const BUTTER = ["salted_butter", "unsalted_butter"];
const RAW_CHICKEN_BREAST = ["chicken_breast_fillets_natural", "raw_chicken_breast", "raw_chicken_breast_portion", "chicken_breast_butterfly_cut"];
/** Plain only: the light kind also holds herb and tomato cream cheeses. */
const CREAM_CHEESE = ["plain_cream_cheese"];
const SPREADS = ["standard_vegetable_spread", "plant_spread", "plant_spread_for_cooking", "cooking_baking_margarine", "high_fat_vegetable_spread", "light_vegetable_spread"];
const DESSERTS = [
  "plant_pudding", "vanilla_pudding", "fruit_pudding", "spoonable_pudding", "chocolate_mousse", "white_chocolate_mousse", "mousse_dessert", "fruit_mousse", "kissel_fruit_soup", "panna_cotta",
  "sweet_dessert", "whipped_dessert", "rice_dessert", "ready_dessert_portion", "vanilla_dessert_cup", "ice_cream", "scoop_ice_cream", "ice_cream_cone", "ice_cream_stick", "single_serve_ice_cream_cup",
  "tub_ice_cream", "sorbet", "flavoured_quark_dessert", "layered_quark_dessert", "quark_mousse", "creme_brulee", "rice_snack_pudding", "semolina_snack_pudding", "yoghurt_dessert",
];
const BREAD = [
  "gluten_free_rolls_and_buns", "gluten_free_burger_buns", "rye_bread", "sourdough_bread", "white_toast_bread", "white_sliced_bread", "portion_bread", "oat_portion_bread", "white_sandwich_bread",
  "wholegrain_sandwich_bread", "oat_and_seed_loaf", "rye_loaf", "dark_specialty_loaf", "sourdough_country_loaf", "white_roll", "grain_roll", "rye_portion_bread", "baguette", "ciabatta", "seeded_rolls",
  "wholegrain_oat_and_rye_rolls", "white_wheat_rolls", "portion_loaves", "bread_rolls", "bread_roll", "multigrain_bread", "wholegrain_multigrain_toast", "wholegrain_multigrain_sliced_bread",
  "oat_toast_bread", "oat_sliced_bread", "dark_malt_bread", "potato_bread", "focaccia_flatbread", "pita_bread", "flatbread_wrap", "flatbread",
];
const NUTS_FREE = ["nuts", "peanuts"];

// ---------- the cases ----------

export const SEARCH_CASES: SearchCase[] = [
  // ===== exact: a product named plainly, a variant, a brand, a pack, a code =====
  { id: "en-plain-01", lang: "en", kind: "exact", tags: ["plain", "dietary"], text: "lactose-free milk", right: MILK, claims: ["lactose_free"] },
  { id: "en-plain-02", lang: "en", kind: "exact", tags: ["plain"], text: "parmesan", right: HARD_ITALIAN },
  { id: "en-plain-03", lang: "en", kind: "exact", tags: ["plain"], text: "chicken breast fillets", right: RAW_CHICKEN_BREAST },
  { id: "en-plain-04", lang: "en", kind: "exact", tags: ["plain"], text: "beetroot", right: FRESH_BEETROOT, holdout: true },
  { id: "en-plain-05", lang: "en", kind: "exact", tags: ["plain"], text: "burger buns", right: BURGER_BUNS },
  { id: "en-plain-06", lang: "en", kind: "exact", tags: ["plain"], text: "feta", right: ["feta_block", "crumbled_feta"] },
  { id: "en-plain-07", lang: "en", kind: "exact", tags: ["plain"], text: "jasmine rice", right: ["jasmine_rice"] },
  { id: "en-plain-08", lang: "en", kind: "exact", tags: ["plain"], text: "spaghetti", right: ["long_spaghetti_pasta"], holdout: true },
  { id: "en-plain-09", lang: "en", kind: "exact", tags: ["plain"], text: "frankfurters", right: ["frankfurter_wiener", "cocktail_frankfurter"] },
  { id: "en-plain-10", lang: "en", kind: "exact", tags: ["plain"], text: "streaky bacon", right: ["streaky_bacon_slices", "bacon"] },
  { id: "en-variant-01", lang: "en", kind: "exact", tags: ["variant"], text: "salted butter portions for the breakfast buffet", right: ["salted_butter_portions", "lightly_salted_butter_portions"] },
  { id: "en-variant-02", lang: "en", kind: "exact", tags: ["variant"], text: "semi-skimmed milk", right: ["semi_skimmed_milk"] },
  { id: "en-variant-03", lang: "en", kind: "exact", tags: ["variant"], text: "smoked salmon slices", right: SMOKED_SALMON },
  { id: "en-variant-04", lang: "en", kind: "exact", tags: ["variant"], text: "grated parmesan", right: ["grated_hard_italian_cheese"], holdout: true },
  { id: "en-variant-05", lang: "en", kind: "exact", tags: ["variant", "dietary"], text: "gluten free lasagne sheets", right: ["lasagne_sheets"], claims: ["gluten_free"] },
  { id: "en-brand-01", lang: "en", kind: "exact", tags: ["brand"], text: "Oatly barista", right: ["barista_oat_drink"], brand: "oatly" },
  { id: "en-brand-02", lang: "en", kind: "exact", tags: ["brand"], text: "Philadelphia cream cheese", right: CREAM_CHEESE, brand: "philadelphia" },
  { id: "en-brand-03", lang: "en", kind: "exact", tags: ["brand"], text: "Mutti crushed tomatoes", right: ["crushed_tomatoes"], brand: "mutti", holdout: true },
  { id: "en-pack-01", lang: "en", kind: "exact", tags: ["pack", "dietary"], text: "lactose-free semi-skimmed milk in a 10 litre box, not the 1 l cartons", right: ["semi_skimmed_milk"], claims: ["lactose_free"], pack: { amount: 10, unit: "L" } },
  { id: "en-pack-02", lang: "en", kind: "exact", tags: ["pack", "brand"], text: "Arla cooking cream 15% 10 litres", right: ["cooking_cream_15"], brand: "arla", pack: { amount: 10, unit: "L" } },
  { id: "en-pack-03", lang: "en", kind: "exact", tags: ["pack"], text: "basmati rice, 5 kg sack", right: ["basmati_rice"], pack: { amount: 5, unit: "kg" } },
  { id: "en-pack-04", lang: "en", kind: "exact", tags: ["pack"], text: "deep frying oil 10 l", right: DEEP_FRY, pack: { amount: 10, unit: "L" } },
  { id: "en-code-01", lang: "en", kind: "exact", tags: ["code"], text: "product 464201", right: ["semi_skimmed_milk"], productId: "464201" },
  { id: "en-code-02", lang: "en", kind: "exact", tags: ["code"], text: "do you still have 472997?", right: ["live_oysters"], productId: "472997" },
  { id: "en-typo-01", lang: "en", kind: "exact", tags: ["typo"], text: "spagetti", right: ["long_spaghetti_pasta"] },
  { id: "en-typo-02", lang: "en", kind: "exact", tags: ["typo"], text: "mozarela grated", right: ["grated_mozzarella"] },
  { id: "en-typo-03", lang: "en", kind: "exact", tags: ["typo"], text: "chiken brest", right: RAW_CHICKEN_BREAST, holdout: true },
  { id: "en-typo-04", lang: "en", kind: "exact", tags: ["typo"], text: "whiping cream", right: WHIPPING },

  { id: "fi-plain-01", lang: "fi", kind: "exact", tags: ["plain"], text: "rypsiöljy", right: RAPESEED },
  { id: "fi-plain-02", lang: "fi", kind: "exact", tags: ["plain"], text: "halloumi", right: HALLOUMI },
  { id: "fi-plain-03", lang: "fi", kind: "exact", tags: ["plain"], text: "hampurilaissämpylät", right: BURGER_BUNS, holdout: true },
  { id: "fi-inflected-01", lang: "fi", kind: "exact", tags: ["plain", "inflected"], text: "kermaa", right: CREAM },
  { id: "fi-inflected-02", lang: "fi", kind: "exact", tags: ["plain", "inflected"], text: "kananmunia", right: EGGS },
  { id: "fi-inflected-03", lang: "fi", kind: "exact", tags: ["plain", "inflected"], text: "spagettia", right: ["long_spaghetti_pasta"] },
  { id: "fi-inflected-04", lang: "fi", kind: "exact", tags: ["plain", "inflected"], text: "jasmiiniriisiä", right: ["jasmine_rice"], holdout: true },
  { id: "fi-inflected-05", lang: "fi", kind: "exact", tags: ["plain", "inflected"], text: "pekonia", right: BACON },
  { id: "fi-inflected-06", lang: "fi", kind: "exact", tags: ["plain", "inflected"], text: "nakkeja", right: ["frankfurter_wiener", "cocktail_frankfurter"] },
  { id: "fi-variant-01", lang: "fi", kind: "exact", tags: ["variant", "dietary", "inflected"], text: "laktoositonta ranskankermaa", right: ["creme_fraiche", "low_fat_creme_fraiche"], claims: ["lactose_free"] },
  { id: "fi-typo-01", lang: "fi", kind: "exact", tags: ["typo", "dietary"], text: "laktositon maito", right: MILK, claims: ["lactose_free"] },
  { id: "fi-typo-02", lang: "fi", kind: "exact", tags: ["typo"], text: "mozarella raaste", right: ["grated_mozzarella"] },
  { id: "fi-typo-03", lang: "fi", kind: "exact", tags: ["typo"], text: "halloumii", right: HALLOUMI, holdout: true },
  { id: "fi-typo-04", lang: "fi", kind: "exact", tags: ["typo"], text: "parmesanraaste", right: ["grated_hard_italian_cheese"] },
  { id: "fi-brand-01", lang: "fi", kind: "exact", tags: ["brand"], text: "Elovena kaurajuoma barista", right: ["barista_oat_drink"], brand: "elovena" },
  { id: "fi-pack-01", lang: "fi", kind: "exact", tags: ["pack", "dietary", "inflected"], text: "tarttis 20 litraa laktoositonta kevytmaitoa litran purkeissa", right: ["semi_skimmed_milk"], claims: ["lactose_free"], pack: { amount: 1, unit: "L" } },
  { id: "fi-pack-02", lang: "fi", kind: "exact", tags: ["pack", "dietary"], text: "ruokakerma 15 % laktoositon 10 l", right: ["cooking_cream_15"], claims: ["lactose_free"], pack: { amount: 10, unit: "L" }, holdout: true },
  { id: "fi-code-01", lang: "fi", kind: "exact", tags: ["code"], text: "tuote 469512", right: ["barista_oat_drink"], productId: "469512" },

  { id: "sv-plain-01", lang: "sv", kind: "exact", tags: ["plain"], text: "smör", right: BUTTER },
  { id: "sv-plain-02", lang: "sv", kind: "exact", tags: ["plain"], text: "vispgrädde", right: WHIPPING },
  { id: "sv-plain-03", lang: "sv", kind: "exact", tags: ["plain"], text: "rapsolja", right: RAPESEED },
  { id: "sv-inflected-01", lang: "sv", kind: "exact", tags: ["variant", "inflected"], text: "det osaltade smöret", right: ["unsalted_butter"] },
  { id: "sv-inflected-02", lang: "sv", kind: "exact", tags: ["plain", "inflected"], text: "äggen till frukosten", right: EGGS },
  { id: "sv-variant-01", lang: "sv", kind: "exact", tags: ["variant"], text: "havredryck barista", right: ["barista_oat_drink"] },
  { id: "sv-pack-01", lang: "sv", kind: "exact", tags: ["pack", "dietary"], text: "laktosfri mjölk, literförpackningar", right: MILK, claims: ["lactose_free"], pack: { amount: 1, unit: "L" } },
  { id: "sv-brand-01", lang: "sv", kind: "exact", tags: ["brand"], text: "Kieku ägg", right: EGGS, brand: "kieku", holdout: true },
  { id: "sv-code-01", lang: "sv", kind: "exact", tags: ["code"], text: "artikel 461273", right: ["whipping_cream"], productId: "461273" },
  { id: "sv-typo-01", lang: "sv", kind: "exact", tags: ["typo"], text: "vispgrädd laktosfr", right: WHIPPING, claims: ["lactose_free"] },

  { id: "mx-exact-01", lang: "mixed", kind: "exact", tags: ["mixed_language", "dietary"], text: "laktoositon whipping cream", right: WHIPPING, claims: ["lactose_free"] },
  { id: "mx-exact-02", lang: "mixed", kind: "exact", tags: ["mixed_language", "brand"], text: "Valio kuohukerma lactose free", right: WHIPPING, claims: ["lactose_free"], brand: "valio", holdout: true },
  { id: "mx-exact-03", lang: "mixed", kind: "exact", tags: ["mixed_language", "dietary"], text: "glutenfri hampurilaissämpylä", right: BURGER_BUNS, claims: ["gluten_free"] },

  // ===== recipe: dishes, ingredient lists, ingredients named for a dish =====
  { id: "en-dish-01", lang: "en", kind: "recipe", tags: ["dish"], text: "ingredients for carbonara", right: [...PASTA, ...CARBONARA_PORK, ...HARD_ITALIAN, ...EGGS, "liquid_egg_yolk", ...COOKING_CREAM] },
  { id: "en-dish-02", lang: "en", kind: "recipe", tags: ["dish"], text: "what we need for the beetroot salad", right: [...FRESH_BEETROOT, ...PICKLED_BEETROOT, "feta_block", "crumbled_feta", "fresh_goat_cheese", "goat_cheese_log", ...ONION, "walnuts", "mixed_salad_leaves", "mixed_leaf_salad", "rocket", "arugula"] },
  { id: "en-dish-03", lang: "en", kind: "recipe", tags: ["dish"], text: "carbonara for 60", right: [...PASTA, ...CARBONARA_PORK, ...HARD_ITALIAN, ...EGGS, "liquid_egg_yolk", ...COOKING_CREAM], holdout: true },
  { id: "en-dish-04", lang: "en", kind: "recipe", tags: ["dish"], text: "everything for a caesar salad", right: ["romaine_lettuce", "little_gem_lettuce", "plain_croutons", "flavoured_croutons", "caesar_dressing", ...HARD_ITALIAN, ...RAW_CHICKEN_BREAST, "cooked_chicken_breast_slices", "cooked_chicken_breast_strips", "cooked_chicken_breast_fillets", "cooked_chicken_strips"] },
  { id: "en-dish-05", lang: "en", kind: "recipe", tags: ["dish"], text: "tzatziki ingredients", right: [...THICK_YOGHURT, ...CUCUMBER, ...GARLIC, ...DILL, "tzatziki"], alsoRight: DILL_MISFILED },
  { id: "en-dish-06", lang: "en", kind: "recipe", tags: ["dish"], text: "we are out of what we need for the cheesecake", right: [...CREAM_CHEESE, "digestive_biscuits", "oat_biscuits", "plain_tea_biscuits", ...BUTTER, ...WHIPPING, "granulated_white_sugar", "caster_sugar", "gelatin_leaves"] },
  { id: "en-dish-07", lang: "en", kind: "recipe", tags: ["dish"], text: "pulled pork burgers for the terrace", right: ["pulled_pork", ...BURGER_BUNS] },
  { id: "en-ingr-01", lang: "en", kind: "recipe", tags: ["ingredient"], text: "cream for carbonara", right: [...COOKING_CREAM, ...WHIPPING] },
  { id: "en-ingr-02", lang: "en", kind: "recipe", tags: ["ingredient"], text: "bacon for the carbonara", right: CARBONARA_PORK },
  { id: "en-ingr-03", lang: "en", kind: "recipe", tags: ["ingredient"], text: "cheese for the lasagne", right: LASAGNE_CHEESE },
  { id: "en-ingr-04", lang: "en", kind: "recipe", tags: ["ingredient"], text: "mince for bolognese", right: BEEF_MINCE, holdout: true },
  { id: "en-ingr-05", lang: "en", kind: "recipe", tags: ["ingredient"], text: "pasta for the bolognese", right: PASTA },
  { id: "en-ingr-06", lang: "en", kind: "recipe", tags: ["ingredient"], text: "potatoes for mash", right: POTATOES },
  { id: "en-ingr-07", lang: "en", kind: "recipe", tags: ["ingredient"], text: "coconut milk for the curry", right: COCONUT },
  { id: "en-ingr-08", lang: "en", kind: "recipe", tags: ["ingredient"], text: "rice for sushi", right: ["sushi_rice"] },
  { id: "en-ingr-09", lang: "en", kind: "recipe", tags: ["ingredient"], text: "nori sheets for the sushi rolls", right: ["roasted_nori"], holdout: true },
  { id: "en-ingr-10", lang: "en", kind: "recipe", tags: ["ingredient"], text: "gelatine for panna cotta", right: ["gelatin_leaves", "gelatin_powder"], standins: ["agar_agar", "vegetable_gelling_blend"] },
  { id: "en-ingr-11", lang: "en", kind: "recipe", tags: ["ingredient"], text: "mushrooms for the risotto", right: MUSHROOMS },
  { id: "en-ingr-12", lang: "en", kind: "recipe", tags: ["ingredient", "dietary"], text: "lactose free cream for the mushroom sauce", right: COOKING_CREAM, claims: ["lactose_free"] },
  { id: "en-ingr-13", lang: "en", kind: "recipe", tags: ["ingredient"], text: "eggs for omelettes for 80 people", right: [...EGGS, ...LIQUID_EGG] },
  { id: "en-ingr-14", lang: "en", kind: "recipe", tags: ["ingredient"], text: "tortillas for taco night", right: TORTILLAS },

  { id: "fi-dish-01", lang: "fi", kind: "recipe", tags: ["dish", "inflected"], text: "carbonaraan ainekset", right: [...PASTA, ...CARBONARA_PORK, ...HARD_ITALIAN, ...EGGS, "liquid_egg_yolk", ...COOKING_CREAM] },
  { id: "fi-dish-02", lang: "fi", kind: "recipe", tags: ["dish", "inflected"], text: "lohikeiton ainekset 50 hengelle", right: [...RAW_SALMON, ...POTATOES, ...COOKING_CREAM, ...LEEK, ...DILL, "fish_bouillon", "fish_fond", ...CARROT, ...ONION], alsoRight: DILL_MISFILED },
  { id: "fi-dish-03", lang: "fi", kind: "recipe", tags: ["dish", "inflected"], text: "jauhelihakeittoon tarvikkeet", right: [...BEEF_MINCE, ...POTATOES, ...CARROT, ...ONION, "beef_bouillon", "meat_bouillon"], holdout: true },
  { id: "fi-dish-04", lang: "fi", kind: "recipe", tags: ["dish"], text: "punajuurisalaatti", right: [...FRESH_BEETROOT, ...PICKLED_BEETROOT, "beetroot_salad"] },
  { id: "fi-ingr-01", lang: "fi", kind: "recipe", tags: ["ingredient", "inflected"], text: "tilliä lohikeittoon", right: DILL, alsoRight: DILL_MISFILED },
  { id: "fi-ingr-02", lang: "fi", kind: "recipe", tags: ["ingredient", "inflected"], text: "kookosmaitoa curryyn", right: COCONUT },
  { id: "fi-ingr-03", lang: "fi", kind: "recipe", tags: ["ingredient", "inflected"], text: "riisiä risottoon", right: ["risotto_rice"] },
  { id: "fi-ingr-04", lang: "fi", kind: "recipe", tags: ["ingredient", "inflected"], text: "juustoa lasagneen", right: LASAGNE_CHEESE, holdout: true },
  { id: "fi-ingr-05", lang: "fi", kind: "recipe", tags: ["ingredient", "inflected"], text: "lasagnelevyjä 60 annokseen", right: ["lasagne_sheets"] },
  { id: "fi-ingr-06", lang: "fi", kind: "recipe", tags: ["ingredient", "inflected", "dietary"], text: "laktoositonta kermaa kastikkeeseen", right: COOKING_CREAM, claims: ["lactose_free"] },
  { id: "fi-ingr-07", lang: "fi", kind: "recipe", tags: ["ingredient", "inflected"], text: "perunoita muusiin", right: POTATOES },
  { id: "fi-ingr-08", lang: "fi", kind: "recipe", tags: ["ingredient", "inflected"], text: "pepperonia pizzoihin", right: ["pizza_pepperoni"] },

  { id: "sv-dish-01", lang: "sv", kind: "recipe", tags: ["dish"], text: "ingredienser till pannkakor", right: [...WHEAT_FLOUR, ...MILK, ...EGGS, ...LIQUID_EGG, ...BUTTER, "pancake_waffle_mix"] },
  { id: "sv-dish-02", lang: "sv", kind: "recipe", tags: ["dish"], text: "allt till en laxsoppa", right: [...RAW_SALMON, ...POTATOES, ...COOKING_CREAM, ...LEEK, ...DILL, "fish_bouillon", "fish_fond", ...CARROT, ...ONION], holdout: true, alsoRight: DILL_MISFILED },
  { id: "sv-ingr-01", lang: "sv", kind: "recipe", tags: ["ingredient"], text: "grädde till carbonaran", right: [...COOKING_CREAM, ...WHIPPING] },
  { id: "sv-ingr-02", lang: "sv", kind: "recipe", tags: ["ingredient"], text: "köttfärs till lasagnen", right: BEEF_MINCE },
  { id: "sv-ingr-03", lang: "sv", kind: "recipe", tags: ["ingredient"], text: "dill till laxen", right: DILL, alsoRight: DILL_MISFILED },
  { id: "sv-ingr-04", lang: "sv", kind: "recipe", tags: ["ingredient"], text: "mjöl till pizzadegen", right: PIZZA_FLOUR },

  { id: "mx-recipe-01", lang: "mixed", kind: "recipe", tags: ["mixed_language", "ingredient"], text: "jauheliha for bolognese", right: BEEF_MINCE },
  { id: "mx-recipe-02", lang: "mixed", kind: "recipe", tags: ["mixed_language", "ingredient"], text: "kermaa carbonaraan, lactose free", right: [...COOKING_CREAM, ...WHIPPING], claims: ["lactose_free"] },
  { id: "mx-recipe-03", lang: "mixed", kind: "recipe", tags: ["mixed_language", "ingredient"], text: "smoked lohi for the sandwiches", right: SMOKED_SALMON, holdout: true },

  // ===== describe: what the thing is or does =====
  { id: "en-use-01", lang: "en", kind: "describe", tags: ["use"], text: "oat milk for coffee", right: ["barista_oat_drink"], standins: ["plain_oat_drink", "barista_soya_drink", "barista_almond_drink"] },
  { id: "en-use-02", lang: "en", kind: "describe", tags: ["use"], text: "something for the dishwasher", right: DISHWASHER },
  { id: "en-use-03", lang: "en", kind: "describe", tags: ["use", "dietary"], text: "a dessert for kids without nuts", right: DESSERTS, allergenFree: NUTS_FREE, note: "scoop_ice_cream also holds a few liqueur ice creams: right by kind, wrong for children" },
  { id: "en-use-04", lang: "en", kind: "describe", tags: ["use"], text: "cream that whips well", right: WHIPPING, standins: ["plant_whipping_cream"] },
  { id: "en-use-05", lang: "en", kind: "describe", tags: ["use"], text: "cheese that melts on pizza", right: PIZZA_CHEESE, holdout: true },
  { id: "en-use-06", lang: "en", kind: "describe", tags: ["use", "dietary"], text: "vegan cheese for pizza", right: ["plant_cheese_shreds", "plant_pizza_cheese_block"], claims: ["vegan"] },
  { id: "en-use-07", lang: "en", kind: "describe", tags: ["use"], text: "oil for the deep fryer", right: DEEP_FRY, standins: RAPESEED },
  { id: "en-use-08", lang: "en", kind: "describe", tags: ["use"], text: "something to thicken the sauce", right: THICKENER },
  { id: "en-use-09", lang: "en", kind: "describe", tags: ["use"], text: "milk for the coffee machine", right: ["coffee_machine_milk", "coffee_milk"], standins: MILK },
  { id: "en-use-10", lang: "en", kind: "describe", tags: ["use"], text: "disposable gloves for food prep", right: GLOVES, holdout: true },
  { id: "en-use-11", lang: "en", kind: "describe", tags: ["use"], text: "something to wrap the leftovers in", right: ["cling_film_roll", "perforated_cling_film", "aluminium_foil", "heavy_duty_aluminium_foil"] },
  { id: "en-use-12", lang: "en", kind: "describe", tags: ["use"], text: "bin bags for the kitchen", right: REFUSE_BAGS },
  { id: "en-use-13", lang: "en", kind: "describe", tags: ["use"], text: "a cheese you can grill without it melting", right: GRILL_CHEESE },
  { id: "en-use-14", lang: "en", kind: "describe", tags: ["use"], text: "plant-based mince for tacos", right: PLANT_MINCE },
  { id: "en-use-15", lang: "en", kind: "describe", tags: ["use"], text: "little sugar sachets for the coffee table", right: ["portion_sugar", "sugar_cubes"], holdout: true },
  { id: "en-use-16", lang: "en", kind: "describe", tags: ["use"], text: "something to clean the oven", right: OVEN_CLEANER },
  { id: "en-use-17", lang: "en", kind: "describe", tags: ["use", "dietary"], text: "plain lactose-free yoghurt for breakfast", right: PLAIN_YOGHURT, claims: ["lactose_free"] },
  { id: "en-use-18", lang: "en", kind: "describe", tags: ["use"], text: "thick yoghurt for tzatziki", right: THICK_YOGHURT },
  { id: "en-use-19", lang: "en", kind: "describe", tags: ["use"], text: "tinned tomatoes for a pasta sauce", right: CANNED_TOMATO },
  { id: "en-use-20", lang: "en", kind: "describe", tags: ["use", "dietary"], text: "bread without gluten", right: BREAD, claims: ["gluten_free"], holdout: true },
  { id: "en-use-21", lang: "en", kind: "describe", tags: ["use"], text: "frozen fries for the fryer", right: FRIES },
  { id: "en-use-22", lang: "en", kind: "describe", tags: ["use"], text: "something to make the dough rise", right: [...YEAST, "baking_leaveners"] },
  { id: "en-use-23", lang: "en", kind: "describe", tags: ["use"], text: "flour for pizza dough", right: PIZZA_FLOUR },
  { id: "en-use-24", lang: "en", kind: "describe", tags: ["use", "dietary"], text: "a plant drink without soy for a child with a soy allergy", right: PLAIN_PLANT_DRINK, allergenFree: ["soy"] },
  { id: "en-use-25", lang: "en", kind: "describe", tags: ["use"], text: "ice for the drinks", right: ["ice_cubes"] },
  { id: "en-use-26", lang: "en", kind: "describe", tags: ["use"], text: "stock for a fish soup", right: ["fish_bouillon", "fish_fond"], standins: ["shellfish_fond", "vegetable_bouillon"] },
  { id: "en-use-27", lang: "en", kind: "describe", tags: ["use"], text: "napkins for the lunch tables", right: NAPKINS },
  { id: "en-standin-01", lang: "en", kind: "describe", tags: ["standin_only"], text: "goat milk", right: [], standins: MILK },
  { id: "en-standin-02", lang: "en", kind: "describe", tags: ["standin_only"], text: "almond cooking cream", right: [], standins: ["plant_cooking_cream", "oat_cooking_drink", "plant_cooking_whipping_cream"], holdout: true },
  { id: "en-standin-03", lang: "en", kind: "describe", tags: ["standin_only", "dietary"], text: "vegan butter", right: [], standins: SPREADS, claims: ["vegan"] },
  { id: "en-standin-04", lang: "en", kind: "describe", tags: ["standin_only", "dietary"], text: "lactose-free ricotta for the lasagne", right: [], standins: [...CREAM_CHEESE, "plain_cottage_cheese", "plain_quark", "soft_quark"], claims: ["lactose_free"] },
  { id: "en-notsold-01", lang: "en", kind: "describe", tags: ["not_sold"], text: "kangaroo fillet", right: [] },
  { id: "en-notsold-02", lang: "en", kind: "describe", tags: ["not_sold"], text: "fresh durian", right: [] },
  { id: "en-notsold-03", lang: "en", kind: "describe", tags: ["not_sold"], text: "a laptop for the office", right: [], holdout: true },
  { id: "en-notsold-04", lang: "en", kind: "describe", tags: ["not_sold"], text: "sea urchin", right: [] },
  { id: "en-notsold-05", lang: "en", kind: "describe", tags: ["not_sold"], text: "camel milk", right: [] },

  { id: "fi-use-01", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "konetiskiainetta", right: DISHWASHER_DETERGENT },
  { id: "fi-use-02", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "kaurajuomaa kahviin", right: ["barista_oat_drink"], standins: ["plain_oat_drink"] },
  { id: "fi-use-03", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "friteerausöljyä rasvakeittimeen", right: DEEP_FRY, standins: RAPESEED },
  { id: "fi-use-04", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "kertakäyttöhanskoja keittiöön", right: GLOVES },
  { id: "fi-use-05", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "leipäjuustoa", right: ["bread_cheese_squeaky_cheese"] },
  { id: "fi-use-06", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "tomaattimurskaa kastikkeeseen", right: ["crushed_tomatoes"] },
  { id: "fi-use-07", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "ranskalaisia uppopaistoon", right: FRIES },
  { id: "fi-use-08", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "hiivaa pullataikinaan", right: YEAST, holdout: true },
  { id: "fi-use-09", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "lautasliinoja juhliin", right: NAPKINS },
  { id: "fi-use-10", lang: "fi", kind: "describe", tags: ["use", "dietary"], text: "pähkinätön jälkiruoka päiväkotiin", right: DESSERTS, allergenFree: NUTS_FREE },
  { id: "fi-use-11", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "jotain uunin pesuun", right: OVEN_CLEANER },
  { id: "fi-use-12", lang: "fi", kind: "describe", tags: ["use", "dietary"], text: "vegaaninen juusto pizzaan", right: ["plant_cheese_shreds", "plant_pizza_cheese_block"], claims: ["vegan"], holdout: true },
  { id: "fi-use-13", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "kermaa vispattavaksi", right: WHIPPING, standins: ["plant_whipping_cream"] },
  { id: "fi-use-14", lang: "fi", kind: "describe", tags: ["use"], text: "kasvisjauheliha tacoihin", right: PLANT_MINCE },
  { id: "fi-use-15", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "jätesäkkejä keittiöön", right: REFUSE_BAGS },
  { id: "fi-use-16", lang: "fi", kind: "describe", tags: ["use", "inflected"], text: "jotain millä saa kastikkeen sakeaksi", right: THICKENER },
  { id: "fi-typo-05", lang: "fi", kind: "describe", tags: ["typo", "use"], text: "kaurajuma barista kahviin", right: ["barista_oat_drink"], standins: ["plain_oat_drink"] },
  { id: "fi-typo-06", lang: "fi", kind: "describe", tags: ["typo", "use", "dietary"], text: "maustamaton jugurtti laktositon", right: PLAIN_YOGHURT, claims: ["lactose_free"] },
  { id: "fi-standin-01", lang: "fi", kind: "describe", tags: ["standin_only"], text: "hernejuomaa", right: [], standins: PLAIN_PLANT_DRINK },
  { id: "fi-standin-02", lang: "fi", kind: "describe", tags: ["standin_only", "inflected"], text: "kalkkunan jauhelihaa", right: [], standins: ["chicken_mince", "minced_chicken"], holdout: true },
  { id: "fi-notsold-01", lang: "fi", kind: "describe", tags: ["not_sold"], text: "strutsin fileetä", right: [] },
  { id: "fi-notsold-02", lang: "fi", kind: "describe", tags: ["not_sold"], text: "polkupyörä", right: [] },
  { id: "fi-notsold-03", lang: "fi", kind: "describe", tags: ["not_sold"], text: "kengurunlihaa", right: [], holdout: true },

  { id: "sv-use-01", lang: "sv", kind: "describe", tags: ["use"], text: "något att diska med i maskinen", right: DISHWASHER_DETERGENT },
  { id: "sv-use-02", lang: "sv", kind: "describe", tags: ["use"], text: "havremjölk till kaffet", right: ["barista_oat_drink"], standins: ["plain_oat_drink"] },
  { id: "sv-use-03", lang: "sv", kind: "describe", tags: ["use"], text: "sopsäckar", right: REFUSE_BAGS },
  { id: "sv-use-04", lang: "sv", kind: "describe", tags: ["use"], text: "ugnsrengöring", right: OVEN_CLEANER, holdout: true },
  { id: "sv-use-05", lang: "sv", kind: "describe", tags: ["use"], text: "ost som smälter på pizzan", right: PIZZA_CHEESE },
  { id: "sv-use-06", lang: "sv", kind: "describe", tags: ["use"], text: "olja till fritösen", right: DEEP_FRY, standins: RAPESEED },
  { id: "sv-use-07", lang: "sv", kind: "describe", tags: ["use", "dietary"], text: "glutenfritt bröd", right: BREAD, claims: ["gluten_free"] },
  { id: "sv-use-08", lang: "sv", kind: "describe", tags: ["use", "dietary"], text: "nötfri efterrätt till barnen", right: DESSERTS, allergenFree: NUTS_FREE, holdout: true },
  { id: "sv-use-09", lang: "sv", kind: "describe", tags: ["use"], text: "engångshandskar", right: GLOVES },
  { id: "sv-use-10", lang: "sv", kind: "describe", tags: ["use"], text: "jäst till bullarna", right: YEAST },
  { id: "sv-use-11", lang: "sv", kind: "describe", tags: ["use"], text: "plastfolie att täcka över maten", right: ["cling_film_roll", "perforated_cling_film"] },
  { id: "sv-standin-01", lang: "sv", kind: "describe", tags: ["standin_only"], text: "ankägg", right: [], standins: EGGS },
  { id: "sv-standin-02", lang: "sv", kind: "describe", tags: ["standin_only", "dietary"], text: "veganskt smör", right: [], standins: SPREADS, claims: ["vegan"] },
  { id: "sv-notsold-01", lang: "sv", kind: "describe", tags: ["not_sold"], text: "grodlår", right: [] },
  { id: "sv-notsold-02", lang: "sv", kind: "describe", tags: ["not_sold"], text: "strutsfilé", right: [] },

  { id: "mx-describe-01", lang: "mixed", kind: "describe", tags: ["mixed_language", "use"], text: "kaurajuoma för kaffe", right: ["barista_oat_drink"], standins: ["plain_oat_drink"] },
  { id: "mx-describe-02", lang: "mixed", kind: "describe", tags: ["mixed_language", "use", "dietary"], text: "pizza cheese vegaaninen", right: ["plant_cheese_shreds", "plant_pizza_cheese_block"], claims: ["vegan"] },
  { id: "mx-describe-03", lang: "mixed", kind: "describe", tags: ["mixed_language", "use"], text: "tiskikone tabs", right: ["dishwasher_all_in_one_tablets", "machine_dishwashing_solid"], standins: DISHWASHER_DETERGENT },
  { id: "mx-describe-04", lang: "mixed", kind: "describe", tags: ["mixed_language", "use"], text: "frying oil rasvakeittimeen", right: DEEP_FRY, standins: RAPESEED },
  { id: "mx-describe-05", lang: "mixed", kind: "describe", tags: ["mixed_language", "use", "dietary"], text: "dessert ilman pähkinöitä for the kids", right: DESSERTS, allergenFree: NUTS_FREE },
  { id: "mx-describe-06", lang: "mixed", kind: "describe", tags: ["mixed_language", "not_sold"], text: "kangaroo liha", right: [] },
  // ===== school and hospital kitchens: a nut or celery rule on fresh produce whose makers sent no allergen data =====
  // Fresh, whole produce counts by its nature (core/catalog/nature.ts); anything processed must still have declared data.
  { id: "en-school-01", lang: "en", kind: "exact", tags: ["plain", "dietary"], text: "yellow onions for the school kitchen, we are nut-free", right: ONION, allergenFree: ["nuts"] },
  { id: "en-school-02", lang: "en", kind: "exact", tags: ["plain", "dietary"], text: "parsnips for the hospital ward, no nuts", right: ["parsnip", "peeled_parsnip"], allergenFree: ["nuts"] },
  { id: "en-school-03", lang: "en", kind: "exact", tags: ["plain", "dietary"], text: "fresh dill for a nut-free daycare", right: DILL, alsoRight: DILL_MISFILED, allergenFree: ["nuts"] },
  { id: "fi-school-01", lang: "fi", kind: "exact", tags: ["plain", "dietary", "inflected"], text: "porkkanoita koulukeittiöön, pähkinätön", right: CARROT, allergenFree: ["nuts"] },
  { id: "fi-school-02", lang: "fi", kind: "exact", tags: ["plain", "dietary", "inflected"], text: "perunoita sairaalaan, ei pähkinöitä", right: POTATOES, allergenFree: ["nuts"] },
  { id: "sv-school-01", lang: "sv", kind: "exact", tags: ["plain", "dietary"], text: "gul lök till skolköket, nötfritt", right: ONION, allergenFree: ["nuts"] },
  { id: "en-school-04", lang: "en", kind: "exact", tags: ["plain", "dietary"], text: "courgettes for the school, nut and peanut free", right: ["courgette", "zucchini"], allergenFree: ["nuts", "peanuts"] },
  { id: "en-school-05", lang: "en", kind: "describe", tags: ["dietary"], text: "root vegetables for a hospital soup, patient has a celery allergy", right: [...CARROT, "parsnip", "peeled_parsnip", ...FRESH_BEETROOT, "other_root_vegetables"], allergenFree: ["celery"] },

];
