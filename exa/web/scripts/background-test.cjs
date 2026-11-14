// End-to-end test of tasks that keep running, in the real desktop app. Needs the server running.
// Run: pnpm test:background [port]
//
// A task belongs to the server once it has started. This checks, with real questions, that:
// a suggestion fills the message box and sends nothing; a long task survives a reload and is
// shown live again; another task runs beside it while it is out of sight, and the list marks the
// one left running; opening it again shows it as it stands; it finishes once and is saved with
// its figures; and Stop ends a task on the server too. It also sends a task into the live
// browser, leaves the conversation, and expects it to finish out of sight.
//
// It costs a few cents in model and Exa calls. BERYL_TEST_SHOTS=<folder> saves pictures along the way.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const port = process.argv.slice(2).find((a) => /^\d{2,5}$/.test(a)) ?? "3000";
process.env.BERYL_URL = `http://localhost:${port}`;
const shots = process.env.BERYL_TEST_SHOTS;
const envFile = path.join(__dirname, "../../.env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "beryl-background-test-"));
app.setPath("userData", profile);
process.on("exit", () => fs.rmSync(profile, { recursive: true, force: true }));
require(path.join(__dirname, "../desktop/main.cjs"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (probe, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await Promise.resolve().then(probe).catch(() => undefined); if (v) return v; if (Date.now() - t0 > ms) return undefined; await wait(150); } };
let failures = 0;
const ok = (label, pass, note = "") => { if (!pass) failures += 1; console.log(`${pass ? "ok  " : "FAIL"} ${label}${note !== "" ? `  (${String(note).slice(0, 150)})` : ""}`); };

(async () => {
  await app.whenReady();
  const win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.setSize(1180, 900);
  const inHost = (js) => win.webContents.executeJavaScript(js, true);
  const shot = async (label) => {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    win.show();
    await wait(500);
    fs.writeFileSync(path.join(shots, `${label}.png`), (await win.capturePage()).toPNG());
  };
  // Only what is on screen counts: a conversation working out of sight is still in the page.
  const V = "const vis = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null);";
  const busy = () => inHost(`(() => { ${V} return vis('button[aria-label="Stop"]').length > 0; })()`);
  const box = () => inHost(`(() => { ${V} return vis('textarea[aria-label="Message"]')[0]?.value ?? null; })()`);
  const type = (text) => inHost(`(() => { ${V} const el = vis('textarea[aria-label="Message"]')[0]; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const send = () => inHost(`(() => { ${V} vis('button[aria-label="Send"]')[0].click(); return true; })()`);
  const ask = async (text) => { await type(text); await wait(250); await send(); };
  const runningDots = () => inHost("document.querySelectorAll('[aria-label=\"This chat is still working\"]').length");
  const active = () => inHost("localStorage.getItem('hovi.active')");
  const saved = (id) => inHost(`fetch('/api/conversations/${id}', { headers: { 'x-beryl-client': 'desktop' } }).then((r) => r.ok ? r.json() : null)`);
  const serverRuns = () => inHost("fetch('/api/chat/runs').then((r) => r.json()).then((j) => j.running.map((x) => x.id))");
  const shownText = () => inHost(`(() => { ${V} return vis('main, [class*="overflow-y-auto"]').map((el) => el.innerText).join(' ').replace(/\\s+/g, ' '); })()`);
  const signIn = async () => {
    await until(() => inHost("(() => { const el = document.querySelector('input[type=email]'); return Boolean(el && Object.keys(el).some((k) => k.startsWith('__reactProps'))); })()"));
    const fill = (sel, value) => inHost(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await fill("input[type=email]", (process.env.BERYL_TEST_EMAIL || process.env.ADMIN_EMAIL)); await fill("input[type=password]", (process.env.BERYL_TEST_PASSWORD || process.env.ADMIN_PASSWORD));
    await inHost("document.querySelector('form').requestSubmit(); 1");
  };
  const ready = () => until(() => inHost(`(() => { ${V} return vis('textarea[aria-label="Message"]').length > 0; })()`));
  const made = [];

  await signIn(); await ready();
  await inHost("localStorage.removeItem('hovi.active'); localStorage.setItem('hovi.mode', 'fast'); localStorage.setItem('hovi.effort', '1'); location.reload(); 1");
  await wait(1500); await ready(); await wait(600);

  // ── A suggestion fills the message box and does not send ──
  const picked = await inHost(`(() => { ${V} const b = vis('button').find((x) => /Plan a dinner|Pick a product|Follow a market/.test(x.innerText)); if (!b) return null; b.click(); return b.innerText.split('\\n')[0]; })()`);
  await wait(500);
  const filled = await box();
  ok("picking a suggestion puts it in the message box", Boolean(picked) && typeof filled === "string" && filled.length > 20, `${picked}: ${filled}`);
  ok("and does not send it", !(await busy()) && /What can I take off your hands/.test(await inHost("document.body.innerText")));
  await type("");

  // ── Reload in the middle of a task ──
  await ask("Do a deep research on how the price of electricity in Finland is set and why it swings so much between hours.");
  ok("a long task starts", Boolean(await until(busy, 15000)));
  const first = await active(); made.push(first);
  await until(() => inHost(`(() => { ${V} return vis('section h3').length > 0; })()`), 30000);
  await wait(4000);
  await shot("1-before-reload");
  await inHost("location.reload(); 1");
  await wait(1200); await until(() => inHost("document.readyState === 'complete'")); await wait(2500);
  ok("after a reload the same conversation is open", (await active()) === first);
  ok("and the task is still running in it, live", Boolean(await until(busy, 8000)));
  ok("the server never stopped it", (await serverRuns()).includes(first));
  await shot("2-after-reload");
  const during = await shownText();
  ok("nothing says it was stopped", !/Stopped before this finished/.test(during));

  // ── Leave it running and start another beside it ──
  await inHost(`(() => { ${V} (vis('button[aria-label="New chat"]')[0] ?? vis('button').find((b) => b.innerText.trim() === 'New chat')).click(); return true; })()`);
  await wait(800); await ready();
  ok("a new task opens with an empty message box", (await box()) === "" && !(await busy()));
  ok("the list marks the task left running", (await until(async () => (await runningDots()) >= 1, 8000)) === true, await runningDots());
  await ask("What is the capital of Estonia? One short sentence.");
  await until(busy, 10000);
  const second = await active(); made.push(second);
  ok("a second task runs beside the first", second !== first && (await serverRuns()).includes(first));
  await until(async () => !(await busy()), 60000);
  await wait(1200);
  const quick = await saved(second);
  const quickText = (quick?.messages?.at(-1)?.parts ?? []).filter((p) => p.type === "text").map((p) => p.text).join(" ");
  ok("the second one finishes on its own", /Tallinn/.test(quickText), quickText.slice(0, 80));
  await shot("3-second-task-done");

  // ── Open the first one again: it is either still working, live, or finished in full ──
  await inHost(`(() => { const b = [...document.querySelectorAll('button[aria-current], aside button, nav button')].find((x) => /electricity in Finland/.test(x.innerText) || /electricity in Finland/.test(x.title || '')); b?.click(); return Boolean(b); })()`);
  await wait(1500);
  ok("the first conversation opens again", (await active()) === first);
  const stillBusy = await busy();
  console.log("     it is", stillBusy ? "still working, live" : "already finished");
  await shot("4-first-reopened");
  await until(async () => !(await busy()), 240000);
  await wait(2500);
  const done = await saved(first);
  const answer = done?.messages?.at(-1);
  const research = (answer?.parts ?? []).filter((p) => p.type === "tool-deepResearch");
  const words = (answer?.parts ?? []).filter((p) => p.type === "text").map((p) => p.text).join(" ");
  ok("the first task finished and was saved", done?.messages?.length === 2 && answer?.role === "assistant" && research.length === 1 && research[0].state === "output-available" && research[0].output?.status === "done", `${done?.messages?.length} messages, ${research.length} research, ${research[0]?.state}, ${research[0]?.output?.status}`);
  ok("its report is there once, not twice", (research[0]?.output?.report ?? "").length > 400 && words.length > 20, `${(research[0]?.output?.report ?? "").length} chars of report`);
  ok("with its figures", typeof answer?.metadata?.durationMs === "number" && answer?.metadata?.mode === "fast", JSON.stringify({ mode: answer?.metadata?.mode, ms: answer?.metadata?.durationMs }));
  const after = await shownText();
  ok("the screen shows the finished report and no interruption", !/Stopped before this finished/.test(after) && !/Try again/.test(after));
  ok("nothing is left running", (await serverRuns()).length === 0 && (await runningDots()) === 0, `${(await serverRuns()).length} on the server, ${await runningDots()} marked`);
  await shot("5-first-finished");

  // ── Stop really stops ──
  await inHost(`(() => { ${V} (vis('button[aria-label="New chat"]')[0] ?? vis('button').find((b) => b.innerText.trim() === 'New chat')).click(); return true; })()`);
  await wait(800); await ready();
  await ask("Search the web one at a time, never in parallel, for the population of each of these and then list them: Helsinki, Espoo, Tampere, Vantaa, Oulu, Turku, Jyväskylä, Kuopio.");
  await until(busy, 10000);
  const third = await active(); made.push(third);
  await wait(3000);
  await inHost(`(() => { ${V} vis('button[aria-label="Stop"]')[0]?.click(); return true; })()`);
  await wait(2500);
  ok("Stop ends the task on the server too", !(await serverRuns()).includes(third) && !(await busy()));

  // ── A task in the live browser carries on while another conversation is on screen ──
  await inHost(`(() => { ${V} (vis('button[aria-label="New chat"]')[0] ?? vis('button').find((b) => b.innerText.trim() === 'New chat')).click(); return true; })()`);
  await wait(800); await ready();
  await ask(`In the live browser, open http://localhost:${port}/dev/sandbox.html, read the page, and tell me in one sentence what the page is for. Then close the browser.`);
  ok("a task in the live browser starts", Boolean(await until(busy, 15000)));
  const fourth = await active(); made.push(fourth);
  await until(() => inHost("Boolean(document.querySelector('webview'))"), 30000);
  await inHost(`(() => { ${V} (vis('button[aria-label="New chat"]')[0] ?? vis('button').find((b) => b.innerText.trim() === 'New chat')).click(); return true; })()`);
  await wait(800); await ready();
  ok("another conversation is on screen", (await active()) !== fourth && !(await busy()));
  const browsed = await until(async () => {
    const last = (await saved(fourth))?.messages?.at(-1);
    const text = (last?.parts ?? []).filter((p) => p.type === "text").map((p) => p.text).join(" ");
    const steps = (last?.parts ?? []).filter((p) => p.type.startsWith("tool-browser"));
    return (await serverRuns()).length === 0 && steps.length >= 2 && steps.every((p) => p.state === "output-available") && text.length > 20 ? { text, steps: steps.map((p) => p.type.slice(5)) } : undefined;
  }, 150000);
  ok("the browser task finished out of sight", Boolean(browsed), browsed ? `${browsed.steps.join(", ")}: ${browsed.text.replace(/\s+/g, " ").slice(0, 100)}` : "not finished");
  made.push(await active());

  for (const id of made) if (id) await inHost(`fetch('/api/conversations/${id}', { method: 'DELETE', headers: { 'x-beryl-client': 'desktop' } }).then(() => 1)`);
  console.log(failures ? `\n${failures} check(s) failed.` : "\nTasks keep running in the background as intended.");
  app.exit(failures ? 1 : 0);
})().catch((e) => { console.log("TEST broke", e); app.exit(1); });
