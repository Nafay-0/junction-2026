/**
 * A TCP forwarding proxy with a fault switch, for taking one Aiven service away from one app process.
 *
 * The app process gets `NODE_OPTIONS=--require tests-live/deps/dns-preload.cjs` with DEPS_DNS_MAP naming the
 * service's host name, so it connects to 127.0.0.1:<the service's own port>, where this proxy listens and passes
 * bytes through to the service's real address (resolved beforehand with the real resolver). TLS is end to end:
 * the app still sends the real host name (SNI) and checks the real certificate; the proxy sees only ciphertext.
 *
 * Modes:
 *   forward    pass bytes through (the service is "back"); connections held by a blackhole resume
 *   refuse     stop listening and cut every open connection: new connections get ECONNREFUSED
 *   reset      listen, but destroy every new connection at once; open connections are cut
 *   blackhole  a network partition: nothing moves in either direction (sockets paused, new connections accepted
 *              and held); nothing is lost, so when it ends TCP-like delivery resumes, unless a side gave up
 *
 * Nothing here logs addresses or bytes.
 */
import { createServer, connect, type Server, type Socket } from "node:net";

export type FaultMode = "forward" | "refuse" | "reset" | "blackhole";
export type ProxyStats = { accepted: number; forwarded: number; heldNew: number; resetNew: number; cut: number; bytesUp: number; bytesDown: number };

type Pair = { client: Socket; upstream?: Socket; waiting?: boolean };

export class FaultProxy {
  mode: FaultMode = "forward";
  modeSince = Date.now();
  readonly stats: ProxyStats = { accepted: 0, forwarded: 0, heldNew: 0, resetNew: 0, cut: 0, bytesUp: 0, bytesDown: 0 };
  private server: Server | undefined;
  private readonly pairs = new Set<Pair>();
  private listening = false;

  /**
   * `bySni`: when several host names share this port (Kafka's bootstrap and its brokers), the upstream is chosen
   * from the TLS ClientHello's server name; `targetIp` is the fallback.
   */
  constructor(
    private readonly listenPort: number,
    private readonly targetIp: string,
    private readonly targetPort: number,
    private readonly listenHost = "127.0.0.1",
    private readonly bySni: Record<string, string> = {},
  ) {}

  private wire(pair: Pair): void {
    if (Object.keys(this.bySni).length && !pair.upstream) {
      if (pair.waiting) return;
      pair.waiting = true;
      const { client } = pair;
      client.once("data", (first: Buffer) => {
        client.pause();
        const ip = this.bySni[sniOf(first) ?? ""] ?? this.targetIp;
        this.connectUp(pair, ip, first);
      });
      client.resume();
      return;
    }
    this.connectUp(pair, this.targetIp);
  }

  private connectUp(pair: Pair, ip: string, first?: Buffer): void {
    const { client } = pair;
    const up = connect({ host: ip, port: this.targetPort });
    if (first) {
      this.stats.bytesUp += first.length;
      up.write(first);
    }
    pair.upstream = up;
    this.stats.forwarded++;
    up.on("error", () => client.destroy());
    up.on("close", () => client.destroy());
    client.on("data", (b) => {
      this.stats.bytesUp += b.length;
      if (!up.write(b)) client.pause();
    });
    up.on("drain", () => this.mode === "forward" && client.resume());
    up.on("data", (b) => {
      this.stats.bytesDown += b.length;
      if (!client.write(b)) up.pause();
    });
    client.on("drain", () => this.mode === "forward" && up.resume());
    if (this.mode === "blackhole") {
      client.pause();
      up.pause();
    } else client.resume();
  }

  private makeServer(): Server {
    return createServer({ pauseOnConnect: true }, (client) => {
      this.stats.accepted++;
      const pair: Pair = { client };
      this.pairs.add(pair);
      client.on("close", () => {
        pair.upstream?.destroy();
        this.pairs.delete(pair);
      });
      client.on("error", () => undefined);
      if (this.mode === "reset") {
        this.stats.resetNew++;
        client.resetAndDestroy();
        return;
      }
      if (this.mode === "blackhole") {
        this.stats.heldNew++; // accepted, held paused; wired when the partition ends
        return;
      }
      this.wire(pair);
    });
  }

  async start(): Promise<void> {
    await this.listen();
  }

  private listen(): Promise<void> {
    if (this.listening) return Promise.resolve();
    this.server = this.makeServer();
    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.listenPort, this.listenHost, () => {
        this.listening = true;
        resolve();
      });
    });
  }

  private unlisten(): Promise<void> {
    if (!this.listening || !this.server) return Promise.resolve();
    this.listening = false;
    const s = this.server;
    return new Promise((resolve) => s.close(() => resolve()));
  }

  /** Cut every open connection (both sides). */
  cutAll(): void {
    for (const p of this.pairs) {
      this.stats.cut++;
      if (!p.client.destroyed) p.client.resetAndDestroy();
      p.upstream?.destroy();
    }
    this.pairs.clear();
  }

  async setMode(mode: FaultMode): Promise<void> {
    const was = this.mode;
    this.mode = mode;
    this.modeSince = Date.now();
    if (mode === "refuse") {
      this.cutAll();
      await this.unlisten();
    } else if (mode === "reset") {
      this.cutAll();
      await this.listen();
    } else if (mode === "blackhole") {
      for (const p of this.pairs) {
        p.client.pause();
        p.upstream?.pause();
      }
      await this.listen();
    } else {
      await this.listen();
      if (was === "blackhole")
        for (const p of this.pairs) {
          if (p.client.destroyed) continue;
          if (!p.upstream) this.wire(p);
          else {
            p.client.resume();
            p.upstream.resume();
          }
        }
    }
  }

  async stop(): Promise<void> {
    this.cutAll();
    await this.unlisten();
  }

  get openConnections(): number {
    return this.pairs.size;
  }
}

/** The server name (SNI) of a TLS ClientHello, or undefined. */
export function sniOf(b: Buffer): string | undefined {
  try {
    if (b[0] !== 0x16 || b[5] !== 0x01) return undefined;
    let i = 5 + 4 + 2 + 32; // handshake header, client version, random
    i += 1 + b[i]; // session id
    i += 2 + b.readUInt16BE(i); // cipher suites
    i += 1 + b[i]; // compression methods
    const end = i + 2 + b.readUInt16BE(i);
    i += 2;
    while (i + 4 <= end) {
      const type = b.readUInt16BE(i);
      const len = b.readUInt16BE(i + 2);
      if (type === 0) {
        const nameLen = b.readUInt16BE(i + 7);
        return b.subarray(i + 9, i + 9 + nameLen).toString("ascii");
      }
      i += 4 + len;
    }
  } catch {
    /* not a ClientHello */
  }
  return undefined;
}
