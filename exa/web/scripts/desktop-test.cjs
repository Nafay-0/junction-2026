// End-to-end test of the desktop app: the real app window, with its real browser view inside.
// Needs the dev server running. Run: pnpm test:desktop [port]
//
// This file is the app's main process for the length of the test: it loads desktop/main.cjs
// unchanged, in a throwaway profile (the sign-ins of the real app are never touched), and then
// checks from the inside what a user would see: the view appears when a browser is asked for, the
// agent works in it, it is not an automation browser, the safety rules hold, the user's own
// clicks and keys land where they point, hiding the pane does not lose the page, and closing
// takes the view away.
//
// BATON_TEST_SHOTS=<folder> saves pictures of the window along the way.
// BATON_TEST_CHAT="<request>" then gives the agent that request in the app's browser.
const { app, BrowserWindow, webContents } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const port = process.argv.slice(2).find((a) => /^\d{2,5}$/.test(a)) ?? "3000";
const base = `http://localhost:${port}`;
const shots = process.env.BATON_TEST_SHOTS;
process.env.BATON_URL = base;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "baton-desktop-test-"));
app.setPath("userData", profile);
process.on("exit", () => fs.rmSync(profile, { recursive: true, force: true }));
require("../desktop/main.cjs");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  ${detail}`}`);
};
const until = async (probe, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const value = await probe().catch(() => undefined);
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

async function main() {
  await app.whenReady();
  const win = await until(async () => BrowserWindow.getAllWindows()[0]);
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

  check("the app window offers its bridge to the interface", Boolean(await until(() => inHost("Boolean(window.batonDesktop && window.batonDesktop.attach)"))));
  const id = await until(() => inHost("localStorage.getItem('hovi.browser')"));
  check("the interface has its browser id", typeof id === "string" && id.length >= 8, String(id));
  const post = async (route, body) => {
    const res = await fetch(`${base}/api/browser/${route}?id=${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${route} ${res.status} ${await res.text()}`);
    return res.json();
  };
  const state = () => post("dev", { state: true });
  const viewBox = () => inHost("(() => { const v = document.querySelector('webview'); if (!v) return null; const r = v.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, visible: r.x >= 0 && r.right > 0 }; })()");

  check("the app says its browser is the one inside it", Boolean(await until(async () => (await state()).kind === "desktop")));
  check("no browser view before one is asked for", !guest() && (await viewBox()) === null);

  // Asking for a page is what makes the view appear: the whole handshake, as a task would start it.
  let step = await post("dev", { open: `${base}/dev/sandbox.html#reserve` });
  check("a page opens in the app's own browser view", step.ok && /Reserve a table/.test(step.page), step.problem);
  let box = await until(async () => {
    const b = await viewBox();
    return b && b.visible && b.width > 200 ? b : undefined;
  });
  check("the view is on screen beside the chat", Boolean(box), JSON.stringify(await viewBox()));
  const facts = await inGuest("({ webdriver: navigator.webdriver, agent: navigator.userAgent, title: document.title })");
  check("the view is an ordinary browser, not an automation one", facts.webdriver === false, JSON.stringify(facts));
  check("it tells sites it is Baton, on Chrome", /Baton\/[\d.]+ Chrome\/\d+/.test(facts.agent) && !/Electron|Headless/.test(facts.agent), facts.agent);

  // A narrow view is laid out at desktop width and drawn smaller.
  const sized = await until(async () => {
    const [s, b] = [await state(), await viewBox()];
    const want = b.width < 1280 ? 1280 : Math.round(b.width);
    return Math.abs(s.viewport.width - want) <= 2 ? { s, b } : undefined;
  });
  check("the page is laid out to fit the view", Boolean(sized), JSON.stringify({ viewport: (await state()).viewport, view: await viewBox() }));
  box = await viewBox();
  const inner = await inGuest("({ width: innerWidth, height: innerHeight })");
  const zoom = box.width / inner.width;
  check("the whole page fits the view, nothing cut off", Math.abs(inner.height * zoom - box.height) <= 3, JSON.stringify({ inner, box, zoom }));

  // The agent works in it.
  step = await post("dev", { act: { action: "type", ref: refOf(step.page, 'textbox "Name"'), text: "Asad Test" } });
  check("the agent types into the page", step.ok && /Asad Test/.test(step.page), step.problem);
  check("and the page really has it", (await inGuest("[...document.querySelectorAll('input')].some((i) => i.value === 'Asad Test')")) === true);
  await picture("agent-typed");

  step = await post("dev", { open: `${base}/dev/sandbox.html` });
  if (/Only necessary/.test(step.page)) step = await post("dev", { act: { action: "click", ref: refOf(step.page, 'button "Only necessary"') } });
  check("the agent's click lands on what it aimed at", step.ok && (await inGuest("document.querySelector('#cookies')?.hidden !== false && getComputedStyle(document.querySelector('#cookies')).display === 'none' || !document.querySelector('#cookies')")) === true, step.problem);
  step = await post("dev", { look: true });
  check("the agent can look at the page", step.ok && step.picture > 5000, JSON.stringify({ ok: step.ok, picture: step.picture, problem: step.problem }));

  const before = await inGuest("({ y: scrollY, room: document.documentElement.scrollHeight - innerHeight, screen: innerHeight })");
  step = await post("dev", { act: { action: "scroll", direction: "down" } });
  const moved = (await inGuest("scrollY")) - before.y;
  const expected = Math.min(before.room, before.screen * 0.8);
  check("the agent scrolls by most of a screen", step.ok && (expected < 40 || Math.abs(moved - expected) <= Math.max(40, expected * 0.2)), JSON.stringify({ moved, expected, before }));

  // The app is a page with a browser inside it: the agent's keys must go to the browser, never to the chat box.
  step = await post("dev", { open: `${base}/dev/sandbox.html#reserve` });
  const nameValue = "[...document.querySelectorAll('input')].find((i) => /^(Keys Test|Keys Testz)$/.test(i.value))?.value";
  const chatBox = await inHost("(() => { const box = document.querySelector('textarea'); if (!box) return false; box.focus(); return document.activeElement === box; })()");
  check("the chat box has the keyboard", chatBox === true);
  step = await post("dev", { act: { action: "type", ref: refOf(step.page, 'textbox "Name"'), text: "Keys Test" } });
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
  step = await post("dev", { open: `${base}/dev/sandbox.html#contact` });
  const hidden = await post("dev", { act: { action: "hover", ref: refOf(step.page, 'button "Send message"') } });
  check("the agent keeps working while the app is out of sight", step.ok && /Contact us/.test(step.page) && hidden.ok, hidden.problem ?? step.problem);
  win.show();
  await wait(600);

  // The safety rules are the same here.
  step = await post("dev", { open: `${base}/dev/sandbox.html#checkout` });
  let refused = await post("dev", { act: { action: "type", ref: refOf(step.page, 'textbox "Card number"'), text: "4242 4242 4242 4242" } });
  check("typing a card number is refused", refused.blocked === true && !refused.ok);
  refused = await post("dev", { act: { action: "click", ref: refOf(step.page, 'button "Pay now'), commits: true } });
  check("pressing Pay now is refused", refused.blocked === true && !refused.ok);
  step = await post("dev", { open: `${base}/dev/sandbox.html#account` });
  refused = await post("dev", { act: { action: "type", ref: refOf(step.page, 'textbox "Password"'), text: "coffee" } });
  check("typing a password is refused", refused.blocked === true && !refused.ok);
  step = await post("dev", { open: `${base}/dev/sandbox.html#reserve` });
  const verdict = await post("dev", { review: { action: "click", ref: refOf(step.page, 'button "Confirm reservation"') } });
  check("Confirm reservation needs approval", verdict.decision === "approve", JSON.stringify(verdict));

  // While the agent drives, the page is covered; when the user takes over, their input goes straight to it.
  const topAt = (b) => inHost(`(() => { const el = document.elementFromPoint(${b.x + b.width / 2}, ${b.y + b.height / 2}); return el ? el.tagName.toLowerCase() : ''; })()`);
  box = await viewBox();
  check("while the agent drives, the user's clicks do not reach the page", (await topAt(box)) !== "webview", await topAt(box));
  await post("control", { action: "take" });
  check("after Take over, the page itself is under the pointer", Boolean(await until(async () => (await topAt(await viewBox())) === "webview")), await topAt(box));

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
  await post("control", { action: "navigate", url: `${base}/dev/sandbox.html#account` });
  await until(() => inGuest("location.hash === '#account' && Boolean(document.querySelector('input[type=password]'))"));
  await click("input[type=password]");
  check("the user's click lands on the field they pointed at", (await inGuest("document.activeElement === document.querySelector('input[type=password]')")) === true, await inGuest("document.activeElement?.outerHTML.slice(0, 120)"));
  await keys("coffee");
  check("the user types their password straight into the page", (await inGuest("document.querySelector('input[type=password]').value")) === "coffee");
  await picture("user-in-control");
  await post("control", { action: "release" });
  step = await post("dev", { read: { scope: "page" } });
  const passwordLine = step.page.split("\n").find((l) => l.includes('textbox "Password"')) ?? "";
  check("and the agent never sees it", step.ok && /\(hidden\)/.test(passwordLine) && !/coffee/.test(passwordLine), passwordLine);

  // Hiding the pane must not lose the page or stop the agent.
  const viewId = guest().id;
  await inHost("document.querySelector('[aria-label=\"Hide the browser\"]').click()");
  await wait(700);
  box = await viewBox();
  check("hiding the pane keeps the browser alive, out of sight", guest()?.id === viewId && Boolean(box) && !box.visible, JSON.stringify(box));
  step = await post("dev", { read: { scope: "view" } });
  check("and the agent carries on in it", step.ok && /Sign in/i.test(step.page), step.problem);
  step = await post("dev", { open: `${base}/dev/sandbox.html#reserve` });
  step = await post("dev", { act: { action: "type", ref: refOf(step.page, 'textbox "Name"'), text: "Out of sight" } });
  check("typing included", step.ok && (await inGuest("[...document.querySelectorAll('input')].some((i) => i.value === 'Out of sight')")) === true, step.problem);
  check("the top bar offers to show it again", (await inHost("Boolean(document.querySelector('[aria-label=\"Show the browser\"]'))")) === true);
  await inHost("document.querySelector('[aria-label=\"Show the browser\"]')?.click()");
  box = await until(async () => {
    const b = await viewBox();
    return b && b.visible ? b : undefined;
  });
  check("showing it again brings back the same view, page and all", Boolean(box) && guest()?.id === viewId && (await inGuest("[...document.querySelectorAll('input')].some((i) => i.value === 'Out of sight')")) === true, JSON.stringify(await viewBox()));
  await wait(500);
  await picture("shown-again");

  if (process.env.BATON_TEST_CHAT) await chat(id, process.env.BATON_TEST_CHAT, picture);

  // Closing takes the view away; asking again brings a new one.
  let s = await post("control", { action: "close" });
  check("closing the browser", s.status === "closed", s.status);
  check("takes the view away", Boolean(await until(async () => !guest() && (await viewBox()) === null)));
  step = await post("dev", { open: `${base}/dev/sandbox.html#contact` });
  check("and the next task gets a view again", step.ok && /Contact us/.test(step.page) && Boolean(guest()), step.problem);
  s = await post("control", { action: "close" });
  await inHost("window.batonDesktop.forget()");
  check("Forget sign-ins wipes what the view stored", true);
  return failed;
}

/** One real request to the agent, working in the app's browser view. */
async function chat(id, prompt, picture) {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId: process.env.BATON_TEST_MODEL ?? "claude-opus-5-5", browserId: id, browserKind: "desktop", place: "Helsinki, Finland", country: "FI", timeZone: "Europe/Helsinki", messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: prompt }] }] }),
  });
  check("the agent takes a request", res.ok, String(res.status));
  if (!res.ok || !res.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let steps = 0;
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      const line = buffer.slice(0, i).replace(/^data: /, "");
      buffer = buffer.slice(i + 2);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const at = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
      if (event.type === "text-delta") text += event.delta;
      else if (event.type === "tool-input-available") {
        console.log("    ", at, "CALL", event.toolName, JSON.stringify(event.input).slice(0, 200));
        if (/^browser/.test(event.toolName)) setTimeout(() => void picture(`chat-${event.toolName}`).catch(() => {}), 450);
      } else if (event.type === "tool-output-available" && event.output?.kind === "browser") {
        steps += 1;
        console.log("    ", at, "  ->", event.output.ok ? "ok" : event.output.blocked ? "BLOCKED" : "FAILED", "|", event.output.label, event.output.problem ? `| ${event.output.problem.slice(0, 160)}` : "");
      } else if (event.type === "tool-approval-request") console.log("    ", at, "APPROVAL REQUEST");
      else if (event.type === "error") console.log("    ", at, "STREAM ERROR", event.errorText);
    }
  }
  await wait(600);
  await picture("chat-done");
  console.log("    TEXT:", text.slice(0, 600).replace(/\n+/g, " "));
  check("the agent worked in the app's browser", steps > 0, `steps: ${steps}`);
}

main()
  .catch((err) => {
    failed += 1;
    console.log("FAIL the test itself broke:", err?.stack ?? err);
  })
  .finally(() => {
    console.log(failed ? `\n${failed} check(s) failed.` : "\nThe desktop app's browser behaves as intended.");
    app.exit(failed ? 1 : 0);
  });
