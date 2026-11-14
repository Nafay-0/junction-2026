"use client";

import { MIC_RATE, SPEAKER_RATE } from "./models";

/*
 * Sound in and out of the browser for voice: the microphone as small pieces of 16 kHz speech,
 * and a speaker that plays the agent's voice the moment it arrives and can be cut off at once.
 *
 * Both run in audio worklets, off the page's main thread, so a busy interface never makes the
 * voice stutter. Nothing here is recorded or kept: sound goes from the microphone to the socket
 * and from the socket to the speaker.
 */

/** The microphone, downsampled to what the Live API takes, 40 ms at a time. */
const MIC_WORKLET = `
class BerylMic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / ${MIC_RATE};
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.out = new Int16Array(${Math.round(MIC_RATE * 0.04)});
    this.filled = 0;
    this.energy = 0;
    this.muted = false;
    this.port.onmessage = (event) => { this.muted = Boolean(event.data.muted); };
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      // Average the samples that fall into one output sample: a plain low-pass, enough for speech.
      this.sum += input[i];
      this.count += 1;
      this.phase += 1;
      if (this.phase >= this.step) {
        this.phase -= this.step;
        const value = this.muted ? 0 : this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        this.energy += value * value;
        this.out[this.filled++] = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
        if (this.filled === this.out.length) {
          const pcm = this.out.slice();
          this.port.postMessage({ pcm: pcm.buffer, level: Math.sqrt(this.energy / this.filled) }, [pcm.buffer]);
          this.filled = 0;
          this.energy = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("beryl-mic", BerylMic);
`;

/** The speaker: a queue of speech that starts at once, reports how far it has got, and empties on demand. */
const SPEAKER_WORKLET = `
class BerylSpeaker extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.queued = 0;
    this.played = 0;
    this.position = 0;
    this.step = ${SPEAKER_RATE} / sampleRate;
    this.playing = false;
    this.ticks = 0;
    this.energy = 0;
    this.frames = 0;
    this.port.onmessage = (event) => {
      if (event.data.type === "push") {
        const samples = new Float32Array(event.data.samples);
        this.queue.push(samples);
        this.queued += samples.length;
      } else if (event.data.type === "flush") {
        this.queue = [];
        this.offset = 0;
        this.queued = 0;
        this.position = 0;
        this.playing = false;
        this.port.postMessage({ type: "state", level: 0, played: this.played, queued: 0, idle: true });
      }
    };
  }
  next() {
    // One source sample, or null when the queue has run dry.
    while (this.queue.length && this.offset >= this.queue[0].length) {
      this.offset -= this.queue[0].length;
      this.queue.shift();
    }
    if (!this.queue.length) return null;
    return this.queue[0][this.offset];
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    // Wait for a little speech to be in hand before starting, so the first word does not break up.
    if (!this.playing && this.queued >= ${Math.round(SPEAKER_RATE * 0.06)}) this.playing = true;
    let wrote = 0;
    if (this.playing) {
      for (let i = 0; i < out.length; i++) {
        const sample = this.next();
        if (sample === null) { this.playing = false; break; }
        out[i] = sample;
        this.energy += sample * sample;
        wrote += 1;
        // Step through the source at its own rate: one for one when the output runs at the same rate.
        this.position += this.step;
        const whole = Math.floor(this.position);
        if (whole > 0) {
          this.position -= whole;
          this.offset += whole;
          this.queued = Math.max(0, this.queued - whole);
          this.played += whole;
        }
      }
    }
    this.frames += out.length;
    if (++this.ticks % 8 === 0) {
      this.port.postMessage({ type: "state", level: Math.sqrt(this.energy / Math.max(1, this.frames)), played: this.played, queued: this.queued, idle: !this.playing && this.queued === 0 });
      this.energy = 0;
      this.frames = 0;
    }
    return true;
  }
}
registerProcessor("beryl-speaker", BerylSpeaker);
`;

const moduleUrl = (code: string) => URL.createObjectURL(new Blob([code], { type: "application/javascript" }));

const toBase64 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

type AudioContextClass = typeof AudioContext;
const contextClass = (): AudioContextClass | undefined =>
  typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext);

/** True when this browser can take part in voice at all. */
export function voiceSupported(): boolean {
  return Boolean(contextClass()) && typeof AudioWorkletNode !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof WebSocket !== "undefined";
}

/** Why the microphone could not be opened, in words for the user. */
export function microphoneProblem(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "The microphone is blocked. Allow it for this site in your browser's settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found.";
  if (name === "NotReadableError") return "Another app is using the microphone.";
  return "The microphone could not be opened.";
}

export class Microphone {
  /** How loud the last piece was, 0 to about 1. Read it from an animation frame; it is not React state. */
  level = 0;
  private constructor(
    private context: AudioContext,
    private stream: MediaStream,
    private node: AudioWorkletNode,
  ) {}

  /**
   * Open the microphone and start handing over speech. Call it from a tap or a click: browsers
   * only let sound start from one. `onChunk` gets 40 ms of 16 kHz PCM, base64, ready to send.
   */
  static async open(onChunk: (base64: string) => void): Promise<Microphone> {
    const Context = contextClass();
    if (!Context || !navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use the microphone.");
    // Echo cancellation is what lets the user talk over the agent's voice without the agent hearing itself.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const context = new Context({ latencyHint: "interactive" });
    try {
      const url = moduleUrl(MIC_WORKLET);
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "beryl-mic", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
      const mic = new Microphone(context, stream, node);
      node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
        mic.level = event.data.level;
        onChunk(toBase64(new Uint8Array(event.data.pcm)));
      };
      source.connect(node);
      if (context.state === "suspended") await context.resume();
      return mic;
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => {});
      throw err;
    }
  }

  /** Muted, the microphone stays open and sends silence: the call goes on, the user is not heard. */
  mute(muted: boolean) {
    this.node.port.postMessage({ muted });
    if (muted) this.level = 0;
  }

  close() {
    this.node.port.onmessage = null;
    this.node.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
    void this.context.close().catch(() => {});
    this.level = 0;
  }
}

export class Speaker {
  /** How loud the agent's voice is right now, 0 to about 1. */
  level = 0;
  /** How much speech has been played and how much is waiting, in samples at 24 kHz. */
  played = 0;
  queued = 0;
  /** Everything handed over so far, in samples. With `played` it says how far through its words the agent is. */
  received = 0;
  idle = true;
  /** Called when the last of what was queued has been played. */
  onIdle?: () => void;
  private node?: AudioWorkletNode;
  private ready: Promise<void>;

  private constructor(private context: AudioContext) {
    this.ready = (async () => {
      const url = moduleUrl(SPEAKER_WORKLET);
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(context, "beryl-speaker", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = (event: MessageEvent<{ level: number; played: number; queued: number; idle: boolean }>) => {
        this.level = event.data.level;
        this.played = event.data.played;
        this.queued = event.data.queued;
        const wasIdle = this.idle;
        this.idle = event.data.idle;
        if (!wasIdle && this.idle) this.onIdle?.();
      };
      node.connect(context.destination);
      this.node = node;
    })();
  }

  /** Make the speaker. Call it straight from a tap or a click, before anything is awaited: that is what lets it make sound. */
  static create(): Speaker {
    const Context = contextClass();
    if (!Context) throw new Error("This browser cannot play sound.");
    let context: AudioContext;
    try {
      // At the voice's own rate there is nothing to convert.
      context = new Context({ sampleRate: SPEAKER_RATE, latencyHint: "interactive" });
    } catch {
      context = new Context({ latencyHint: "interactive" });
    }
    void context.resume().catch(() => {});
    return new Speaker(context);
  }

  /** Play a piece of the agent's voice: 24 kHz PCM, base64, as the Live API sends it. */
  play(base64: string) {
    const text = atob(base64);
    const samples = new Float32Array(text.length >> 1);
    for (let i = 0; i < samples.length; i++) {
      const value = text.charCodeAt(i * 2) | (text.charCodeAt(i * 2 + 1) << 8);
      samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 32768;
    }
    this.received += samples.length;
    this.idle = false;
    void this.ready.then(() => this.node?.port.postMessage({ type: "push", samples: samples.buffer }, [samples.buffer]));
    if (this.context.state === "suspended") void this.context.resume().catch(() => {});
  }

  /** Stop speaking now: the user has started to talk, or the call is over. */
  flush() {
    this.received = this.played;
    this.level = 0;
    void this.ready.then(() => this.node?.port.postMessage({ type: "flush" }));
  }

  close() {
    this.onIdle = undefined;
    if (this.node) this.node.port.onmessage = null;
    this.node?.disconnect();
    void this.context.close().catch(() => {});
    this.level = 0;
  }
}
