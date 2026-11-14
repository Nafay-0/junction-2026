import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import search from "./search-eval.json";

/** Every search figure on the landing page is the document's: a row that drifts from smart-search.md fails here. */
describe("the landing page's search figures", () => {
  const doc = readFileSync(path.join(process.cwd(), "docs", "smart-search.md"), "utf8");
  const rows = doc
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim().replace(/\*\*/g, "")));

  for (const r of search.rows) {
    it(`${r.label} matches the "${r.docRow}" row`, () => {
      const row = rows.find((c) => c[0] === r.docRow);
      expect(row, r.docRow).toBeDefined();
      // configuration | right first | in top 3 | recall | dropped | stand-in as match | "not sold" | ...
      const [, first, top3, , dropped, standin, notSold] = row!;
      expect(first).toBe(`${r.rightFirst}%`);
      expect(top3).toBe(`${r.top3}%`);
      expect(Number(dropped)).toBe(r.dropped);
      expect(Number(standin)).toBe(r.standinAsMatch);
      expect(notSold).toBe(`${r.notSold}/${search.notSoldOf}`);
    });
  }

  it("names the same number of requests and products as the document", () => {
    expect(doc).toContain(`${search.requests} requests`);
    expect(doc).toContain(search.products.toLocaleString("en-US"));
  });
});
