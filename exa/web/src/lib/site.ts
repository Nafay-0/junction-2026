/** The address people reach the site at: what links in emails point to. */
export const siteUrl = (): string => (process.env.BERYL_SITE_URL?.trim() || "https://beryl.zeroanomaly.tech").replace(/\/+$/, "");
