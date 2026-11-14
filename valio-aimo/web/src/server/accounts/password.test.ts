import { describe, expect, it } from "vitest";
import { PASSWORD_MIN, dummyHash, hashPassword, passwordProblem, verifyPassword } from "./password";

describe("passwords (scrypt)", () => {
  it("stores a salted scrypt hash, never the password, and verifies only the right one", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^scrypt\$15\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(h).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("correct horse batterY", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });

  it("salts every hash: the same password hashes differently twice", async () => {
    const [a, b] = await Promise.all([hashPassword("the same password"), hashPassword("the same password")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("the same password", a)).toBe(true);
    expect(await verifyPassword("the same password", b)).toBe(true);
  });

  it("a malformed or tampered hash verifies nothing and never throws", async () => {
    const h = await hashPassword("a long enough one");
    for (const bad of ["", "-", "plain", "scrypt$15$8$1$x", h.replace("scrypt$15", "scrypt$40"), h.slice(0, -3), `bcrypt${h.slice(6)}`]) {
      expect(await verifyPassword("a long enough one", bad)).toBe(false);
    }
  });

  it("the dummy hash, checked for unknown usernames, matches no password", async () => {
    const d = await dummyHash();
    expect(await verifyPassword("", d)).toBe(false);
    expect(await verifyPassword("anything at all", d)).toBe(false);
    expect(await dummyHash()).toBe(d);
  });

  it("asks only for a length: at least 10 characters, at most 200", () => {
    expect(PASSWORD_MIN).toBe(10);
    expect(passwordProblem(undefined)).toBe("password_missing");
    expect(passwordProblem("")).toBe("password_missing");
    expect(passwordProblem("123456789")).toBe("password_too_short");
    expect(passwordProblem("1234567890")).toBeUndefined();
    expect(passwordProblem("aaaaaaaaaa")).toBeUndefined(); // nothing fancier than length
    expect(passwordProblem("x".repeat(201))).toBe("password_too_long");
  });
});
