import type { BrowserCall, BrowserEvent, BrowserState, BrowserStepData, Handover } from "./protocol";
import { BrowserSession } from "./session";
import { browserActInput, browserOpenInput, browserReadInput, controlRequestInput, requestUserActionInput } from "./tool-inputs";

/*
 * The desktop app's browser engine: the one live browser of this app window, and the door the
 * interface knocks on to use it. Bundled into desktop/dist/engine.cjs (desktop/build.mjs) and
 * loaded by the app's main process. Nothing here knows about Electron: main.cjs wires it to the
 * window, and tells it where the browser view can be reached.
 *
 * Everything that arrives here came from outside (the interface, and before that the model), so
 * every step is checked for shape before it is taken, and the safety rules in guard.ts are applied
 * inside the session, where the page is.
 */

const refused = (action: BrowserStepData["action"], problem: string): BrowserStepData => ({
  kind: "browser",
  label: "That step did not work",
  action,
  url: "",
  title: "",
  ok: false,
  problem,
  page: `NOT DONE. ${problem}`,
  sources: [],
});

export function createEngine() {
  const session = new BrowserSession();
  /** Steps by tool call: asking twice for the same step (the interface reloaded) gets the same answer, not a second click. */
  const calls = new Map<string, Promise<BrowserStepData>>();
  const running = new Set<AbortController>();

  function take(call: BrowserCall, signal: AbortSignal): Promise<BrowserStepData> {
    switch (call.tool) {
      case "browserOpen": {
        const input = browserOpenInput.safeParse(call.input);
        if (!input.success) return Promise.resolve(refused("open", "The address to open was missing."));
        return session.open(input.data.url, signal, input.data.fresh === true);
      }
      case "browserAct": {
        const input = browserActInput.safeParse(call.input);
        if (!input.success) return Promise.resolve(refused("click", "The step was not one the browser understands."));
        return session.act(call.toolCallId, input.data, signal);
      }
      case "browserRead": {
        const input = browserReadInput.safeParse(call.input ?? {});
        const options = input.success ? input.data : {};
        return session.read({ scope: options.find ? "page" : (options.scope ?? "view"), find: options.find }, signal);
      }
      case "browserLook":
        return session.look(signal);
      case "browserClose":
        return session.shut(signal);
      default:
        return Promise.resolve(refused("read", "The browser has no such step."));
    }
  }

  return {
    /** Take one of the agent's steps. Resolves with the page as it then stands; never rejects. */
    run(call: BrowserCall): Promise<BrowserStepData> {
      if (!call || typeof call.toolCallId !== "string" || !call.toolCallId) return Promise.resolve(refused("read", "The step had no name."));
      const known = calls.get(call.toolCallId);
      if (known) return known;
      // Asked for again after the view that asked was closed, and this browser never had the step:
      // the app was quit in between, or the step never arrived. The page it was meant for may be
      // gone or another one, so it is not taken. The agent is told where things stand instead.
      if (call.again === true && call.tool !== "browserOpen") {
        return session.missed(call.tool === "browserClose" ? "close" : call.tool === "browserAct" ? "click" : "read");
      }
      const abort = new AbortController();
      running.add(abort);
      const result = take(call, abort.signal)
        .catch((err: unknown) => refused("read", err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : "The browser did not respond."))
        .finally(() => running.delete(abort));
      calls.set(call.toolCallId, result);
      if (calls.size > 80) calls.delete(calls.keys().next().value as string);
      return result;
    },
    /** The user pressed Stop: steps in flight end, and a step waiting for approval counts as declined. */
    stop() {
      for (const abort of running) abort.abort();
    },
    /**
     * The interface was loaded afresh (the window was reloaded, someone signed in or out): the
     * browser view it showed went with the old page. The browser starts clean, and no step is
     * remembered as if it could still be answered: one that is asked for again gets `missed`.
     */
    async reset() {
      for (const abort of running) abort.abort();
      calls.clear();
      if (session.snapshotState().status !== "idle") await session.close();
    },
    /** The agent asks the user to step in: the page is theirs until they hand it back. */
    handover(input: unknown, toolCallId: string) {
      const parsed = requestUserActionInput.safeParse(input);
      const handover: Handover = parsed.success ? { ...parsed.data, toolCallId } : { kind: "other", reason: "The agent needs you to do something on this page.", toolCallId };
      session.requestHandover(handover);
    },
    async control(request: unknown): Promise<BrowserState> {
      const parsed = controlRequestInput.safeParse(request);
      return parsed.success ? session.control(parsed.data) : session.snapshotState();
    },
    state: (): BrowserState => session.snapshotState(),
    /** The interface has put the browser view on screen, and the app has built the bridge to it. */
    offerView: (endpoint: string) => session.offerView(endpoint),
    subscribe: (listener: (event: BrowserEvent) => void) => session.subscribe(listener),
    close: () => session.close(),
  };
}

export type Engine = ReturnType<typeof createEngine>;
