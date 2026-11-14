// End-to-end test of voice, in the real desktop app. Needs the server running and a Gemini key.
// Run: pnpm test:voice [port]
//
// The app's microphone is fed a recording (scripts/fixtures/weather-question.wav: "What is the
// weather like in Helsinki today? And should I take an umbrella?") and its speaker is muted, so
// the whole path is exercised without anyone speaking: microphone, the session token, Gemini's
// live models, the app's own tools, and what ends up on screen and in the conversation.
//
// It checks voice input (the words appear in the message box as they are heard, and nothing is
// sent) and a live call (the question is heard, the weather tool runs through the app's server,
// its card is shown, the agent answers aloud, and the call is written into the conversation).
//
// BERYL_TEST_SHOTS=<folder> saves pictures of the window along the way.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const port = process.argv.slice(2).find((a) => /^\d{2,5}$/.test(a)) ?? "3000";
const base = `http://localhost:${port}`;
const shots = process.env.BERYL_TEST_SHOTS;
process.env.BERYL_URL = base;
const envFile = path.join(__dirname, "../../.env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "beryl-voice-test-"));
app.setPath("userData", profile);
process.on("exit", () => fs.rmSync(profile, { recursive: true, force: true }));
// A recording in place of the microphone, played once; no permission prompt; no sound from the speakers.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-audio-capture", `${process.env.BERYL_TEST_WAV || path.join(__dirname, "fixtures/weather-question.wav")}%noloop`);
app.commandLine.appendSwitch("mute-audio");
// The audio service has to be able to read the recording from disk.
app.commandLine.appendSwitch("disable-features", "AudioServiceSandbox");
require("../desktop/main.cjs");

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

async function main() {
  await app.whenReady();
  const win = await until(() => BrowserWindow.getAllWindows()[0]);
  const inHost = (js) => win.webContents.executeJavaScript(js, true);
  let shot = 0;
  const picture = async (name) => {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    fs.writeFileSync(path.join(shots, `${String(++shot).padStart(2, "0")}-${name}.png`), (await win.capturePage()).toPNG());
  };
  const box = "document.querySelector('textarea[aria-label=\"Message\"]')";
  const press = (label) => inHost(`(() => { const b = document.querySelector('button[aria-label=${JSON.stringify(label)}]'); if (!b) return false; b.click(); return true; })()`);

  // BERYL_TEST_PHONE=1: the window is as narrow as a phone, to see the call as most people will.
  if (process.env.BERYL_TEST_PHONE) {
    win.setMinimumSize(360, 600);
    win.setSize(400, 860);
  }
  await signIn(inHost);
  check("the interface is up", Boolean(await until(() => inHost(`Boolean(${box})`), 30000)));
  check("the message box offers voice input and a call", Boolean(await until(() => inHost("Boolean(document.querySelector('button[aria-label=\"Speak instead of typing\"]')) && Boolean(document.querySelector('button[aria-label=\"Talk: start a live call\"]'))"))));

  /* Voice input: the words appear in the box as they are heard, and nothing is sent. */
  let t0 = Date.now();
  await press("Speak instead of typing");
  const first = await until(() => inHost(`${box}.value.trim().length > 3 ? ${box}.value : ''`), 15000);
  check("words appear in the message box while speaking", Boolean(first), "nothing was heard");
  console.log("     first words after", `${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(first));
  await picture("voice-input");
  const heard = await until(() => inHost(`/umbrella/i.test(${box}.value) ? ${box}.value : ''`), 15000);
  check("the whole question is heard", /weather/i.test(heard ?? "") && /Helsinki/i.test(heard ?? "") && /umbrella/i.test(heard ?? ""), await inHost(`${box}.value`));
  await press("Stop listening");
  check("stopping leaves the words in the box", Boolean(await until(() => inHost(`Boolean(document.querySelector('button[aria-label="Speak instead of typing"]')) && /umbrella/i.test(${box}.value)`), 6000)), await inHost(`${box}.value`));
  check("nothing was sent to the agent", (await inHost("document.querySelectorAll('[data-role], article').length === 0 && !document.querySelector('button[aria-label=\"Stop\"]')")) === true);
  await inHost(`(() => { const el = ${box}; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  /* A live call. */
  t0 = Date.now();
  const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  await press("Talk: start a live call");
  check("the call's own view takes over", Boolean(await until(() => inHost("Boolean(document.querySelector('button[aria-label=\"End the call\"]')) && Boolean(document.querySelector('.orb'))"))));
  const connected = await until(() => inHost("['listening','thinking','speaking'].includes(document.querySelector('.orb')?.dataset.status) ? document.querySelector('.orb').dataset.status : ''"), 15000);
  check("the call connects", Boolean(connected), await inHost("document.querySelector('.orb')?.dataset.status"));
  console.log("     connected after", since());
  await picture("call-listening");
  const states = new Set();
  let cardAt = 0;
  const answered = await until(async () => {
    const now = await inHost("({ status: document.querySelector('.orb')?.dataset.status, card: /Helsinki/.test(document.body.innerText) && Boolean(document.querySelector('[aria-label=\"End the call\"]')) && document.querySelectorAll('section, article').length > 0, text: document.body.innerText })");
    if (now.status && !states.has(now.status)) {
      states.add(now.status);
      console.log("    ", since(), now.status);
      void picture(`call-${now.status}`);
    }
    if (!cardAt && /°/.test(now.text)) {
      cardAt = Date.now();
      console.log("    ", since(), "the weather card is on screen");
    }
    return cardAt && states.has("speaking") && now.status === "listening" && Date.now() - cardAt > 6000 ? now : undefined;
  }, 60000);
  check("the question is answered: the tool ran, its card is shown, and the agent spoke", Boolean(answered), JSON.stringify([...states]));
  await picture("call-answered");

  // The conversation view shows the same call.
  await inHost("[...document.querySelectorAll('[role=tab]')].find((t) => /Conversation/.test(t.textContent))?.click(); 1");
  const conversation = await until(() => inHost("(() => { const text = document.body.innerText; return /umbrella/i.test(text) && /°/.test(text) ? text : ''; })()"), 6000);
  check("the conversation shows what was asked, the card and the spoken answer", Boolean(conversation));
  check("with the call still on, in a bar above the message box", (await inHost("/Live call/.test(document.body.innerText) && Boolean(document.querySelector('button[aria-label=\"End the call\"]'))")) === true);
  await wait(400);
  await picture("call-in-conversation");
  await press("End the call");
  check("ending the call brings the message box back", Boolean(await until(() => inHost("!document.querySelector('button[aria-label=\"End the call\"]') && Boolean(document.querySelector('button[aria-label=\"Talk: start a live call\"]'))"), 6000)));
  const said = await inHost("[...document.querySelectorAll('p')].map((p) => p.innerText).filter((t) => t.length > 30).slice(-3).join(' | ')");
  console.log("     the agent said:", said.slice(0, 400));
  // The conversation is saved when the call ends. The test leaves nothing behind in the account.
  await wait(2500);
  const removed = await inHost("(() => { const id = localStorage.getItem('hovi.active'); return id ? fetch('/api/conversations/' + id, { method: 'DELETE', headers: { 'x-beryl-client': 'desktop' } }).then((r) => r.status) : 0; })()");
  check("the call was saved to the account (and the test removes it again)", removed === 200 || removed === 204, String(removed));
  return failed;
}

/** Sign in as the admin from exa/.env.local, through the app's own sign-in page. */
async function signIn(inHost) {
  const needsSignIn = await until(() => inHost("location.pathname.startsWith('/login') ? 'yes' : document.querySelector('textarea[aria-label=\"Message\"]') ? 'no' : ''"), 30000);
  if (needsSignIn !== "yes") return;
  // The admin from exa/.env.local, or another account named by BERYL_TEST_EMAIL and BERYL_TEST_PASSWORD.
  const email = process.env.BERYL_TEST_EMAIL || process.env.ADMIN_EMAIL;
  const password = process.env.BERYL_TEST_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are needed in exa/.env.local to sign in (or BERYL_TEST_EMAIL and BERYL_TEST_PASSWORD for another account).");
  const fill = (selector, value) =>
    inHost(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await until(() => inHost("(() => { const el = document.querySelector('input[type=email]'); return Boolean(el && document.querySelector('input[type=password]') && Object.keys(el).some((k) => k.startsWith('__reactProps'))); })()"));
  await fill("input[type=email]", email);
  await fill("input[type=password]", password);
  await inHost("document.querySelector('form').requestSubmit(); 1");
  await until(() => inHost("!location.pathname.startsWith('/login')"), 20000);
}

main()
  .catch((err) => {
    failed += 1;
    console.log("FAIL the test itself broke:", err?.stack ?? err);
  })
  .finally(() => {
    console.log(failed ? `\n${failed} check(s) failed.` : "\nVoice input and a live call behave as intended.");
    app.exit(failed ? 1 : 0);
  });
