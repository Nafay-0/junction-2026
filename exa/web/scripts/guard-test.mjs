// Table test of the live browser's safety rules (src/lib/browser/guard.ts): which steps are refused, which need
// the user's approval, which go through. No browser needed. Run: pnpm test:guard
import { judge } from "../src/lib/browser/guard.ts";
const base = { tag: "button", type: "", role: "", autocomplete: "", text: "", name: "", hint: "", frameHost: "shop.example", frameUrl: "https://shop.example/x", inFrame: false, submits: false, formSubmitText: "", nearPayment: false, search: false, consent: false };
const t = (o) => ({ ...base, ...o });
const cases = [
  ["click Add to basket", { action: "click" }, t({ text: "Add to basket" }), "allow"],
  ["click Go to checkout", { action: "click" }, t({ text: "Go to checkout" }), "allow"],
  ["click Proceed to payment", { action: "click" }, t({ text: "Proceed to payment" }), "allow"],
  ["click Search", { action: "click" }, t({ text: "Search", submits: true, search: true }), "allow"],
  ["click Book a table (link)", { action: "click" }, t({ tag: "a", text: "Book a table" }), "allow"],
  ["click Confirm reservation", { action: "click" }, t({ text: "Confirm reservation", submits: true }), "approve"],
  ["click Send message", { action: "click" }, t({ text: "Send message", submits: true }), "approve"],
  ["click Save changes", { action: "click" }, t({ text: "Save changes", submits: true }), "approve"],
  ["click Delete my account", { action: "click" }, t({ text: "Delete my account" }), "approve"],
  ["click Varaa pöytä (submit)", { action: "click" }, t({ text: "Vahvista varaus", submits: true }), "approve"],
  ["click Apply filters", { action: "click" }, t({ text: "Apply filters" }), "allow"],
  ["click Only necessary", { action: "click" }, t({ text: "Only necessary", consent: true }), "allow"],
  ["click Accept all", { action: "click" }, t({ text: "Accept all", consent: true }), "approve"],
  ["click Use necessary cookies only", { action: "click" }, t({ text: "Use necessary cookies only", consent: true }), "allow"],
  ["click Kiellä", { action: "click" }, t({ text: "Kiellä", consent: true }), "allow"],
  ["click Show details (banner)", { action: "click" }, t({ tag: "a", text: "Show details", consent: true }), "allow"],
  ["click Allow all cookies", { action: "click" }, t({ text: "Allow all cookies", consent: true }), "approve"],
  ["click OK (banner)", { action: "click" }, t({ text: "OK", consent: true }), "approve"],
  ["click Hyväksy kaikki", { action: "click" }, t({ text: "Hyväksy kaikki", consent: true }), "approve"],
  ["click Pay now 249,00 €", { action: "click" }, t({ text: "Pay now 249,00 €", submits: true, nearPayment: true }), "block"],
  ["click Place order", { action: "click" }, t({ text: "Place order" }), "block"],
  ["click Maksa", { action: "click" }, t({ text: "Maksa" }), "block"],
  ["click Buy with Apple Pay", { action: "click" }, t({ text: "Apple Pay" }), "block"],
  ["click Continue (form with card fields, submit)", { action: "click" }, t({ text: "Continue", submits: true, nearPayment: true }), "block"],
  ["type into card number", { action: "type" }, t({ tag: "input", autocomplete: "cc-number", name: "Card number", hint: "cardnumber Card number" }), "block"],
  ["type into CVC by label", { action: "type" }, t({ tag: "input", name: "Security code (CVC)", hint: "cvc Security code (CVC)" }), "block"],
  ["type into password", { action: "type" }, t({ tag: "input", type: "password", name: "Password" }), "block"],
  ["type into one-time code", { action: "type" }, t({ tag: "input", autocomplete: "one-time-code", name: "Code" }), "block"],
  ["type into name", { action: "type" }, t({ tag: "input", name: "Full name", hint: "name Full name" }), "allow"],
  ["type into email", { action: "type" }, t({ tag: "input", type: "email", name: "Email", hint: "email Email" }), "allow"],
  ["type + Enter in search", { action: "type", enter: true }, t({ tag: "input", type: "search", search: true, formSubmitText: "Search" }), "allow"],
  ["type + Enter in a form that sends", { action: "type", enter: true }, t({ tag: "input", formSubmitText: "Send message" }), "approve"],
  ["type + Enter in checkout form", { action: "type", enter: true }, t({ tag: "input", nearPayment: true, formSubmitText: "Pay now" }), "block"],
  ["click anything on paypal.com", { action: "click" }, t({ text: "Next" }), "block", "https://www.paypal.com/checkout"],
  ["click anything on accounts.google.com", { action: "click" }, t({ text: "Next" }), "block", "https://accounts.google.com/v3/signin/identifier"],
  ["type an email on accounts.google.com", { action: "type" }, t({ tag: "input", type: "email", name: "Email or phone" }), "block", "https://accounts.google.com/v3/signin/identifier"],
  ["pick an account on Microsoft's sign-in", { action: "click" }, t({ text: "someone@example.com" }), "block", "https://login.microsoftonline.com/common/oauth2/authorize"],
  ["click on a site that merely mentions google", { action: "click" }, t({ tag: "a", text: "Sign in with Google" }), "allow", "https://shop.example/login?next=accounts.google.com"],
  ["click with commits flag", { action: "click", commits: true }, t({ tag: "a", text: "Yes" }), "approve"],
  ["select delivery", { action: "select" }, t({ tag: "select", name: "Delivery" }), "allow"],
  ["click in Stripe card frame", { action: "click" }, t({ tag: "input", inFrame: true, frameHost: "js.stripe.com", frameUrl: "https://js.stripe.com/v3/elements-inner-card-abc.html", name: "Card number", hint: "cardnumber" }), "block"],
];
let bad = 0;
for (const [name, step, target, want, url] of cases) {
  const got = judge(step, target, url ?? "https://shop.example/x").decision;
  if (got !== want) { bad++; console.log(`WRONG  ${name}: wanted ${want}, got ${got}`); }
}
console.log(bad ? `${bad} of ${cases.length} wrong` : `all ${cases.length} rules behave as intended`);
process.exitCode = bad ? 1 : 0;
