export { SEARCH_ALIAS, INDEX_PREFIX, indexSettings, indexMappings, toDoc, type ProductDoc } from "./mapping";
export { OpenSearchProductSearch, buildSearchBody, toHits, type SearchClient, type OpenSearchProductSearchOptions } from "./opensearch-search";
export { SearchRoutedCatalog, searchFromEnv, type RoutableCatalog, type ProductSearcher, type SearchRoutedCatalogOptions, type SearchRoutingStats } from "./routed-catalog";
