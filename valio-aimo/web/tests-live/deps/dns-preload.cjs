/**
 * Preload for the app process in the Aiven dependency tests (NODE_OPTIONS=--require <this file>). Two jobs:
 *
 * 1. DNS: host names listed in DEPS_DNS_MAP (JSON {"host": "127.0.0.1"}) resolve to the given address, so the app
 *    connects to tests-live/deps/fault-proxy.ts instead of the service. TLS still uses the real host name (SNI and
 *    certificate check), because only the lookup changes. Every other name resolves as usual.
 *
 * 2. Safety: with DEPS_DROP_TELEMETRY=1, statements that insert into the shared table telemetry.events are not sent
 *    (they answer as an empty success). The app's metrics flusher writes "infra.check" and "metric.*" rows there every
 *    60 s whenever it has a PostgreSQL pool; from a test process those rows would show our injected outages on the
 *    production dashboard. Counts go to DEPS_PRELOAD_LOG (one JSON line per event, no hosts, no statement text).
 *
 * Nothing here prints host names, addresses or credentials.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload (node --require) */
"use strict";
const dns = require("node:dns");
const fs = require("node:fs");

const map = (() => {
  try {
    return JSON.parse(process.env.DEPS_DNS_MAP || "{}");
  } catch {
    return {};
  }
})();
const logFile = process.env.DEPS_PRELOAD_LOG;
const note = (o) => {
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...o }) + "\n");
  } catch {
    /* ignore */
  }
};
const counts = { mapped: 0, dropped: 0 };
const seen = {};

if (Object.keys(map).length) {
  const origLookup = dns.lookup;
  dns.lookup = function lookup(hostname, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if (typeof options === "number") options = { family: options };
    options = options || {};
    const ip = typeof hostname === "string" ? map[hostname] : undefined;
    if (!ip) return origLookup.call(dns, hostname, options, callback);
    counts.mapped++;
    const idx = Object.keys(map).indexOf(hostname);
    seen[idx] = (seen[idx] || 0) + 1;
    if (seen[idx] === 1 || counts.mapped % 50 === 0) note({ event: "dns_mapped", hostIndex: idx, count: counts.mapped });
    if (options.all) process.nextTick(callback, null, [{ address: ip, family: 4 }]);
    else process.nextTick(callback, null, ip, 4);
    return {};
  };
  const origPromise = dns.promises.lookup;
  dns.promises.lookup = function lookup(hostname, options) {
    const ip = typeof hostname === "string" ? map[hostname] : undefined;
    if (!ip) return origPromise.call(dns.promises, hostname, options);
    counts.mapped++;
    const o = typeof options === "number" ? { family: options } : options || {};
    return Promise.resolve(o.all ? [{ address: ip, family: 4 }] : { address: ip, family: 4 });
  };
  note({ event: "dns_preload_on", hosts: Object.keys(map).length });
}

// 1b. Address literals (Kafka advertises its brokers as IP addresses, so DNS never sees them): DEPS_CONNECT_MAP
//     (JSON {"<ip>:<port>": <local port>}) sends those connections to 127.0.0.1:<local port>, a proxy of ours.
const connectMap = (() => {
  try {
    return JSON.parse(process.env.DEPS_CONNECT_MAP || "{}");
  } catch {
    return {};
  }
})();
if (Object.keys(connectMap).length) {
  const net = require("node:net");
  const origConnect = net.Socket.prototype.connect;
  const rewritten = {};
  net.Socket.prototype.connect = function connect(...args) {
    let opts = args[0];
    if (Array.isArray(opts)) opts = opts[0]; // internal normalized form
    if (opts && typeof opts === "object" && !Array.isArray(opts) && opts.host && opts.port !== undefined) {
      const local = connectMap[`${opts.host}:${opts.port}`];
      if (local) {
        const key = `${opts.host}:${opts.port}`;
        if (!rewritten[key]) note({ event: "connect_mapped", target: Object.keys(connectMap).indexOf(key) });
        rewritten[key] = (rewritten[key] || 0) + 1;
        const copy = { ...opts, host: "127.0.0.1", port: local };
        if (Array.isArray(args[0])) args[0] = [copy, ...args[0].slice(1)];
        else args[0] = copy;
      }
    } else if ((typeof opts === "number" || typeof opts === "string") && typeof args[1] === "string") {
      const local = connectMap[`${args[1]}:${opts}`];
      if (local) {
        args[0] = local;
        args[1] = "127.0.0.1";
      }
    }
    return origConnect.apply(this, args);
  };
  note({ event: "connect_map_on", targets: Object.keys(connectMap).length });
}

if (process.env.DEPS_DROP_TELEMETRY === "1") {
  try {
    const pgPath = require.resolve("pg", { paths: [process.cwd()] });
    const pg = require(pgPath);
    const isTelemetryInsert = (q) => {
      const text = typeof q === "string" ? q : q && typeof q.text === "string" ? q.text : "";
      return /insert\s+into\s+telemetry\.events/i.test(text);
    };
    const patch = (Proto, label) => {
      const orig = Proto.query;
      Proto.query = function query(config, values, callback) {
        if (isTelemetryInsert(config)) {
          counts.dropped++;
          note({ event: "telemetry_insert_dropped", via: label, count: counts.dropped });
          const result = { command: "INSERT", rowCount: 0, rows: [], fields: [] };
          const cb = typeof values === "function" ? values : typeof callback === "function" ? callback : undefined;
          if (cb) {
            process.nextTick(cb, null, result);
            return undefined;
          }
          return Promise.resolve(result);
        }
        return orig.apply(this, arguments);
      };
    };
    patch(pg.Client.prototype, "client");
    patch(pg.Pool.prototype, "pool");
    note({ event: "telemetry_guard_on" });
  } catch (err) {
    note({ event: "telemetry_guard_failed", error: String((err && err.code) || err) });
  }
}
