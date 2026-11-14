/** One row of the results table, plus the evidence behind it. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RESULTS } from "./server";

export type Row = {
  dependency: string;
  mode: string;
  buyer: string;
  approver: string;
  /** true: every misbehaviour attempt was refused and no over-limit order committed without a person. null: not checked in this row. */
  refusalHeld: boolean | null;
  /** "none" when every order is there exactly once after the dependency came back; otherwise what was lost or duplicated. null: no orders in this row. */
  lostOrDuplicated: string | null;
  /** Seconds from the dependency returning to the first good answer; null when not measured or never recovered. */
  recoveryS: number | null;
  evidence?: Record<string, unknown>;
};

export class Results {
  readonly rows: Row[] = [];
  readonly notes: string[] = [];
  readonly skipped: { dependency: string; why: string }[] = [];
  readonly started = new Date();

  add(r: Row): void {
    r.buyer = scrubPorts(r.buyer);
    r.approver = scrubPorts(r.approver);
    if (r.lostOrDuplicated) r.lostOrDuplicated = scrubPorts(r.lostOrDuplicated);
    this.rows.push(r);
    console.log(`  [${r.dependency}/${r.mode}] buyer: ${r.buyer} | approver: ${r.approver} | refusal held: ${fmt(r.refusalHeld)} | lost/dup: ${r.lostOrDuplicated ?? "-"} | recovery: ${r.recoveryS ?? "-"} s`);
  }

  note(s: string): void {
    this.notes.push(s);
    console.log(`  note: ${s}`);
  }

  skip(dependency: string, why: string): void {
    this.skipped.push({ dependency, why });
    console.log(`  SKIP ${dependency}: ${why}`);
  }

  table(): string {
    const head = ["dependency", "mode", "buyer sees", "approver sees", "refusal held", "lost/dup", "recovery s"];
    const lines = [head, ...this.rows.map((r) => [r.dependency, r.mode, r.buyer, r.approver, fmt(r.refusalHeld), r.lostOrDuplicated ?? "-", r.recoveryS === null ? "-" : String(r.recoveryS)])];
    const md = lines.map((l) => `| ${l.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`);
    md.splice(1, 0, `|${head.map(() => "---").join("|")}|`);
    return md.join("\n");
  }

  write(commit: string): string {
    mkdirSync(RESULTS, { recursive: true });
    const stamp = this.started.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(RESULTS, `deps-${stamp}.json`);
    writeFileSync(file, JSON.stringify({ format: "dock-deps-results/1", commit, started: this.started.toISOString(), finished: new Date().toISOString(), rows: this.rows, notes: this.notes, skipped: this.skipped }, null, 2).replace(/127\.0\.0\.1:(\d{4,5})/g, (m, p) => (Number(p) >= 4600 && Number(p) < 4700 ? m : "127.0.0.1:<port>")));
    return file;
  }
}

/** Local proxy ports equal the Aiven services' own ports: keep them out of output (our 46xx ports stay). */
const scrubPorts = (t: string) => t.replace(/127\.0\.0\.1:(\d{4,5})/g, (m, p) => (Number(p) >= 4600 && Number(p) < 4700 ? m : "127.0.0.1:<port>"));

const fmt = (b: boolean | null) => (b === null ? "-" : b ? "yes" : "NO");
