// End-to-end test of working in "the user's own Chrome", against a stand-in: an ordinary Chrome
// started here with two tabs of "theirs". The real Chrome on this computer is never touched.
// Needs the dev server running. Run: pnpm test:own [port]
//
// It checks that the app opens a window of its own, works in it, shows it in the live view,
// leaves the other tabs alone, closes only its own window, and goes back to the built-in browser.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const port = process.argv[2] ?? "3000";
const base = `http://localhost:${port}`;
const id = `owntest${Date.now().toString(36)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (route, body) => {
  const res = await fetch(`${base}/api/browser/${route}?id=${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${route} ${res.status} ${await res.text()}`);
  return res.json();
};
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  ${detail}`}`);
};

const CHROME =
  process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : process.platform === "win32" ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe` : "/usr/bin/google-chrome";
const folder = mkdtempSync(path.join(tmpdir(), "own-chrome-test-"));
const chrome = spawn(CHROME, [`--user-data-dir=${folder}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--window-size=900,600", "https://example.com/", "https://www.iana.org/"], { stdio: "ignore" });

try {
  const t0 = Date.now();
  while (!existsSync(path.join(folder, "DevToolsActivePort")) && Date.now() - t0 < 15000) await wait(100);
  await wait(2000);

  let state = await post("dev", { chromeFolder: folder });
  check("the stand-in Chrome is seen as ready", state.own === "ready", JSON.stringify(state.own));

  state = await post("control", { action: "kind", kind: "own" });
  check("the choice switches to the user's own Chrome", state.kind === "own");

  // Frames must arrive in the live view even though the window is in the background.
  let frames = 0;
  const stream = await fetch(`${base}/api/browser/stream?id=${id}`);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      frames += (decoder.decode(value, { stream: true }).match(/"type":"frame"/g) ?? []).length;
    }
  })().catch(() => {});

  let step = await post("dev", { open: `${base}/dev/sandbox.html#reserve` });
  check("opens a page in a window of its own", step.ok && /Reserve a table/.test(step.page), step.problem);
  const ref = step.page.split("\n").find((l) => l.includes('textbox "Name"'))?.match(/\[((?:f\d+)?e\d+)\]/)?.[1];
  step = await post("dev", { act: { action: "type", ref, text: "Asad Test" } });
  check("types into the page", step.ok && /Asad Test/.test(step.page), step.problem);
  await wait(2500);
  check("the live view gets pictures", frames >= 2, `frames: ${frames}`);

  state = await post("control", { action: "take" });
  check("state says it is the user's own Chrome", state.kind === "own" && state.status === "ready" && state.tabs.length === 1, JSON.stringify({ kind: state.kind, status: state.status, tabs: state.tabs.length }));
  check("only its own tab is listed, not theirs", state.tabs.every((t) => t.url.includes("sandbox.html")), JSON.stringify(state.tabs.map((t) => t.url)));
  await post("control", { action: "release" });

  // The safety rules are the same in either browser.
  step = await post("dev", { open: `${base}/dev/sandbox.html#checkout` });
  const card = step.page.split("\n").find((l) => l.includes('textbox "Card number"'))?.match(/\[((?:f\d+)?e\d+)\]/)?.[1];
  const refused = await post("dev", { act: { action: "type", ref: card, text: "4242 4242 4242 4242" } });
  check("typing a card number is still refused", refused.blocked === true && !refused.ok);

  state = await post("control", { action: "close" });
  check("closing closes its own window", state.status === "closed");
  await wait(600);
  check("the user's Chrome keeps running", chrome.exitCode === null);
  const targets = await (await fetch(`http://127.0.0.1:${(await import("node:fs")).readFileSync(path.join(folder, "DevToolsActivePort"), "utf8").split("\n")[0]}/json/list`)).json();
  const pages = targets.filter((t) => t.type === "page").map((t) => new URL(t.url).hostname);
  check("their two tabs are still open, and nothing of ours is left", pages.includes("example.com") && pages.includes("www.iana.org") && !pages.includes("localhost"), JSON.stringify(pages));

  state = await post("control", { action: "kind", kind: "assisted" });
  check("switches back to the built-in browser", state.kind === "assisted");

  // Switching in the middle of a task (a sign-in the built-in browser cannot do): the page comes along.
  step = await post("dev", { open: `${base}/dev/sandbox.html#contact` });
  state = await post("control", { action: "kind", kind: "own", reopen: true });
  check("the open page moves to the user's own Chrome", state.kind === "own" && state.status === "ready" && state.url.includes("#contact"), JSON.stringify({ kind: state.kind, status: state.status, url: state.url, error: state.error }));
  step = await post("dev", { read: { scope: "view" } });
  check("and the agent can carry on there", step.ok && /Contact us/.test(step.page), step.problem);
  await post("control", { action: "close" });
  state = await post("control", { action: "kind", kind: "assisted" });
  check("and back again", state.kind === "assisted" && chrome.exitCode === null);
  reader.cancel().catch(() => {});
} catch (err) {
  failed += 1;
  console.log("FAIL the test itself broke:", err.message);
} finally {
  await post("control", { action: "kind", kind: "assisted" }).catch(() => {});
  await post("dev", { chromeFolder: "" }).catch(() => {});
  chrome.kill("SIGTERM");
  await wait(800);
  rmSync(folder, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed.` : "\nWorking in the user's own Chrome behaves as intended.");
process.exitCode = failed ? 1 : 0;
