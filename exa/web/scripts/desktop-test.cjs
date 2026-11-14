// End-to-end test of the desktop app: the real app window, with its real browser view inside.
// Needs the server running. Run: pnpm test:desktop [port]
//
// This file is the app's main process for the length of the test: it loads desktop/main.cjs
// unchanged, in a throwaway profile (the sign-ins of the real app are never touched), signs in
// with the admin account from exa/.env.local, and then checks from the inside what a user would
// see and what the agent could do. The agent's steps are given straight to the app's engine, with
// no model in between, so the test asks for exactly the steps a model must never get away with.
//
// It covers: the view appears when a browser is asked for; it is an ordinary browser, not an
// automation one; the agent's clicks, keys and scrolling land where they aim; the safety rules
// (payment, passwords, pay buttons) refuse; a step that commits waits for the user's yes and is
// not taken on a no; secrets on the page never reach the agent; a human check is reported where
// it is; the user's own clicks and keys go to the page when it is their turn and not otherwise;
// hiding the pane does not lose the page; closing takes the view away.
//
// BERYL_TEST_SHOTS=<folder> saves pictures of the window along the way.
// BERYL_TEST_CHAT="<request>" then types that request into the app and lets the agent work on it.
const { app, BrowserWindow, webContents } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const port = process.argv.slice(2).find((a) => /^\d{2,5}$/.test(a)) ?? "3000";
const base = `http://localhost:${port}`;
const shots = process.env.BERYL_TEST_SHOTS;
process.env.BERYL_URL = base;
const envFile = path.join(__dirname, "../../.env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "beryl-desktop-test-"));
app.setPath("userData", profile);
process.on("exit", () => fs.rmSync(profile, { recursive: true, force: true }));
const { engine } = require("../desktop/main.cjs");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  ${detail ?? ""}`}`);
};
const until = async (probe, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const value = await Promise.resolve()
      .then(probe)
      .catch(() => undefined);
    if (value) return value;
    if (Date.now() - t0 > ms) return undefined;
    await wait(150);
  }
};
const refOf = (page, needle) => {
  const line = page.split("\n").find((l) => l.includes(needle) && /\[(f\d+)?e\d+\]/.test(l));
  if (!line) throw new Error(`No element matching ${JSON.stringify(needle)} in:\n${page}`);
  return line.match(/\[((?:f\d+)?e\d+)\]/)[1];
};

/* The agent's steps, handed to the engine as the interface would hand them over. */
let calls = 0;
const call = (tool, input = {}) => ({ tool, toolCallId: `test-${++calls}`, input });
const open = (url) => engine.run(call("browserOpen", { url }));
const act = (input) => engine.run(call("browserAct", input));
const read = (input = {}) => engine.run(call("browserRead", input));
const look = () => engine.run(call("browserLook"));

async function main() {
  await app.whenReady();
  const win = await until(() => BrowserWindow.getAllWindows()[0]);
  const host = win.webContents;
  const inHost = (js) => host.executeJavaScript(js, true);
  const guest = () => webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getType() === "webview");
  const inGuest = (js) => guest().executeJavaScript(js, true);
  let shot = 0;
  const picture = async (name) => {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    fs.writeFileSync(path.join(shots, `${String(++shot).padStart(2, "0")}-${name}.png`), (await win.capturePage()).toPNG());
  };

  await signIn(inHost);
  check("the app offers its browser to the interface", Boolean(await until(() => inHost("Boolean(window.berylDesktop && window.berylDesktop.browser && window.berylDesktop.browser.run)"))));
  check("the interface is up", Boolean(await until(() => inHost("Boolean(document.querySelector('textarea[aria-label=\"Message\"]'))"))));
  const viewBox = () =>
    inHost("(() => { const v = document.querySelector('webview'); if (!v) return null; const r = v.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, visible: r.x >= 0 && r.right > 0, partition: v.getAttribute('partition') }; })()");

  check("no browser before one is asked for", engine.state().status === "idle" && !guest() && (await viewBox()) === null);

  // Asking for a page is what makes the view appear: the whole handshake, as a task would start it.
  let step = await open(`${base}/dev/sandbox.html#reserve`);
  check("a page opens in the app's own browser view", step.ok && /Reserve a table/.test(step.page), step.problem);
  let box = await until(async () => {
    const b = await viewBox();
    return b && b.visible && b.width > 200 ? b : undefined;
  });
  check("the view is on screen beside the chat", Boolean(box), JSON.stringify(await viewBox()));
  check("sign-ins are kept in a store of this account's own", /^persist:beryl-[\w-]+$/.test(box?.partition ?? ""), box?.partition);
  const facts = await inGuest("({ webdriver: navigator.webdriver, agent: navigator.userAgent })");
  check("the view is an ordinary browser, not an automation one", facts.webdriver === false, JSON.stringify(facts));
  check("it tells sites it is Beryl, on Chrome", /Beryl\/[\d.]+ Chrome\/\d+/.test(facts.agent) && !/Electron|Headless/.test(facts.agent), facts.agent);

  // A narrow view is laid out at desktop width and drawn smaller.
  const sized = await until(async () => {
    const b = await viewBox();
    const want = b.width < 1280 ? 1280 : Math.round(b.width);
    return Math.abs(engine.state().viewport.width - want) <= 2;
  });
  check("the page is laid out to fit the view", Boolean(sized), JSON.stringify({ viewport: engine.state().viewport, view: await viewBox() }));
  box = await viewBox();
  const inner = await inGuest("({ width: innerWidth, height: innerHeight })");
  check("the whole page fits the view, nothing cut off", Math.abs(inner.height * (box.width / inner.width) - box.height) <= 3, JSON.stringify({ inner, box }));

  /* The agent works in it. */
  step = await act({ action: "type", ref: refOf(step.page, 'textbox "Name"'), text: "Asad Test" });
  check("the agent types into the page", step.ok && /Asad Test/.test(step.page), step.problem);
  check("and the page really has it", (await inGuest("[...document.querySelectorAll('input')].some((i) => i.value === 'Asad Test')")) === true);
  await picture("agent-typed");

  step = await open(`${base}/dev/sandbox.html`);
  if (/Only necessary/.test(step.page)) step = await act({ action: "click", ref: refOf(step.page, 'button "Only necessary"') });
  check("the agent's click lands on what it aimed at", step.ok && (await inGuest("!document.querySelector('#cookies') || getComputedStyle(document.querySelector('#cookies')).display === 'none'")) === true, step.problem);
  step = await look();
  check("the agent can look at the page", step.ok && typeof step.picture === "string" && step.picture.length > 5000, JSON.stringify({ ok: step.ok, picture: step.picture?.length, problem: step.problem }));

  const before = await inGuest("({ y: scrollY, room: document.documentElement.scrollHeight - innerHeight, screen: innerHeight })");
  step = await act({ action: "scroll", direction: "down" });
  const moved = (await inGuest("scrollY")) - before.y;
  const expected = Math.min(before.room, before.screen * 0.8);
  check("the agent scrolls by most of a screen", step.ok && (expected < 40 || Math.abs(moved - expected) <= Math.max(40, expected * 0.2)), JSON.stringify({ moved, expected, before }));

  // The app is a page with a browser inside it: the agent's keys must go to the browser, never to the chat box.
  step = await open(`${base}/dev/sandbox.html#reserve`);
  const nameValue = "[...document.querySelectorAll('input')].find((i) => /^(Keys Test|Keys Testz)$/.test(i.value))?.value";
  check("the chat box has the keyboard", (await inHost("(() => { const box = document.querySelector('textarea'); if (!box) return false; box.focus(); return document.activeElement === box; })()")) === true);
  step = await act({ action: "type", ref: refOf(step.page, 'textbox "Name"'), text: "Keys Test" });
  check("the agent's typing still goes to the page", step.ok && (await inGuest(nameValue)) === "Keys Test", step.problem);
  check("and none of it lands in the chat box", (await inHost("document.querySelector('textarea').value")) === "", await inHost("document.querySelector('textarea').value"));
  check("the chat box gets the keyboard back", Boolean(await until(() => inHost("document.activeElement === document.querySelector('textarea')"), 4000)));
  await inHost("document.querySelector('webview').focus(); 1");
  await inGuest("[...document.querySelectorAll('input')].find((i) => i.value === 'Keys Test').focus(); 1");
  for (const type of ["keyDown", "char", "keyUp"]) guest().sendInputEvent({ type, keyCode: "z" });
  await wait(300);
  check("while the agent drives, the user's keys do not reach the page", (await inGuest(nameValue)) === "Keys Test", await inGuest(nameValue));
  await inHost("document.querySelector('webview').blur(); 1");

  // The agent goes on working when the app is not in front.
  win.hide();
  await wait(600);
  step = await open(`${base}/dev/sandbox.html#contact`);
  const hidden = await act({ action: "hover", ref: refOf(step.page, 'button "Send message"') });
  check("the agent keeps working while the app is out of sight", step.ok && /Contact us/.test(step.page) && hidden.ok, hidden.problem ?? step.problem);
  win.show();
  await wait(600);

  /* The safety rules, in code, where the page is. */
  step = await open(`${base}/dev/sandbox.html#checkout`);
  check("the page text never contains a typed card number", !/4242/.test(step.page));
  let done = await act({ action: "type", ref: refOf(step.page, 'textbox "Full name"'), text: "Test Person" });
  check("typing a name is allowed", done.ok && !done.blocked, done.problem);
  let refused = await act({ action: "type", ref: refOf(step.page, 'textbox "Card number"'), text: "4242 4242 4242 4242" });
  check("typing a card number is refused", refused.blocked === true && !refused.ok);
  refused = await act({ action: "type", ref: refOf(step.page, "Security code"), text: "123" });
  check("typing a security code is refused", refused.blocked === true && !refused.ok);
  refused = await act({ action: "click", ref: refOf(step.page, 'button "Pay now'), commits: true });
  check("pressing Pay now is refused, even marked as a step to approve", refused.blocked === true && !refused.ok && !engine.state().approval);
  refused = await act({ action: "type", ref: refOf(step.page, 'textbox "Full name"'), text: "x", submit: true });
  check("pressing Enter in the payment form is refused", refused.blocked === true && !refused.ok);
  step = await read({ scope: "page" });
  check("no payment was made", !/Payment received/.test(step.page) && /Pay now/.test(step.page));
  check("the card field is still empty", /textbox "Card number"[^\n]*\(empty\)/.test(step.page), step.page.split("\n").find((l) => l.includes("Card number")));

  step = await open(`${base}/dev/sandbox.html#account`);
  refused = await act({ action: "type", ref: refOf(step.page, 'textbox "Password"'), text: "coffee" });
  check("typing a password is refused", refused.blocked === true && !refused.ok);

  // Secrets already on the page (autofill, or what the user typed) never reach the agent.
  await open(`${base}/dev/sandbox.html#autofill`);
  step = await read({ scope: "page" });
  check("a filled-in password is hidden from the agent", !/hunter2/.test(step.page) && /textbox "Password"[^\n]*\(hidden\)/.test(step.page), step.page.split("\n").find((l) => l.includes("Password")));
  check("a filled-in card number is hidden from the agent", !/4111/.test(step.page) && /textbox "Card number"[^\n]*\(hidden\)/.test(step.page), step.page.split("\n").find((l) => l.includes("Card number")));
  check("an ordinary field is still readable", /you@example\.com/.test(step.page));

  // A human check matters where it is, not on the whole site.
  step = await open(`${base}/dev/sandbox.html#reserve`);
  check("no human-check notice on a page that has none in sight", !/verify you are human/.test(step.page));
  step = await open(`${base}/dev/sandbox.html#newsletter`);
  check("a human check on screen is reported as that form's, not as a blocked page", /verify you are human/.test(step.page) && /only matters if the task needs that form/.test(step.page), step.page.split("\n").slice(-3).join(" "));
  check("the check itself is not something the agent can see or press", !/I am human/.test(step.page) && /button "Subscribe"[^\n]*disabled/.test(step.page), step.page.split("\n").find((l) => /Subscribe|human/.test(l)));

  /* A step that commits the user waits in the app for their yes, and is not taken on a no. */
  step = await open(`${base}/dev/sandbox.html#reserve`);
  const confirm = refOf(step.page, 'button "Confirm reservation"');
  let pending = call("browserAct", { action: "click", ref: confirm, summary: "Reserve a table for two (test)." });
  let outcome = engine.run(pending);
  check("Confirm reservation waits for approval", Boolean(await until(() => engine.state().approval?.toolCallId === pending.toolCallId, 6000)), JSON.stringify(engine.state().approval));
  check("the interface is told what will happen", engine.state().approval?.summary === "Reserve a table for two (test).");
  check("nothing has happened yet", (await inGuest("document.querySelector('#reserved').hidden")) === true);
  await picture("waiting-for-approval");
  await engine.control({ action: "approval", toolCallId: pending.toolCallId, approved: false });
  let result = await outcome;
  check("a no means the step is not taken", result.denied === true && !result.ok && (await inGuest("document.querySelector('#reserved').hidden")) === true && !engine.state().approval, JSON.stringify({ denied: result.denied, ok: result.ok }));
  check("asking for the same step again gives the same answer, not a second try", (await engine.run(pending)) === result);

  // Stopping the agent while a step waits counts as a no.
  pending = call("browserAct", { action: "click", ref: confirm });
  outcome = engine.run(pending);
  await until(() => engine.state().approval?.toolCallId === pending.toolCallId, 6000);
  engine.stop();
  result = await outcome;
  check("Stop while a step waits counts as a no", result.denied === true && (await inGuest("document.querySelector('#reserved').hidden")) === true);

  // And a yes takes it. (The form's own checks then decide: here the date is missing, so nothing is reserved.)
  step = await read();
  await act({ action: "type", ref: refOf(step.page, 'textbox "Name"'), text: "Asad Test" });
  await inGuest("(() => { const f = document.querySelector('#reserve-form'); f.querySelector('[name=date]').value = '2026-12-01'; f.querySelector('[name=time]').value = f.querySelector('[name=time] option:nth-child(2)').value; f.querySelector('[name=phone]').value = '040 1234567'; })()");
  step = await read();
  pending = call("browserAct", { action: "click", ref: refOf(step.page, 'button "Confirm reservation"') });
  outcome = engine.run(pending);
  await until(() => engine.state().approval?.toolCallId === pending.toolCallId, 6000);
  await engine.control({ action: "approval", toolCallId: pending.toolCallId, approved: true });
  result = await outcome;
  check("a yes takes the step", result.ok && /Reserved: a table/.test(result.page), result.problem ?? result.page.slice(0, 200));

  /* The user's turn. */
  const topAt = (b) => inHost(`(() => { const el = document.elementFromPoint(${b.x + b.width / 2}, ${b.y + b.height / 2}); return el ? el.tagName.toLowerCase() : ''; })()`);
  box = await viewBox();
  check("while the agent drives, the user's clicks do not reach the page", (await topAt(box)) !== "webview", await topAt(box));
  await engine.control({ action: "take" });
  check("after Take over, the page itself is under the pointer", Boolean(await until(async () => (await topAt(await viewBox())) === "webview")), await topAt(box));
  const waiting = await Promise.race([read().then(() => "answered"), wait(1500).then(() => "waiting")]);
  check("while the user is in control, the agent's steps wait", waiting === "waiting");

  // A real click and real keys, at the place the user would see the field (the page is drawn smaller).
  const place = async (selector) => {
    const b = await inGuest(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: innerWidth }; })()`);
    const drawn = (await viewBox()).width / b.width;
    return { x: Math.round(b.x * drawn), y: Math.round(b.y * drawn) };
  };
  const click = async (selector) => {
    const at = await place(selector);
    guest().sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
    guest().sendInputEvent({ type: "mouseDown", x: at.x, y: at.y, button: "left", clickCount: 1 });
    guest().sendInputEvent({ type: "mouseUp", x: at.x, y: at.y, button: "left", clickCount: 1 });
    await wait(250);
  };
  const keys = async (text) => {
    for (const ch of text) for (const type of ["keyDown", "char", "keyUp"]) guest().sendInputEvent({ type, keyCode: ch });
    await wait(250);
  };
  await engine.control({ action: "navigate", url: `${base}/dev/sandbox.html#account` });
  await until(() => inGuest("location.hash === '#account' && Boolean(document.querySelector('input[type=password]'))"));
  await click("input[type=password]");
  check("the user's click lands on the field they pointed at", (await inGuest("document.activeElement === document.querySelector('input[type=password]')")) === true, await inGuest("document.activeElement?.outerHTML.slice(0, 120)"));
  await keys("coffee");
  check("the user types their password straight into the page", (await inGuest("document.querySelector('input[type=password]').value")) === "coffee");
  await picture("user-in-control");
  await engine.control({ action: "release" });
  step = await read({ scope: "page" });
  const passwordLine = step.page.split("\n").find((l) => l.includes('textbox "Password"')) ?? "";
  check("and the agent never sees it", step.ok && /\(hidden\)/.test(passwordLine) && !/coffee/.test(passwordLine), passwordLine);

  // A link pressed in the interface opens in the app's own browser, with the user in control: no browser outside the app.
  await inHost("window.open('http://localhost:" + port + "/dev/sandbox.html#contact', '_blank'); 1");
  check("a link from the chat opens in the app's browser, with the user in control", Boolean(await until(async () => engine.state().control === "user" && /#contact/.test(engine.state().url))), JSON.stringify({ control: engine.state().control, url: engine.state().url }));
  check("and no other window was opened", BrowserWindow.getAllWindows().length === 1);
  await engine.control({ action: "release" });

  // Hiding the pane must not lose the page or stop the agent.
  const viewId = guest().id;
  await inHost("document.querySelector('[aria-label=\"Hide the browser\"]').click()");
  await wait(700);
  box = await viewBox();
  check("hiding the pane keeps the browser alive, out of sight", guest()?.id === viewId && Boolean(box) && !box.visible, JSON.stringify(box));
  step = await open(`${base}/dev/sandbox.html#contact`);
  step = await act({ action: "type", ref: refOf(step.page, 'textbox "Your name"'), text: "Out of sight" });
  check("and the agent carries on in it, typing included", step.ok && (await inGuest("[...document.querySelectorAll('input')].some((i) => i.value === 'Out of sight')")) === true, step.problem);
  check("the top bar offers to show it again", (await inHost("Boolean(document.querySelector('[aria-label=\"Show the browser\"]'))")) === true);
  await inHost("document.querySelector('[aria-label=\"Show the browser\"]')?.click()");
  box = await until(async () => {
    const b = await viewBox();
    return b && b.visible ? b : undefined;
  });
  check("showing it again brings back the same view, page and all", Boolean(box) && guest()?.id === viewId && (await inGuest("[...document.querySelectorAll('input')].some((i) => i.value === 'Out of sight')")) === true, JSON.stringify(await viewBox()));
  await wait(400);
  await picture("shown-again");

  // Closing takes the view away; asking again brings a new one.
  let state = await engine.control({ action: "close" });
  check("closing the browser", state.status === "closed", state.status);
  check("takes the view away", Boolean(await until(async () => !guest() && (await viewBox()) === null)));
  step = await open(`${base}/dev/sandbox.html#contact`);
  check("and the next task gets a view again", step.ok && /Contact us/.test(step.page) && Boolean(guest()), step.problem);
  await engine.control({ action: "close" });
  await until(async () => !guest());

  if (process.env.BERYL_TEST_CHAT) await chat(process.env.BERYL_TEST_CHAT, inHost, picture);

  const partition = await inHost("window.berylDesktop.browser.forget('persist:beryl-not-an-account/../x').then(() => 'ignored')");
  check("Forget sign-ins only ever touches an account's own store", partition === "ignored");
  return failed;
}

/** Sign in as the admin from exa/.env.local, through the app's own sign-in page. */
async function signIn(inHost) {
  const needsSignIn = await until(() => inHost("location.pathname.startsWith('/login') ? 'yes' : document.querySelector('textarea[aria-label=\"Message\"]') ? 'no' : ''"), 30000);
  if (needsSignIn !== "yes") return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are needed in exa/.env.local to sign in.");
  const fill = (selector, value) =>
    inHost(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await until(() => inHost("Boolean(document.querySelector('input[type=email]') && document.querySelector('input[type=password]'))"));
  await fill("input[type=email]", email);
  await fill("input[type=password]", password);
  await inHost("document.querySelector('form').requestSubmit(); 1");
  check("signing in to the app", Boolean(await until(() => inHost("!location.pathname.startsWith('/login') && Boolean(document.querySelector('textarea[aria-label=\"Message\"]'))"), 20000)));
}

/** One real request, typed into the app like a user would: the agent on the server, its browser steps in the app. */
async function chat(prompt, inHost, picture) {
  const t0 = Date.now();
  await inHost(`(() => { const box = document.querySelector('textarea[aria-label="Message"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(box, ${JSON.stringify(prompt)}); box.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await wait(200);
  await inHost("document.querySelector('button[aria-label=\"Send\"]').click(); 1");
  let last = "";
  let quietSince = 0;
  const settled = await until(async () => {
    const s = engine.state();
    const now = s.approval ? `approval: ${s.approval.summary}` : s.handover ? `hand-over: ${s.handover.kind} on ${s.handover.site ?? ""}` : s.activity || s.status;
    if (now !== last) {
      last = now;
      console.log("    ", `${((Date.now() - t0) / 1000).toFixed(1)}s`, now, s.url ? `| ${s.url.slice(0, 80)}` : "");
      void picture(`chat-${shotName(now)}`).catch(() => {});
    }
    // Between two steps the agent is briefly "not busy": it has finished only when that lasts.
    const busy = s.busy || (await inHost("Boolean(document.querySelector('button[aria-label=\"Stop\"]'))"));
    if (busy) quietSince = 0;
    else quietSince ||= Date.now();
    return s.approval || s.handover || (quietSince && Date.now() - quietSince > 4000 && Date.now() - t0 > 6000) ? "settled" : undefined;
  }, 180000);
  await wait(800);
  await picture("chat-settled");
  const s = engine.state();
  console.log("    ended with:", s.approval ? "a step waiting for approval" : s.handover ? "a hand-over to the user" : "the agent finished", "| page:", s.url.slice(0, 90));
  const text = await inHost("[...document.querySelectorAll('[data-role=assistant], article')].at(-1)?.innerText?.slice(0, 500) ?? ''");
  if (text) console.log("    last answer:", text.replace(/\n+/g, " "));
  check("the agent worked on the request in the app", settled === "settled");
}
const shotName = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);

main()
  .catch((err) => {
    failed += 1;
    console.log("FAIL the test itself broke:", err?.stack ?? err);
  })
  .finally(() => {
    console.log(failed ? `\n${failed} check(s) failed.` : "\nThe desktop app's browser behaves as intended.");
    app.exit(failed ? 1 : 0);
  });
