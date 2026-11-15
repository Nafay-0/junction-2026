import { describe, expect, it } from "vitest";
import { completesIncomplete } from "./subject";

describe("short words while a request waits for its amount", () => {
  it("complete it when they only give the amount or the day", () => {
    expect(completesIncomplete("lactose-free whipping cream", "5 litres")).toBe(true);
    expect(completesIncomplete("lactose-free whipping cream", "5 litres for Friday please")).toBe(true);
    expect(completesIncomplete("lactose-free whipping cream", "3 packs of the cream")).toBe(true);
    expect(completesIncomplete("laktoositonta kuohukermaa", "5 litraa perjantaiksi")).toBe(true);
  });
  it("complete it however the amount is said: hedged, spelled out, with a brand or a pointer back", () => {
    for (const said of ["about 5 litres", "five litres", "Five litres.", "5", "5 l", "make it 5 litres", "5 litres should do", "5 litres would be enough", "5 litres, Valio", "5 litres of the Valio one", "5 litres of whipped cream", "5 litres, same as last time", "we need 5 litres by Friday morning", "5 litres in total", "5 litres of that", "the usual", "yes"])
      expect(completesIncomplete("lactose-free whipping cream", said), said).toBe(true);
    expect(completesIncomplete("laktoositonta kuohukermaa", "5 litraa kiitos")).toBe(true);
    expect(completesIncomplete("laktosfri vispgrädde", "5 liter tack")).toBe(true);
  });
  it("are a new request when they name something else to buy", () => {
    expect(completesIncomplete("lactose-free whipping cream", "2 kg of chicken breast for Friday")).toBe(false);
    expect(completesIncomplete("lactose-free whipping cream", "10 litres of oat drink for Friday")).toBe(false);
    expect(completesIncomplete("lactose-free whipping cream", "1 kg of coffee beans")).toBe(false);
    expect(completesIncomplete("lactose-free whipping cream", "20 litres whole milk for Tuesday")).toBe(false);
    expect(completesIncomplete("laktoositonta kuohukermaa", "2 kg kananrintaa perjantaiksi")).toBe(false);
  });
});
