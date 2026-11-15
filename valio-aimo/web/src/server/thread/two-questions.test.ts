import { describe, expect, it } from "vitest";
import { whichQuestion } from "./two-questions";

const MAIL = "Shall I email the receipt? I'd need an address.";
const OFFER = "Shall I add it to your order?";

describe("two questions open after one reply", () => {
  it("the buyer's words decide which they answer", () => {
    const line = `I've ordered it. ${MAIL} The wholesaler suggests Valio milk at 42,42 €. ${OFFER}`;
    expect(whichQuestion("Yes, add it.", line, MAIL, OFFER)).toBe("offer");
    expect(whichQuestion("yes, email it", line, MAIL, OFFER)).toBe("mail");
    expect(whichQuestion("send the receipt", line, MAIL, OFFER)).toBe("mail");
    expect(whichQuestion("lisää se", line, MAIL, OFFER)).toBe("offer");
  });
  it("a plain yes goes to the question asked last; nothing else is taken as an answer", () => {
    expect(whichQuestion("yes", `I've ordered it. ${MAIL} Valio milk at 42,42 €. ${OFFER}`, MAIL, OFFER)).toBe("offer");
    expect(whichQuestion("yes", `Valio milk at 42,42 €. ${OFFER} I've ordered it. ${MAIL}`, MAIL, OFFER)).toBe("mail");
    expect(whichQuestion("yes", `I've ordered it. ${MAIL}`, MAIL, undefined)).toBe("mail");
    expect(whichQuestion("what time does it come?", `I've ordered it. ${MAIL}`, MAIL, OFFER)).toBeUndefined();
  });
});
