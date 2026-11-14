// One case of `pnpm test:waiting`, run inside the real desktop app. Started by waiting-test.mjs,
// which says which case and phase through CASE and PHASE and gives the profile folder to use, so
// that a second start of the app finds what the first one left.
//
//   approval  1: reach an approval on the pretend site and quit without answering.
//             2: reopen. The agent must work its way back to the approval; approving books once.
//   reload    1: reload the window at an approval. Same: back to the approval, then book once.
//   handover  1: it is the user's turn on a page. Look at another conversation: the first stays
//                alive and is marked as waiting, and "Done" in the browser reaches it. It asks
//                again (nobody signed in); quit there.
//             2: reopen. The agent is told the app was closed during the user's turn and asks again.
//   left      1: the user's turn, then another conversation is opened, then quit.
//             2: reopen. The list marks the task that was left; it starts only when it is opened.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const which = process.env.CASE ?? "approval";
const phase = process.env.PHASE ?? "1";
const port = process.argv.slice(2).find((a) => /^\d{2,5}$/.test(a)) ?? "3000";
const base = `http://localhost:${port}`;
process.env.BERYL_URL = base;
const shots = process.env.BERYL_TEST_SHOTS;
const envFile = path.join(__dirname, "../../.env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const profile = process.env.BERYL_WAITING_PROFILE;
if (!profile) throw new Error("Run this through `pnpm test:waiting`.");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
require(path.join(__dirname, "../desktop/main.cjs"));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (probe, ms = 30000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(probe).catch(() => undefined);
    if (v) return v;
    if (Date.now() - t0 > ms) return undefined;
    await wait(250);
  }
};
let failures = 0;
const ok = (label, pass, note = "") => {
  if (!pass) failures += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${label}${note !== "" ? `  (${String(note).slice(0, 220)})` : ""}`);
};
const note = (name) => path.join(profile, name);

(async () => {
  await app.whenReady();
  const win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.setSize(1320, 900);
  const inHost = (js) => win.webContents.executeJavaScript(js, true);
  const shot = async (label) => {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    win.show();
    await wait(600);
    fs.writeFileSync(path.join(shots, `waiting-${which}-${label}.png`), (await win.capturePage()).toPNG());
  };
  const V = "const vis = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null);";
  const state = () =>
    inHost(`(() => { ${V} const buttons = vis('button').map((b) => b.innerText.trim()); return {
      busy: vis('button[aria-label="Stop"]').length > 0,
      approve: buttons.includes('Approve'),
      done: buttons.filter((b) => b.includes('I have signed in') || b.includes('Done, continue')).length,
      waitingMark: document.querySelectorAll('[aria-label="This task is waiting for you"]').length,
      runningMark: document.querySelectorAll('[aria-label="A task is running in this conversation"]').length,
      webview: Boolean(document.querySelector('webview')),
      signedIn: vis('textarea[aria-label="Message"]').length > 0,
      active: localStorage.getItem('hovi.active') }; })()`);
  const saved = (id) => inHost(`fetch('/api/conversations/${id}', { headers: { 'x-beryl-client': 'desktop' } }).then((r) => r.ok ? r.json() : null)`);
  const parts = async (id) =>
    ((await saved(id))?.messages?.at(-1)?.parts ?? [])
      .filter((p) => p.type.startsWith("tool-"))
      .map((p) => `${p.type.slice(5)}:${p.state}${p.output?.ok === false ? "(failed)" : ""}${p.output?.status ? `(${p.output.status})` : ""}`);
  const text = async (id) => ((await saved(id))?.messages?.at(-1)?.parts ?? []).filter((p) => p.type === "text").map((p) => p.text).join(" ").replace(/\s+/g, " ");
  const remove = (id) => inHost(`fetch('/api/conversations/${id}', { method: 'DELETE', headers: { 'x-beryl-client': 'desktop' } }).then(() => 1)`);
  const click = (label) => inHost(`(() => { ${V} const b = vis('button').find((x) => x.innerText.trim().includes(${JSON.stringify(label)})); if (b) b.click(); return Boolean(b); })()`);
  const newTask = () => inHost(`(() => { ${V} vis('button[aria-label="New task"]')[0].click(); return true; })()`);
  const signIn = async () => {
    await until(() => inHost("(() => { const el = document.querySelector('input[type=email]'); return Boolean(el && Object.keys(el).some((k) => k.startsWith('__reactProps'))); })()"));
    const fill = (sel, value) => inHost(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await fill("input[type=email]", process.env.ADMIN_EMAIL);
    await fill("input[type=password]", process.env.ADMIN_PASSWORD);
    await inHost("document.querySelector('form').requestSubmit(); 1");
    await until(async () => (await state()).signedIn);
    // The quickest mode keeps the test short; a fresh conversation keeps it apart from earlier ones.
    await inHost("localStorage.removeItem('hovi.active'); localStorage.setItem('hovi.mode', 'fast'); localStorage.setItem('hovi.effort', '1'); location.reload(); 1");
    await wait(1500);
    await until(async () => (await state()).signedIn);
    await wait(600);
  };
  const ask = async (words) => {
    await inHost(`(() => { ${V} const el = vis('textarea[aria-label="Message"]')[0]; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(words)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await wait(250);
    await inHost(`(() => { ${V} vis('button[aria-label="Send"]')[0].click(); return true; })()`);
  };
  const RESERVE = `In the live browser, open ${base}/dev/sandbox.html and reserve a table for 2 tomorrow at 19:00. My name is Alex Morgan and my phone number is 040 123 4567. No newsletter.`;
  const SIGNIN = `In the live browser, open ${base}/dev/sandbox.html, go to My account and get me signed in. I will type the password myself.`;
  const end = () => app.exit(failures > 0 ? 1 : 0);

  /** From an approval card that is on screen: approve, and expect the reservation to go through. */
  const approveAndFinish = async (id) => {
    await click("Approve");
    // The pretend site answers with a confirmation number, and the agent passes it on.
    const said = await until(async () => { const t = await text(id); return /R-\d+/.test(t) ? t : undefined; }, 180000);
    ok("approving then books the table", Boolean(said), (said ?? (await text(id))).slice(-160));
    await until(async () => !(await state()).busy, 30000);
    await shot("booked");
  };

  if (which === "approval" || which === "reload") {
    let id;
    if (phase === "1") {
      await signIn();
      await ask(RESERVE);
      ok("the task reaches a step that needs approval", Boolean(await until(async () => (await state()).approve, 180000)));
      id = (await state()).active;
      await wait(4000); // let the save go out
      if (which === "approval") {
        console.log("     quitting the app without answering");
        app.exit(failures > 0 ? 1 : 0);
        return;
      }
      console.log("     reloading the window without answering");
      win.webContents.reload();
      await wait(2500);
    }
    await until(async () => (await state()).signedIn, 30000);
    id ??= (await state()).active;
    const before = (await parts(id)).length;
    const back = await until(async () => (await state()).approve, 240000);
    const steps = await parts(id);
    ok(which === "approval" ? "after the app is opened again the task works its way back to the approval" : "after a reload the task works its way back to the approval", Boolean(back) && (await state()).webview, `${steps.length} steps`);
    ok("the step that was waiting is not taken blind", steps.some((x) => x.includes("(failed)")), `${before} steps on opening`);
    await shot("approval-again");
    if (!back) console.log(`     steps: ${steps.join(", ")}\n     the agent says: ${(await text(id)).slice(-300)}\n     on screen: ${JSON.stringify(await state())}`);
    if (back) await approveAndFinish(id);
    await remove(id);
    end();
    return;
  }

  if (which === "handover") {
    if (phase === "1") {
      await signIn();
      await ask(SIGNIN);
      ok("the page is handed to the user", Boolean(await until(async () => (await state()).done > 0, 180000)));
      const first = (await state()).active;
      await wait(1500);
      await newTask();
      await wait(4000); // longer than the moment after which a finished conversation is let go
      const away = await state();
      ok("with another conversation open, the first is marked as waiting", away.waitingMark > 0, JSON.stringify({ waiting: away.waitingMark, running: away.runningMark }));
      ok("the browser still offers Done", away.done > 0);
      await shot("away");
      await click("Done, continue");
      const carried = await until(async () => {
        const p = await parts(first);
        const at = p.findIndex((x) => x.startsWith("requestUserAction:output-available"));
        return at >= 0 && (p.length > at + 1 || (await text(first)).length > 0) ? p : undefined;
      }, 90000);
      ok("Done reaches the conversation that is out of sight, and it carries on", Boolean(carried), (await parts(first)).join(", ").slice(-200));
      // Nobody signed in, so it asks again: quit while it is the user's turn.
      ok("it asks again, since nobody signed in", Boolean(await until(async () => (await state()).done > 0 && (await parts(first)).at(-1)?.startsWith("requestUserAction:input-available"), 120000)));
      await inHost(`localStorage.setItem('hovi.active', ${JSON.stringify(first)}); 1`);
      await wait(4000);
      console.log("     quitting the app while it is the user's turn");
      end();
      return;
    }
    await until(async () => (await state()).signedIn, 30000);
    const id = (await state()).active;
    const told = await until(async () => { const p = await parts(id); return p.some((x) => x.includes("(interrupted)")) ? p : undefined; }, 60000);
    ok("after reopening, the agent is told the app was closed during the user's turn", Boolean(told));
    const again = await until(async () => (await state()).done > 0 && (await parts(id)).at(-1)?.startsWith("requestUserAction:input-available"), 150000);
    ok("it opens the page again and hands it to the user again", Boolean(again) && (await state()).webview);
    await shot("reopened");
    await remove(id);
    end();
    return;
  }

  if (which === "left") {
    if (phase === "1") {
      await signIn();
      await ask(SIGNIN);
      ok("the page is handed to the user", Boolean(await until(async () => (await state()).done > 0, 180000)));
      fs.writeFileSync(note("first.txt"), (await state()).active);
      await wait(1500);
      await newTask();
      await wait(3500);
      ok("it is marked as waiting while another conversation is open", (await state()).waitingMark > 0);
      console.log("     quitting with the waiting task out of sight");
      end();
      return;
    }
    const first = fs.readFileSync(note("first.txt"), "utf8");
    await until(async () => (await state()).signedIn, 30000);
    await wait(5000);
    const opened = await state();
    ok("after reopening, the app is on another conversation", opened.active !== first);
    ok("the list marks the task that was left waiting", opened.waitingMark > 0, `${opened.waitingMark} marked`);
    ok("it did not start by itself out of sight", !(await parts(first)).some((x) => x.includes("(interrupted)")));
    await shot("marked");
    await inHost(`(() => { const mark = document.querySelector('[aria-label="This task is waiting for you"]'); mark?.closest('li')?.querySelector('button')?.click(); return true; })()`);
    ok("opened from the list, it picks up", Boolean(await until(async () => (await parts(first)).some((x) => x.includes("(interrupted)")), 60000)));
    ok("and gets back to the user's turn", Boolean(await until(async () => (await state()).done > 0 && (await parts(first)).at(-1)?.startsWith("requestUserAction:input-available"), 150000)));
    await remove(first);
    end();
    return;
  }

  console.log(`FAIL no such case: ${which}`);
  app.exit(1);
})().catch((e) => {
  console.log("FAIL the test broke:", e);
  app.exit(1);
});
