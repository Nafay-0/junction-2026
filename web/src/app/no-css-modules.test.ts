import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * next.config.ts hands every *.css file to Tailwind as plain CSS. A CSS module then builds without error, but its
 * import carries no class names, so every `css.name` renders as the word "undefined" and the styles never apply.
 * That shipped once (the wall's gate animations). Use a global stylesheet with a prefix instead.
 */
function cssModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssModules(join(dir, e.name)) : e.name.endsWith(".module.css") ? [join(dir, e.name)] : [],
  );
}

describe("stylesheets", () => {
  it("has no CSS modules under src", () => {
    expect(cssModules(join(process.cwd(), "src"))).toEqual([]);
  });
});
