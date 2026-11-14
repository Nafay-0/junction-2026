/**
 * The audit time machine's one switch: DOCK_MARIADB_URL, the address of a MariaDB server (11.8 or later, for the
 * VECTOR type; system versioning is older). Unset or blank: no mirror, nothing connects, and the operations page
 * says plainly that no time machine is attached.
 *
 *   mariadb://user:password@host:3306/dock_audit
 *   mariadb://user:password@host:3306/dock_audit?ssl=true      (a hosted server that requires TLS)
 *
 * MariaDB is never in the path of an order: the mirror reads the app's own state after the fact (mirror.ts).
 */
export const MARIADB_ENV = "DOCK_MARIADB_URL";

export type MariaConfig = { host: string; port: number; user: string; password: string; database: string; ssl: boolean; display: string };

export function mariaUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env[MARIADB_ENV]?.trim();
  return v ? v : undefined;
}

export function mariaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return mariaUrl(env) !== undefined;
}

/** Parse the address. Throws on a malformed one, so a typo is loud at start rather than a silent "not attached". */
export function parseMariaUrl(raw: string): MariaConfig {
  const u = new URL(raw);
  if (u.protocol !== "mariadb:" && u.protocol !== "mysql:") throw new Error(`${MARIADB_ENV} must start with mariadb://, not ${u.protocol}//`);
  const database = decodeURIComponent(u.pathname.replace(/^\//, "")) || "dock_audit";
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) throw new Error(`${MARIADB_ENV}: database name "${database}" must be letters, digits and _`);
  const ssl = u.searchParams.get("ssl") === "true" || u.searchParams.get("ssl") === "1";
  const port = u.port ? Number(u.port) : 3306;
  return {
    host: u.hostname,
    port,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    ssl,
    // What a page may show: never the password.
    display: `${u.hostname}:${port}/${database}${ssl ? " (TLS)" : ""}`,
  };
}

/** True for a server on this machine: the reproduction resets only such a database unless told otherwise. */
export function isLocalHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
