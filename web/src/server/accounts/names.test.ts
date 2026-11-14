import { describe, expect, it } from "vitest";
import { cleanRestaurantName, normaliseUsername, usernameProblem } from "./names";

describe("usernames and restaurant names", () => {
  it("normalises: NFKC, trimmed, lower case", () => {
    expect(normaliseUsername("  Hotel-Aurora ")).toBe("hotel-aurora");
    expect(normaliseUsername("ＫＡＡＲＩ")).toBe("kaari"); // full-width letters fold to ASCII, then hit the reserved list
    expect(normaliseUsername(42)).toBe("");
  });

  it("allows only a safe alphabet, 3 to 32 characters, starting with a letter or digit", () => {
    for (const ok of ["abc", "ravintola-aalto", "cafe_2", "x".repeat(32), "9lives"]) expect(usernameProblem(ok)).toBeUndefined();
    for (const bad of ["ab", "x".repeat(33), "-abc", "_abc", "a b", "kahvila.sointu", "käkö", "a/b", "<script>", "a%2f", "admin​"]) {
      expect(usernameProblem(normaliseUsername(bad))).toBe(bad === "" ? "username_missing" : "username_shape");
    }
    expect(usernameProblem("")).toBe("username_missing");
  });

  it("refuses the names the store and its kitchens use", () => {
    for (const r of ["kaari", "laakso", "mine", "signup", "keep", "ops", "admin", "api", "sbx_abc", "sbxanything", "org_x1", "agent_x1"]) expect(usernameProblem(r)).toBe("username_reserved");
  });

  it("a restaurant name is trimmed, single-spaced, without control characters, 2 to 80 characters", () => {
    expect(cleanRestaurantName("  Ravintola   Aalto ")).toBe("Ravintola Aalto");
    expect(cleanRestaurantName("Bad\u0000Name‮")).toBe("BadName");
    expect(cleanRestaurantName("A")).toBeUndefined();
    expect(cleanRestaurantName("x".repeat(81))).toBeUndefined();
    expect(cleanRestaurantName(undefined)).toBeUndefined();
  });
});
