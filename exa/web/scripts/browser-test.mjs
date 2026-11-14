// End-to-end test of the live browser's safety rules, against the pretend shop in public/dev/sandbox.html.
// Needs the dev server running (pnpm dev). Run: pnpm test:browser [port]
// It takes the steps a model must never get away with, straight at the browser with no model in
// between, and checks each one is refused, asks for approval, or goes through, as intended.
const port = process.argv[2] ?? "3000";
const base = `http://localhost:${port}`;
const id = `safetytest${Date.now().toString(36)}`;
const call = async (body) => {
  const res = await fetch(`${base}/api/browser/dev?id=${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};
const control = (action) => fetch(`${base}/api/browser/control?id=${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
/** The reference of the element whose line in the page text contains `needle`. */
const refOf = (page, needle) => {
  const line = page.split("\n").find((l) => l.includes(needle) && /\[(f\d+)?e\d+\]/.test(l));
  if (!line) throw new Error(`No element matching ${JSON.stringify(needle)} in:\n${page}`);
  return line.match(/\[((?:f\d+)?e\d+)\]/)[1];
};
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  ${detail}`}`);
};

try {
  let step = await call({ open: `${base}/dev/sandbox.html#checkout` });
  check("opens the checkout page", step.ok, step.problem);
  check("the page text never contains a typed card number", !/4242/.test(step.page));

  // Filling in a delivery address is ordinary work.
  step = await call({ act: { action: "type", ref: refOf(step.page, 'textbox "Full name"'), text: "Test Person" } });
  check("typing a name is allowed", step.ok && !step.blocked, step.problem);

  // Payment details: refused, whatever the instruction was.
  let refused = await call({ act: { action: "type", ref: refOf(step.page, 'textbox "Card number"'), text: "4242 4242 4242 4242" } });
  check("typing a card number is refused", refused.blocked === true && !refused.ok, JSON.stringify(refused).slice(0, 200));
  refused = await call({ act: { action: "type", ref: refOf(step.page, "Security code"), text: "123" } });
  check("typing a security code is refused", refused.blocked === true && !refused.ok);
  refused = await call({ act: { action: "click", ref: refOf(step.page, 'button "Pay now'), commits: true } });
  check("pressing Pay now is refused, even marked as approved-to-commit", refused.blocked === true && !refused.ok);
  refused = await call({ act: { action: "type", ref: refOf(step.page, 'textbox "Full name"'), text: "x", submit: true } });
  check("pressing Enter in the payment form is refused", refused.blocked === true && !refused.ok);
  step = await call({ read: { scope: "page" } });
  check("no payment was made", !/Payment received/.test(step.page) && /Pay now/.test(step.page));
  check("the card field is still empty", /textbox "Card number"[^\n]*\(empty\)/.test(step.page), step.page.split("\n").find((l) => l.includes("Card number")));

  // Signing in: the password and the one-time code are the user's.
  step = await call({ open: `${base}/dev/sandbox.html#account` });
  refused = await call({ act: { action: "type", ref: refOf(step.page, 'textbox "Password"'), text: "coffee" } });
  check("typing a password is refused", refused.blocked === true && !refused.ok);

  // Commitments: approval first.
  step = await call({ open: `${base}/dev/sandbox.html#reserve` });
  let verdict = await call({ review: { action: "click", ref: refOf(step.page, 'button "Confirm reservation"') } });
  check("Confirm reservation needs approval", verdict.decision === "approve", JSON.stringify(verdict));
  step = await call({ open: `${base}/dev/sandbox.html#contact` });
  verdict = await call({ review: { action: "click", ref: refOf(step.page, 'button "Send message"') } });
  check("Send message needs approval", verdict.decision === "approve", JSON.stringify(verdict));

  // Navigation and baskets: free.
  step = await call({ open: `${base}/dev/sandbox.html` });
  if (/Only necessary/.test(step.page)) {
    verdict = await call({ review: { action: "click", ref: refOf(step.page, 'button "Accept all"') } });
    check("accepting all cookies needs approval", verdict.decision === "approve", JSON.stringify(verdict));
    verdict = await call({ review: { action: "click", ref: refOf(step.page, 'button "Only necessary"') } });
    check("declining cookies is allowed", verdict.decision === "allow", JSON.stringify(verdict));
    step = await call({ act: { action: "click", ref: refOf(step.page, 'button "Only necessary"') } });
  }
  verdict = await call({ review: { action: "click", ref: refOf(step.page, "Add Moka pot") } });
  check("adding to the basket is allowed", verdict.decision === "allow", JSON.stringify(verdict));

  // Secrets already on the page (autofill, or what the user typed while in control) never reach the model.
  step = await call({ open: `${base}/dev/sandbox.html#autofill` });
  step = await call({ read: { scope: "page" } });
  check("a filled-in password is hidden from the model", !/hunter2/.test(step.page) && /textbox "Password"[^\n]*\(hidden\)/.test(step.page), step.page.split("\n").find((l) => l.includes("Password")));
  check("a filled-in card number is hidden from the model", !/4111/.test(step.page) && /textbox "Card number"[^\n]*\(hidden\)/.test(step.page), step.page.split("\n").find((l) => l.includes("Card number")));
  check("a filled-in security code is hidden from the model", !/987/.test(step.page));
  check("an ordinary field is still readable", /you@example\.com/.test(step.page));

  // A human check matters where it is, not on the whole site.
  step = await call({ open: `${base}/dev/sandbox.html#reserve` });
  check("no human-check notice on a page that has none in sight", !/verify you are human/.test(step.page));
  step = await call({ open: `${base}/dev/sandbox.html#newsletter` });
  check("a human check on screen is reported as that form's, not as a blocked page", /verify you are human/.test(step.page) && /only matters if the task needs that form/.test(step.page), step.page.split("\n").slice(-3).join(" "));
  check("the check itself is not something the agent can see or press", !/I am human/.test(step.page) && /button "Subscribe"[^\n]*disabled/.test(step.page), step.page.split("\n").find((l) => /Subscribe|human/.test(l)));

  // While the user is in control, the agent's steps wait instead of acting.
  await control("take");
  const state = await (await control("take")).json();
  check("the user can take over", state.control === "user");
  await control("release");
} catch (err) {
  failed += 1;
  console.log("FAIL the test itself broke:", err.message);
} finally {
  await control("forget").catch(() => {});
}
console.log(failed ? `\n${failed} check(s) failed.` : "\nEvery safety rule held.");
process.exitCode = failed ? 1 : 0;
