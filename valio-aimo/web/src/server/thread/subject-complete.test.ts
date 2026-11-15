import { describe, expect, it } from "vitest";
import { completesIncomplete } from "./subject";

describe("short words while a request waits for its amount", () => {
  it("complete it when they only give the amount or the day", () => {
    expect(completesIncomplete("lactose-free whipping cream", "5 litres")).toBe(true);
    expect(completesIncomplete("lactose-free whipping cream", "5 litres for Friday please")).toBe(true);
    expect(completesIncomplete("lactose-free whipping cream", "3 packs of the cream")).toBe(true);
    expect(completesIncomplete("laktoositonta kuohukermaa", "5 litraa perjantaiksi")).toBe(true);
  });
  it("are a new request when they name something else to buy", () => {
    expect(completesIncomplete("lactose-free whipping cream", "2 kg of chicken breast for Friday")).toBe(false);
    expect(completesIncomplete("lactose-free whipping cream", "10 litres of oat drink for Friday")).toBe(false);
    expect(completesIncomplete("lactose-free whipping cream", "1 kg of coffee beans")).toBe(false);
  });
});
