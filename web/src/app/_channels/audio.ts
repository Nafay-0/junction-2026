"use client";

/**
 * Microphone in, agent voice out, for the call screen. Browser only, no dependencies.
 *
 *   capture   getUserMedia with echo cancellation, noise suppression and gain control on; an AudioWorklet hands
 *             frames to this thread, which downsamples to 16 kHz, 16-bit little-endian PCM (what the Live API takes)
 *             and emits base64 chunks of about 100 ms.
 *   playback  24 kHz 16-bit PCM from the Live API, scheduled back to back with a short jitter buffer, so the
 *             grounding check can cut a sentence before most of it is heard.
 *
 * Mobile: both are created inside the tap that starts the call (iOS Safari only lets audio play and the
 * microphone open from a user gesture), and the same AudioContext is resumed on every later tap.
 */

const WORKLET = `
class DockCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("dock-capture", DockCapture);
`;

export type MicProblem = "denied" | "no_device" | "insecure" | "unsupported" | "failed";

export function micProblem(err: unknown): MicProblem {
  const name = (err as { name?: string })?.name;
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no_device";
  if (name === "NotSupportedError" || name === "TypeError") return "unsupported";
  return "failed";
}

export const MIC_TEXT: Record<MicProblem, string> = {
  denied: "The microphone is blocked for this page. Allow it in the browser's site settings, or type instead.",
  no_device: "No microphone was found. Type instead.",
  insecure: "The microphone only works on a secure (https) address. Type instead.",
  unsupported: "The microphone is not available to this page (blocked, or not supported by this browser). Allow it in the site settings, or type instead.",
  failed: "The microphone could not start. Type instead.",
};

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Float32 frames at `rate` to `target` Hz (16 kHz for Gemini, 24 kHz for OpenAI) Int16, averaging each output sample's input span. */
export function downsampleTo16k(input: Float32Array, rate: number, target = 16000): Int16Array {
  const ratio = rate / target;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export class CallAudio {
  readonly ctx: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  private sending = false;
  private playing: AudioBufferSourceNode[] = [];
  private playAt = 0;
  private gain: GainNode;
  /** Seconds of audio sent and received, for the cost estimate. */
  readonly seconds = { in: 0, out: 0 };
  /** Rough loudness of the last captured frames, 0..1, for the level meter. */
  level = 0;
  /** The sample rate the voice provider takes (set once the call's session is known). */
  rate = 16000;
  /** The microphone stopped by itself (permission revoked, device unplugged, another app took it). */
  onMicEnded?: () => void;
  /** The audio context was suspended or interrupted by the system (a phone call, Siri, the page in the background). */
  onAudioState?: (state: string) => void;

  constructor(
    private readonly onChunk: (b64: string) => void,
    private readonly onSpeaking: (speaking: boolean) => void,
  ) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.ctx.onstatechange = () => this.onAudioState?.(this.ctx.state);
    // Safari 16.4+: ask for a call-style audio session, so the microphone and playback coexist.
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = "play-and-record";
      } catch {
        /* not supported: the default session still works */
      }
    }
  }

  /** Must be called from a tap. Resolves when the microphone is open; throws the browser's error otherwise. */
  async openMic(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no getUserMedia"), { name: "NotSupportedError" });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    for (const t of this.stream.getAudioTracks()) t.onended = () => this.onMicEnded?.();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "dock-capture");
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.frame(e.data);
    this.source.connect(this.node);
    // The worklet must be pulled by the graph to run; a muted gain keeps it silent.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
  }

  /** The open microphone, for a provider that takes it as a WebRTC track. */
  get micStream(): MediaStream | undefined {
    return this.stream;
  }

  /**
   * Play the agent's voice from a WebRTC remote stream through this call's speaker path, so stopPlayback can cut it.
   * Chrome only starts a remote WebRTC stream's audio once a media element holds it, so a muted one does.
   */
  playStream(remote: MediaStream) {
    const holder = new Audio();
    holder.muted = true;
    holder.srcObject = remote;
    void holder.play().catch(() => {});
    this.remote?.disconnect();
    this.remote = this.ctx.createMediaStreamSource(remote);
    this.remote.connect(this.gain);
  }
  private remote?: MediaStreamAudioSourceNode;

  get micOpen(): boolean {
    return !!this.stream?.getAudioTracks().some((t) => t.readyState === "live");
  }

  resume() {
    if (this.ctx.state !== "running" && this.ctx.state !== "closed") void this.ctx.resume().catch(() => {});
  }

  get audioState(): string {
    return this.ctx.state;
  }

  /** Start or stop sending microphone audio (push-to-talk, or hands-free with the agent silent). */
  setSending(on: boolean) {
    if (!on && this.sending) this.flush();
    this.sending = on;
    if (on) {
      this.pending = [];
      this.pendingLen = 0;
    }
  }

  get isSending() {
    return this.sending;
  }

  private frame(f: Float32Array) {
    let peak = 0;
    for (let i = 0; i < f.length; i += 8) peak = Math.max(peak, Math.abs(f[i]));
    this.level = this.level * 0.7 + peak * 0.3;
    if (!this.sending) return;
    this.pending.push(f);
    this.pendingLen += f.length;
    if (this.pendingLen >= this.ctx.sampleRate / 10) this.flush();
  }

  private flush() {
    if (!this.pendingLen) return;
    const all = new Float32Array(this.pendingLen);
    let o = 0;
    for (const p of this.pending) {
      all.set(p, o);
      o += p.length;
    }
    this.pending = [];
    this.pendingLen = 0;
    const pcm = downsampleTo16k(all, this.ctx.sampleRate, this.rate);
    this.seconds.in += pcm.length / this.rate;
    this.onChunk(toBase64(new Uint8Array(pcm.buffer)));
  }

  /** Queue 24 kHz PCM from the agent. */
  play(b64: string) {
    const bytes = fromBase64(b64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    if (!samples.length) return;
    const buf = this.ctx.createBuffer(1, samples.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    // 250 ms of jitter buffer when a sentence starts: smoother on mobile data, and time for the grounding check.
    if (this.playAt < now) this.playAt = now + 0.25;
    src.start(this.playAt);
    this.playAt += buf.duration;
    this.seconds.out += buf.duration;
    if (!this.playing.length) this.onSpeaking(true);
    this.playing.push(src);
    src.onended = () => {
      this.playing = this.playing.filter((s) => s !== src);
      if (!this.playing.length) this.onSpeaking(false);
    };
  }

  get speaking() {
    return this.playing.length > 0;
  }

  /** Cut the agent off now: barge-in, or a sentence the grounding check refused. */
  stopPlayback() {
    if (this.remote) {
      // WebRTC: the provider is told to stop (stopSpeaking); mute what is already on its way for a moment.
      const t = this.ctx.currentTime;
      this.gain.gain.setValueAtTime(0, t);
      this.gain.gain.setValueAtTime(1, t + 0.6);
    }
    for (const s of this.playing) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    const was = this.playing.length > 0;
    this.playing = [];
    this.playAt = 0;
    if (was) this.onSpeaking(false);
  }

  /** A short two-tone ring while the call connects. Returns a stop function. */
  ring(): () => void {
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.ctx.destination);
    const oscs = [440, 480].map((f) => {
      const o = this.ctx.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      return o;
    });
    for (let i = 0; i < 4; i++) {
      g.gain.setValueAtTime(0.08, t + i * 3);
      g.gain.setValueAtTime(0, t + i * 3 + 1.2);
    }
    return () => {
      for (const o of oscs) {
        try {
          o.stop();
        } catch {
          /* stopped */
        }
      }
      g.disconnect();
    };
  }

  close() {
    this.stopPlayback();
    this.node?.disconnect();
    this.source?.disconnect();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.ctx.onstatechange = null;
    void this.ctx.close().catch(() => {});
  }
}
