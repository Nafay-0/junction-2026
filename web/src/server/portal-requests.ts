/**
 * Request texts the kitchen portal writes for itself. Kept apart so screens that read the ledger (the wall, the
 * portal's own history) can tell a browsing request from a buyer's request without importing the portal.
 */

/** The request a portal opens once a day for the live price checks of products the buyer opens in the catalogue. */
export const BROWSE_TEXT = "Kitchen portal: live price checks for products the buyer opened in the catalogue";
export const BASKET_PREFIX = "Basket from the catalogue:";

/** The request the kitchen agent's watch opens once a day for its live availability checks (server/watch). */
export const WATCH_TEXT = "Kitchen agent's watch: live availability of the kitchen's key products";
