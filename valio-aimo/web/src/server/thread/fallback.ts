import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";

/**
 * A model that answers with a second model when the first stalls or fails, so a demo never hangs on one provider.
 *
 * Streaming: the first model gets `firstChunkMs` to produce its first piece of content (text, reasoning or a tool
 * call; stream metadata does not count). If it errors or stays silent that long, its call is aborted and the same
 * call goes to the fallback model. Once the first model has produced content it keeps the call: switching midway
 * would show the buyer half of one answer and half of another.
 * Generating (no stream): the first model gets `totalMs`, then the fallback is asked.
 *
 * `onFallback` is told each time, for the ledger and the operations trace. The wrapper reports itself as the
 * primary model (provider and id), so prices and telemetry stay keyed by the model actually configured; the
 * telemetry integration still sees the fallback's own provider and id on the call that it answered.
 */
export type FallbackOptions = {
  firstChunkMs: number;
  totalMs: number;
  /**
   * Generating only: after this long without an answer, ask the second model too and take whichever answers first
   * (a hedged request), instead of waiting `totalMs` and then starting over. The slower call is aborted.
   */
  hedgeMs?: number;
  onFallback?: (info: { from: string; to: string; reason: string }) => void;
};

const CONTENT = new Set<LanguageModelV4StreamPart["type"]>(["text-start", "text-delta", "reasoning-start", "reasoning-delta", "tool-input-start", "tool-input-delta", "tool-call", "finish"]);

function linked(parent: AbortSignal | undefined): AbortController {
  const c = new AbortController();
  if (parent) {
    if (parent.aborted) c.abort(parent.reason);
    else parent.addEventListener("abort", () => c.abort(parent.reason), { once: true });
  }
  return c;
}

const describe = (m: LanguageModelV4) => `${m.provider}:${m.modelId}`;

export function withFallback(primary: LanguageModelV4, fallback: LanguageModelV4 | undefined, opts: FallbackOptions): LanguageModelV4 {
  if (!fallback) return primary;
  const switchTo = (reason: string) => opts.onFallback?.({ from: describe(primary), to: describe(fallback), reason });
  async function hedged(options: LanguageModelV4CallOptions, hedgeMs: number) {
    const a = linked(options.abortSignal);
    const b = linked(options.abortSignal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    let settled = false;
    const first = Promise.resolve(primary.doGenerate({ ...options, abortSignal: a.signal })).then((r) => ({ r, by: "primary" as const }));
    const second = new Promise<{ r: Awaited<ReturnType<LanguageModelV4["doGenerate"]>>; by: "fallback" }>((resolve, reject) => {
      const go = () => {
        if (started || settled) return;
        started = true;
        return Promise.resolve(fallback!.doGenerate({ ...options, abortSignal: b.signal })).then((r) => resolve({ r, by: "fallback" }), reject);
      };
      timer = setTimeout(() => {
        switchTo(`no answer in ${hedgeMs} ms: asked the second model too`);
        go();
      }, hedgeMs);
      // The first model failing outright: ask the second at once.
      first.catch(() => {
        if (settled) return;
        if (options.abortSignal?.aborted) return reject(new Error("aborted"));
        clearTimeout(timer);
        switchTo("the first model failed");
        go();
      });
    });
    try {
      const win = await Promise.any([first, second]);
      settled = true;
      (win.by === "primary" ? b : a).abort();
      return win.r;
    } finally {
      settled = true;
      clearTimeout(timer);
    }
  }
  return {
    specificationVersion: "v4",
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,

    async doGenerate(options: LanguageModelV4CallOptions) {
      if (opts.hedgeMs !== undefined) return hedged(options, opts.hedgeMs);
      const ctl = linked(options.abortSignal);
      const timer = setTimeout(() => ctl.abort(new Error(`no answer in ${opts.totalMs} ms`)), opts.totalMs);
      try {
        return await primary.doGenerate({ ...options, abortSignal: ctl.signal });
      } catch (err) {
        if (options.abortSignal?.aborted) throw err;
        switchTo(ctl.signal.aborted ? `no answer in ${opts.totalMs} ms` : String((err as Error)?.message ?? err).slice(0, 200));
        return fallback.doGenerate(options);
      } finally {
        clearTimeout(timer);
      }
    },

    async doStream(options: LanguageModelV4CallOptions) {
      const ctl = linked(options.abortSignal);
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Rejects when the first model stays silent too long, whether or not its transport honours the abort.
      const silence = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          const e = new Error(`no first token in ${opts.firstChunkMs} ms`);
          ctl.abort(e);
          reject(e);
        }, opts.firstChunkMs);
      });
      silence.catch(() => undefined);
      try {
        const res = await Promise.race([primary.doStream({ ...options, abortSignal: ctl.signal }), silence]);
        const reader = res.stream.getReader();
        const head: LanguageModelV4StreamPart[] = [];
        // Read until the first piece of content (or an error part) arrives.
        while (true) {
          const { value, done } = await Promise.race([reader.read(), silence]);
          if (done) break;
          if (value.type === "error") throw value.error;
          head.push(value);
          if (CONTENT.has(value.type)) break;
        }
        clearTimeout(timer);
        const stream = new ReadableStream<LanguageModelV4StreamPart>({
          start(c) {
            for (const p of head) c.enqueue(p);
          },
          async pull(c) {
            const { value, done } = await reader.read();
            if (done) c.close();
            else c.enqueue(value);
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });
        return { ...res, stream };
      } catch (err) {
        clearTimeout(timer);
        if (options.abortSignal?.aborted) throw err;
        ctl.abort();
        switchTo(timedOut ? `no first token in ${opts.firstChunkMs} ms` : String((err as Error)?.message ?? err).slice(0, 200));
        return fallback.doStream(options);
      }
    },
  };
}
