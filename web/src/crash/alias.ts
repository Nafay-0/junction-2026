/**
 * Dock mints random ids (req_, qt_, ord_, apr_) and signs tokens over them, so two runs of the same agent on the
 * same world differ only in those strings. Trajectories replace each with a stable alias in order of first
 * appearance (ord_1, jws_1, hash_1), so identical behaviour gives byte-identical trajectories. The mapping is
 * consistent inside one trajectory: an agent passing a quote token back appears as passing the same alias.
 */
const PATTERNS: { re: RegExp; name: (m: string) => string }[] = [
  { re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/g, name: () => "jws" },
  { re: /\b(req|qt|ord|apr|pref)_[0-9a-f]{16}\b/g, name: (m) => m.split("_")[0] },
  { re: /\b[0-9a-f]{64}\b/g, name: () => "hash" },
  { re: /token=[A-Za-z0-9_-]{20,}/g, name: () => "token=link" },
];

export class Aliaser {
  private map = new Map<string, string>();
  private counts = new Map<string, number>();

  private alias(raw: string, kind: string): string {
    let a = this.map.get(raw);
    if (!a) {
      const n = (this.counts.get(kind) ?? 0) + 1;
      this.counts.set(kind, n);
      a = `${kind}_${n}`;
      this.map.set(raw, a);
    }
    return a;
  }

  text(s: string): string {
    let out = s;
    for (const p of PATTERNS) out = out.replace(p.re, (m) => this.alias(m, p.name(m)));
    return out;
  }

  value<T>(v: T): T {
    if (typeof v === "string") return this.text(v) as T;
    if (Array.isArray(v)) return v.map((x) => this.value(x)) as T;
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = this.value(x);
      return out as T;
    }
    return v;
  }
}
