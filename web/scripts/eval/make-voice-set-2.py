#!/usr/bin/env python3
"""
The voice door's second evaluation: two disjoint sets of spoken requests, `dev` (tuned on) and `held` (held out,
never tuned on), written to web/eval/voice/dev/ and web/eval/voice/held/ as 16 kHz mono 16-bit WAV with truth.json.

  python3 -I web/scripts/eval/make-voice-set-2.py            (from the repo root, or any directory)
  ... --clean-to DIR                                          also write each clip's speech without noise (for QA)

Voices: OpenAI TTS (gpt-4o-mini-tts, accents asked for through `instructions`) and macOS `say` voices. The two sets
use different sentences, different voices and different noise seeds. Speech is levelled to -20 dBFS (RMS over the
frames where someone is talking), padded with 0.4 s before and 0.6 s after, then mixed with generated noise at the
stated SNR (speech-active RMS against the noise's RMS over the whole clip):

  chatter      a hall: 8 overlapping voices talking about other things, reverberated and low-passed (distant)
  near-talker  one other person close to the phone, talking about something else
  clatter      a kitchen: pans and plates, impulsive
  music        synthesised chords, bass and a beat
  hum          air conditioning: pink noise, mains hum, a fan

Needs macOS `say`, ffmpeg and numpy. OPENAI_API_KEY from the environment or web/.env.local (never printed). TTS output
is cached in web/.data/voice-tts-cache/ (git-ignored), so a rerun costs nothing and gives the same files.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
import wave

import numpy as np

SR = 16000
WEB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(WEB, "eval", "voice")
CACHE = os.path.join(WEB, ".data", "voice-tts-cache")
os.makedirs(CACHE, exist_ok=True)
TTS_CHARS = [0]  # characters sent to the TTS API this run (not cached)


def api_key():
    k = os.environ.get("OPENAI_API_KEY")
    if k:
        return k
    p = os.path.join(WEB, ".env.local")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            if line.startswith("OPENAI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    sys.exit("OPENAI_API_KEY is not set")


def ff_to_16k(src, fmt_in=None):
    args = ["ffmpeg", "-loglevel", "error", "-y"]
    if fmt_in:
        args += fmt_in
    args += ["-i", src, "-ar", str(SR), "-ac", "1", "-f", "s16le", "-"]
    raw = subprocess.run(args, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0


def tts(engine, voice, text, instructions=""):
    """Speech as float64 at 16 kHz. engine: 'openai' or 'say'. Cached by content."""
    key = hashlib.sha1(json.dumps([engine, voice, text, instructions]).encode()).hexdigest()[:20]
    path = os.path.join(CACHE, f"{key}.npy")
    if os.path.exists(path):
        return np.load(path)
    with tempfile.TemporaryDirectory() as tmp:
        if engine == "say":
            aiff = os.path.join(tmp, "s.aiff")
            subprocess.run(["say", "-v", voice, "-o", aiff, text], check=True)
            x = ff_to_16k(aiff)
        else:
            body = {"model": "gpt-4o-mini-tts", "voice": voice, "input": text, "response_format": "pcm"}
            if instructions:
                body["instructions"] = instructions
            req = urllib.request.Request(
                "https://api.openai.com/v1/audio/speech",
                data=json.dumps(body).encode(),
                headers={"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=120) as r:
                pcm = r.read()
            TTS_CHARS[0] += len(text) + len(instructions)
            raw = os.path.join(tmp, "s.pcm")
            open(raw, "wb").write(pcm)
            x = ff_to_16k(raw, ["-f", "s16le", "-ar", "24000", "-ac", "1"])
    x = trim(x)
    np.save(path, x)
    return x


def trim(x, thr_db=-45):
    """Cut leading and trailing silence (frames 45 dB below the loudest)."""
    f = 320
    n = len(x) // f
    if n == 0:
        return x
    e = np.sqrt(np.mean(x[: n * f].reshape(n, f) ** 2, axis=1) + 1e-12)
    on = np.where(20 * np.log10(e / e.max()) > thr_db)[0]
    return x[max(0, on[0] * f - 800) : min(len(x), (on[-1] + 1) * f + 800)]


def active_rms(x, below_db=35):
    """RMS over 20 ms frames within `below_db` of the loudest frame: the level while someone is talking."""
    f = 320
    n = len(x) // f
    e = np.mean(x[: n * f].reshape(n, f) ** 2, axis=1)
    keep = e > e.max() * 10 ** (-below_db / 10)
    return float(np.sqrt(np.mean(e[keep])))


def rms(x):
    return float(np.sqrt(np.mean(x**2) + 1e-20))


def db(v):
    return 20 * np.log10(v)


# ---------- noise, all generated with fixed seeds ----------


def lowpass(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / (1 + (f / fc) ** 4), len(x))


def highpass(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * (1 - 1 / (1 + (f / fc) ** 4)), len(x))


def reverb(x, rng, t60=0.9, wet=0.7):
    n = int(t60 * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-6.9 * t / t60)
    ir[0] = 0
    ir /= np.sqrt(np.sum(ir**2))
    L = len(x) + n
    y = np.fft.irfft(np.fft.rfft(x, L) * np.fft.rfft(ir, L), L)[: len(x)]
    return (1 - wet) * x + wet * y


def pink(n, rng):
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    y = np.fft.irfft(X / np.sqrt(f), n)
    return y / rms(y)


def fit(x, n, rng):
    """Loop or cut `x` to n samples starting at a random offset."""
    if len(x) < n:
        x = np.tile(x, n // len(x) + 2)
    o = int(rng.integers(0, len(x) - n + 1))
    return x[o : o + n]


def babble(lines, voices, seconds, rng):
    n = int(seconds * SR)
    out = np.zeros(n)
    for i, (voice, text) in enumerate(zip(voices, lines)):
        s = tts("say", voice, text)
        s = s / active_rms(s)
        track = np.zeros(n)
        pos = int(rng.integers(0, SR))
        while pos < n:
            seg = s[: n - pos]
            track[pos : pos + len(seg)] += seg
            pos += len(s) + int(rng.integers(SR // 5, SR))
        out += track * 10 ** (rng.uniform(-4, 2) / 20)
    out = lowpass(reverb(out, rng), 3000)
    return out / rms(out)


def clatter(seconds, rng):
    n = int(seconds * SR)
    out = np.zeros(n)
    t = 0.0
    while t < seconds:
        t += rng.exponential(0.7)
        i = int(t * SR)
        if i >= n:
            break
        L = int(0.35 * SR)
        tt = np.arange(L) / SR
        ev = np.zeros(L)
        for _ in range(int(rng.integers(3, 6))):
            fr = rng.uniform(1200, 7000)
            ev += rng.uniform(0.3, 1) * np.sin(2 * np.pi * fr * tt + rng.uniform(0, 6)) * np.exp(-tt / rng.uniform(0.03, 0.18))
        burst = int(rng.uniform(0.004, 0.02) * SR)
        ev[:burst] += rng.standard_normal(burst) * 1.5
        seg = ev[: n - i] * rng.uniform(0.2, 1.0)
        out[i : i + len(seg)] += seg
    out += 0.05 * pink(n, rng)
    return out / rms(out)


def music(seconds, rng, bpm, chords):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    beat = 60 / bpm
    out = np.zeros(n)
    for k in range(int(seconds / beat) + 1):
        start = int(k * beat * SR)
        L = min(n - start, int(beat * SR))
        if L <= 0:
            break
        tt = np.arange(L) / SR
        notes = chords[(k // 4) % len(chords)]
        env = np.minimum(1, tt / 0.02) * np.exp(-tt / (beat * 0.9))
        pad = sum(sum(np.sin(2 * np.pi * f * h * tt) / h for h in (1, 2, 3)) for f in notes)
        out[start : start + L] += 0.25 * pad * env
        out[start : start + L] += 0.5 * np.sin(2 * np.pi * notes[0] / 2 * tt) * env  # bass
        if k % 2 == 0:  # kick
            kk = np.sin(2 * np.pi * (40 + 50 * np.exp(-tt / 0.04)) * tt) * np.exp(-tt / 0.15)
            out[start : start + L] += 1.2 * kk
        else:  # snare
            out[start : start + L] += 0.6 * highpass(rng.standard_normal(L), 1500) * np.exp(-tt / 0.08)
        for h in (0, L // 2):  # hi-hat on eighths
            m = min(L - h, int(0.05 * SR))
            out[start + h : start + h + m] += 0.25 * highpass(rng.standard_normal(m), 6000) * np.exp(-np.arange(m) / SR / 0.015)
    out = reverb(out, rng, t60=0.6, wet=0.3)
    return out / rms(out)


def hum(seconds, rng):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    x = lowpass(pink(n, rng), 1500)
    x = x / rms(x)
    x += 0.4 * sum(np.sin(2 * np.pi * 50 * h * t + rng.uniform(0, 6)) / h for h in (1, 2, 3, 4))
    x += 0.2 * np.sin(2 * np.pi * 118 * t) * (1 + 0.3 * np.sin(2 * np.pi * 0.7 * t))
    return x / rms(x)


# ---------- the sets ----------

HALL_DEV = [
    "So the keynote starts at ten and then we split into the workshop rooms upstairs",
    "Did you manage to get the wifi working, mine keeps dropping every few minutes",
    "We should grab a coffee before the next session, the queue is getting long",
    "Their demo was impressive but I am not sure the business model holds up",
    "Has anyone seen the charger for the laptop, I left it by the stage",
    "The jury is coming around at half past, make sure the slides are ready",
    "I think the API rate limit is the real problem, not the latency",
    "Can you send me the link to the repository after the talk",
]
HALL_HELD = [
    "Honestly the best part of the weekend was the sauna on Saturday night",
    "We pivoted twice already and now we are back to the first idea",
    "Is the mentor from the energy company still around or did she leave",
    "The screen in room three is flickering, someone should tell the organisers",
    "Let me show you the dashboard, it updates every five seconds",
    "I have not slept since Friday and the pitch is tomorrow morning",
    "Where do we hand in the final video, is it on the platform",
    "My teammate is debugging the database connection right now",
]
BABBLE_VOICES_DEV = ["Samantha", "Daniel", "Karen", "Rishi", "Moira", "Fred", "Tessa", "Ralph"]
BABBLE_VOICES_HELD = ["Kathy", "Albert", "Tara", "Aman", "Samantha", "Daniel", "Karen", "Moira"]
NEAR_DEV = ("Ralph", "Wait, did you see the robot at table twelve, it was folding shirts by itself")
NEAR_HELD = ("Albert", "I told them the battery would not last, and of course it died during the demo")

# Accents through TTS instructions.
A = {
    "fi-en": "Speak English with a noticeable Finnish accent, like a Finnish chef. Flat intonation, natural pace.",
    "sv-en": "Speak English with a noticeable Swedish accent. Natural pace.",
    "in": "Speak English with an Indian accent, at a natural conversational pace.",
    "ng": "Speak English with a Nigerian accent, at a natural pace.",
    "sc": "Speak English with a Scottish accent, at a natural pace.",
    "south": "Speak English with an American Southern accent, relaxed.",
    "es": "Speak English with a Spanish accent, at a natural pace.",
    "fast": "Speak quickly and a bit hurried, like a busy chef in the middle of service.",
    "tired": "Speak quietly and tiredly, at the end of a long shift, a little mumbled.",
    "fi": "Puhu suomea luontevasti, kuin suomalainen kokki puhelimessa.",
    "sv": "Tala svenska naturligt, som en svensk kock i telefon.",
    "plain": "Speak naturally, like a chef on the phone.",
}


def C(id, lang, cat, voice, said, expect="order", item=None, amount=None, unit=None, weekday=None, when=None):
    eng, v, acc = voice
    return {
        "id": id, "lang": lang, "category": cat, "engine": eng, "voice": v, "accentKey": acc, "said": said, "expect": expect,
        "item": item, "amount": amount, "unit": unit, "weekday": weekday, **({"when": when} if when else {}),
    }


def T(v, acc):
    return ("openai", v, acc)


def S(v):
    return ("say", v, None)


DEV = [
    C("d01", "en", "number", T("alloy", "fi-en"), "Fifty litres of milk for Thursday, please.", item=["milk"], amount=50, unit="L", weekday="Thursday"),
    C("d02", "en", "number", S("Samantha"), "Fifteen kilos of quark, for Friday.", item=["quark", "rahka"], amount=15, unit="kg", weekday="Friday"),
    C("d03", "en", "number", T("ash", "in"), "We need thirteen litres of cooking cream.", item=["cooking cream", "cream", "ruokakerma"], amount=13, unit="L"),
    C("d04", "en", "number", S("Daniel"), "Can I get a hundred and ten litres of oat drink for Monday?", item=["oat"], amount=110, unit="L", weekday="Monday"),
    C("d05", "en", "number", T("coral", "sc"), "Two point five kilos of emmental, please.", item=["emmental", "cheese"], amount=2.5, unit="kg"),
    C("d06", "en", "number", T("echo", "fast"), "Twelve hundred eggs for Saturday.", item=["egg"], amount=1200, unit="pcs", weekday="Saturday"),
    C("d07", "en", "correction", S("Tessa"), "A hundred litres of milk, no, make that two hundred.", item=["milk"], amount=200, unit="L"),
    C("d08", "en", "correction", T("sage", "es"), "Send thirty kilos of butter, sorry, I mean twenty kilos.", item=["butter"], amount=20, unit="kg"),
    C("d09", "fi", "correction", T("verse", "fi"), "Kolmekymmentä litraa kermaa, ei kun neljäkymmentä.", item=["kerma", "cream"], amount=40, unit="L"),
    C("d10", "en", "fi-words", T("alloy", "fi-en"), "Twenty litres of maitoa for tomorrow, please.", item=["maito", "milk"], amount=20, unit="L", when="tomorrow"),
    C("d11", "en", "fi-words", S("Rishi"), "Five kilos of voita and that's it.", item=["voi", "butter"], amount=5, unit="kg"),
    C("d12", "en", "fi-words", T("ash", "fi-en"), "Ten litres of kermaa please, for Wednesday.", item=["kerma", "cream"], amount=10, unit="L", weekday="Wednesday"),
    C("d13", "fi", "fi", S("Satu"), "Tarvitsemme kuusikymmentä litraa laktoositonta maitoa perjantaiksi.", item=["maito", "milk"], amount=60, unit="L", weekday="Friday"),
    C("d14", "fi", "fi", T("coral", "fi"), "Kuusitoista kiloa rahkaa maanantaiksi.", item=["rahka", "quark"], amount=16, unit="kg", weekday="Monday"),
    C("d15", "fi", "fi", S("Satu"), "Kaksi ja puoli kiloa parmesaania, kiitos.", item=["parmesa", "cheese"], amount=2.5, unit="kg"),
    C("d16", "fi", "fi", T("echo", "fi"), "Sata kaksikymmentä kananmunaa lauantaiksi.", item=["kananmun", "muna", "egg"], amount=120, unit="pcs", weekday="Saturday"),
    C("d17", "fi", "fi", T("sage", "fi"), "Neljä laatikkoa kauramaitoa tiistaiksi.", item=["kaura", "oat"], amount=4, unit="pack", weekday="Tuesday"),
    C("d18", "fi", "no-amount", S("Satu"), "Tarvitaan kermaviiliä torstaiksi.", expect="ask", item=["kermaviili", "sour cream"], weekday="Thursday"),
    C("d19", "sv", "sv", S("Alva"), "Vi behöver femtio liter mjölk till torsdag.", item=["mjölk", "milk"], amount=50, unit="L", weekday="Thursday"),
    C("d20", "sv", "sv", T("verse", "sv"), "Femton kilo smör, tack.", item=["smör", "butter"], amount=15, unit="kg"),
    C("d21", "sv", "sv", T("alloy", "sv"), "Hundratio liter havredryck till måndag.", item=["havre", "oat"], amount=110, unit="L", weekday="Monday"),
    C("d22", "sv", "sv", S("Alva"), "Tre lådor yoghurt till fredag.", item=["yoghurt", "jogurt"], amount=3, unit="pack", weekday="Friday"),
    C("d23", "sv", "sv", T("coral", "sv"), "Två och ett halvt kilo ost, tack.", item=["ost", "cheese", "juusto"], amount=2.5, unit="kg"),
    C("d24", "sv", "correction", T("ash", "sv"), "Fyrtio liter grädde, nej förlåt, sextio liter.", item=["grädde", "cream"], amount=60, unit="L"),
    C("d25", "sv", "date", S("Alva"), "Tvåhundra ägg till i morgon.", item=["ägg", "egg"], amount=200, unit="pcs", when="tomorrow"),
    C("d26", "en", "pack", T("echo", "in"), "Eight cases of lactose-free milk for Tuesday.", item=["milk"], amount=8, unit="pack", weekday="Tuesday"),
    C("d27", "en", "pack", S("Daniel"), "Three boxes of butter, please.", item=["butter"], amount=3, unit="pack"),
    C("d28", "en", "date", T("sage", "sc"), "Ninety eggs by Sunday.", item=["egg"], amount=90, unit="pcs", weekday="Sunday"),
    C("d29", "en", "date", S("Samantha"), "Forty litres of whole milk for next Monday.", item=["milk"], amount=40, unit="L", weekday="Monday"),
    C("d30", "en", "number", T("verse", "fast"), "Eighteen kilos of natural yoghurt.", item=["yoghurt", "yogurt"], amount=18, unit="kg"),
    C("d31", "en", "history", S("Tessa"), "Same milk as last time, but seventy litres.", item=["milk"], amount=70, unit="L"),
    C("d32", "en", "history", T("alloy", "es"), "Like last week's oat drink, but thirty litres this time.", item=["oat"], amount=30, unit="L"),
    C("d33", "en", "no-amount", S("Rishi"), "We need cream for Friday.", expect="ask", item=["cream"], weekday="Friday"),
    C("d34", "en", "no-amount", T("coral", "plain"), "Some butter for tomorrow, please.", expect="ask", item=["butter"], when="tomorrow"),
    C("d35", "en", "silence", ("none", "", None), "", expect="nothing"),
    C("d36", "en", "silence", ("none", "", None), "", expect="nothing"),
]

HELD = [
    C("h01", "en", "number", T("ballad", "sv-en"), "Fifteen litres of cream for Tuesday.", item=["cream"], amount=15, unit="L", weekday="Tuesday"),
    C("h02", "en", "number", S("Karen"), "Fifty kilos of butter, please.", item=["butter"], amount=50, unit="kg"),
    C("h03", "en", "number", T("fable", "ng"), "Thirty litres of oat drink.", item=["oat"], amount=30, unit="L"),
    C("h04", "en", "number", S("Moira"), "Sixteen kilos of cheddar for Thursday.", item=["cheddar", "cheese"], amount=16, unit="kg", weekday="Thursday"),
    C("h05", "en", "number", T("nova", "south"), "One and a half kilos of parmesan.", item=["parmesan", "cheese"], amount=1.5, unit="kg"),
    C("h06", "en", "number", S("Aman"), "A hundred and fifty litres of lactose-free milk by Friday.", item=["milk"], amount=150, unit="L", weekday="Friday"),
    C("h07", "en", "number", T("onyx", "tired"), "Eighty eggs, please.", item=["egg"], amount=80, unit="pcs"),
    C("h08", "en", "correction", T("shimmer", "ng"), "Forty litres of cooking cream, no wait, fifty.", item=["cooking cream", "cream", "ruokakerma"], amount=50, unit="L"),
    C("h09", "en", "correction", S("Reed (English (US))"), "Twelve kilos of quark, actually make it fourteen.", item=["quark", "rahka"], amount=14, unit="kg"),
    C("h10", "fi", "correction", T("marin", "fi"), "Sata litraa maitoa, eiku sataviisikymmentä.", item=["maito", "milk"], amount=150, unit="L"),
    C("h11", "sv", "correction", T("ballad", "sv"), "Tjugo kilo smör, nej, trettio kilo.", item=["smör", "butter"], amount=30, unit="kg"),
    C("h12", "en", "fi-words", T("onyx", "fi-en"), "Thirty litres of laktoositon maito for Monday.", item=["maito", "milk"], amount=30, unit="L", weekday="Monday"),
    C("h13", "en", "fi-words", S("Karen"), "Eight kilos of rahka, please.", item=["rahka", "quark"], amount=8, unit="kg"),
    C("h14", "en", "fi-words", T("nova", "fi-en"), "Could I have twelve litres of ruokakerma for Saturday?", item=["ruokakerma", "kerma", "cream"], amount=12, unit="L", weekday="Saturday"),
    C("h15", "fi", "fi", S("Shelley (Finnish (Finland))"), "Viisikymmentä litraa kauramaitoa keskiviikoksi.", item=["kaura", "oat"], amount=50, unit="L", weekday="Wednesday"),
    C("h16", "fi", "fi", T("fable", "fi"), "Viisitoista kiloa voita, kiitos.", item=["voi", "butter"], amount=15, unit="kg"),
    C("h17", "fi", "date", S("Eddy (Finnish (Finland))"), "Kolmesataa kananmunaa huomiseksi.", item=["kananmun", "muna", "egg"], amount=300, unit="pcs", when="tomorrow"),
    C("h18", "fi", "fi", T("shimmer", "fi"), "Kuusi laatikkoa jogurttia perjantaiksi.", item=["jogurt", "yoghurt"], amount=6, unit="pack", weekday="Friday"),
    C("h19", "fi", "fi", S("Shelley (Finnish (Finland))"), "Yksi ja puoli kiloa emmentalia.", item=["emmental", "juusto", "cheese"], amount=1.5, unit="kg"),
    C("h20", "sv", "sv", T("cedar", "sv"), "Sextio liter laktosfri mjölk till onsdag.", item=["mjölk", "milk"], amount=60, unit="L", weekday="Wednesday"),
    C("h21", "sv", "sv", T("fable", "sv"), "Tretton kilo kvarg, tack.", item=["kvarg", "quark", "rahka"], amount=13, unit="kg"),
    C("h22", "sv", "sv", T("onyx", "sv"), "Åttio liter matlagningsgrädde till lördag.", item=["grädde", "cream"], amount=80, unit="L", weekday="Saturday"),
    C("h23", "sv", "sv", T("fable", "sv"), "Fem lådor havredryck.", item=["havre", "oat"], amount=5, unit="pack"),
    C("h24", "sv", "sv", T("shimmer", "sv"), "Hundrafemtio ägg till fredag.", item=["ägg", "egg"], amount=150, unit="pcs", weekday="Friday"),
    C("h25", "sv", "no-amount", T("ballad", "sv"), "Vi behöver gräddfil till tisdag.", expect="ask", item=["gräddfil", "sour cream", "kermaviili"], weekday="Tuesday"),
    C("h26", "en", "pack", S("Aman"), "Four crates of milk for Wednesday.", item=["milk"], amount=4, unit="pack", weekday="Wednesday"),
    C("h27", "en", "pack", T("marin", "south"), "Ten packs of butter.", item=["butter"], amount=10, unit="pack"),
    C("h28", "en", "date", S("Moira"), "Twenty-five litres of whole milk for tomorrow morning.", item=["milk"], amount=25, unit="L", when="tomorrow"),
    C("h29", "en", "date", T("fable", "sv-en"), "Two hundred and forty eggs by Monday.", item=["egg"], amount=240, unit="pcs", weekday="Monday"),
    C("h30", "en", "history", T("cedar", "plain"), "Same oat drink as last time, but forty litres.", item=["oat"], amount=40, unit="L"),
    C("h31", "en", "history", T("nova", "tired"), "The yoghurt we had last week, nineteen kilos this time.", item=["yoghurt", "yogurt"], amount=19, unit="kg"),
    C("h32", "en", "no-amount", T("onyx", "south"), "We're out of sour cream, can you send some for Thursday?", expect="ask", item=["sour cream", "kermaviili", "smetana"], weekday="Thursday"),
    C("h33", "fi", "no-amount", S("Eddy (Finnish (Finland))"), "Tarvitsen kananmunia viikonlopuksi.", expect="ask", item=["kananmun", "muna", "egg"]),
    C("h34", "en", "plain", T("shimmer", "fi-en"), "Twenty kilos of smetana for Friday.", item=["smetana", "sour cream"], amount=20, unit="kg", weekday="Friday"),
    C("h35", "en", "silence", ("none", "", None), "", expect="nothing"),
    C("h36", "en", "silence", ("none", "", None), "", expect="nothing"),
]

# Noise per speech clip (34 per set): none 9; chatter 9 (+10 x4, +5 x3, 0 x2); clatter 5; music 5; hum 4; near-talker 2.
NOISE_PLAN = (
    [("none", None)] * 9
    + [("chatter", 10)] * 4 + [("chatter", 5)] * 3 + [("chatter", 0)] * 2
    + [("clatter", 10)] * 2 + [("clatter", 5)] * 2 + [("clatter", 0)]
    + [("music", 10)] * 2 + [("music", 5)] * 2 + [("music", 0)]
    + [("hum", 10)] * 2 + [("hum", 5)] * 2
    + [("near-talker", 5), ("near-talker", 0)]
)
SILENCE = {"d35": "hum", "d36": "chatter", "h35": "clatter", "h36": "chatter"}
SPEECH_DBFS = -20.0
ACCENT_NAME = {
    "fi-en": "Finnish-accented English", "sv-en": "Swedish-accented English", "in": "Indian", "ng": "Nigerian", "sc": "Scottish",
    "south": "American Southern", "es": "Spanish-accented English", "fast": "hurried", "tired": "quiet, tired", "fi": "Finnish",
    "sv": "Swedish", "plain": "neutral",
}
SAY_ACCENT = {"Samantha": "American", "Daniel": "British", "Rishi": "Indian", "Tessa": "South African", "Satu": "Finnish", "Alva": "Swedish",
              "Karen": "Australian", "Moira": "Irish", "Aman": "Indian", "Reed (English (US))": "American", "Shelley (Finnish (Finland))": "Finnish",
              "Eddy (Finnish (Finland))": "Finnish"}


def build(name, clips, seed, hall, babble_voices, near, bpm, chords):
    rng = np.random.default_rng(seed)
    out_dir = os.path.join(OUT, name)
    os.makedirs(out_dir, exist_ok=True)
    beds = {
        "chatter": babble(hall, babble_voices, 40, np.random.default_rng(seed + 1)),
        "clatter": clatter(40, np.random.default_rng(seed + 2)),
        "music": music(40, np.random.default_rng(seed + 3), bpm, chords),
        "hum": hum(40, np.random.default_rng(seed + 4)),
    }
    near_speech = tts("say", near[0], near[1])
    speech_clips = [c for c in clips if c["expect"] != "nothing"]
    order = rng.permutation(len(speech_clips))
    plan = {speech_clips[i]["id"]: NOISE_PLAN[k] for k, i in enumerate(order)}
    truth = {}
    report = []
    for c in clips:
        if c["expect"] == "nothing":
            kind = SILENCE[c["id"]]
            n = int(4.0 * SR)
            mix = fit(beds[kind], n, rng) * 10 ** ((-30 if kind != "chatter" else -24) / 20)
            noise, snr, speech_db = kind, None, None
        else:
            noise, snr = plan[c["id"]]
            s = tts(c["engine"], c["voice"], c["said"], A.get(c["accentKey"] or "", ""))
            s = s / active_rms(s) * 10 ** (SPEECH_DBFS / 20)
            s = np.concatenate([np.zeros(int(0.4 * SR)), s, np.zeros(int(0.6 * SR))])
            mix = s.copy()
            if noise != "none":
                if noise == "near-talker":
                    nb = fit(np.concatenate([near_speech, np.zeros(SR // 3)]), len(s), rng)
                    nb = nb / rms(nb)
                else:
                    nb = fit(beds[noise], len(s), rng)
                    nb = nb / rms(nb)
                target = active_rms(s) / 10 ** (snr / 20)
                mix = s + nb * target
            speech_db = round(db(active_rms(s)), 1)
        if CLEAN_DIR and c["expect"] != "nothing":
            os.makedirs(os.path.join(CLEAN_DIR, name), exist_ok=True)
            with wave.open(os.path.join(CLEAN_DIR, name, f"{c['id']}.wav"), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SR)
                w.writeframes((np.clip(s, -1, 1) * 32767).astype("<i2").tobytes())
        peak = np.max(np.abs(mix))
        if peak > 0.95:
            mix = mix * 0.95 / peak  # keeps the SNR; speech level drops a little
        file = f"{c['id']}-{c['lang']}-{c['category']}-{noise}{'' if snr is None else str(snr)}.wav"
        with wave.open(os.path.join(out_dir, file), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes())
        if c["engine"] == "openai":
            voice, accent = f"openai:{c['voice']}", ACCENT_NAME[c["accentKey"]]
        elif c["engine"] == "say":
            voice, accent = f"say:{c['voice']}", SAY_ACCENT.get(c["voice"], "")
        else:
            voice, accent = None, None
        t = {"lang": c["lang"], "accent": accent, "voice": voice, "noise": noise, "snr": snr, "category": c["category"], "said": c["said"], "expect": c["expect"],
             "item": c["item"], "amount": c["amount"], "unit": c["unit"], "weekday": c["weekday"]}
        if "when" in c:
            t["when"] = c["when"]
        truth[file] = t
        # Check: SNR measured on the written mix (speech-active RMS of the speech part against the RMS of the rest).
        measured = None
        if c["expect"] != "nothing" and noise != "none":
            g = 0.95 / peak if peak > 0.95 else 1.0
            measured = db(active_rms(s * g) / rms(mix - s * g))
        report.append((file, round(len(mix) / SR, 2), round(db(rms(mix)), 1), speech_db, snr, None if measured is None else round(measured, 1)))
    with open(os.path.join(out_dir, "truth.json"), "w", encoding="utf-8") as f:
        json.dump(truth, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return report


CLEAN_DIR = sys.argv[sys.argv.index("--clean-to") + 1] if "--clean-to" in sys.argv else None


def main():
    r1 = build("dev", DEV, 1001, HALL_DEV, BABBLE_VOICES_DEV, NEAR_DEV, 112, [(261.6, 329.6, 392.0), (196.0, 246.9, 293.7), (220.0, 261.6, 329.6), (174.6, 220.0, 261.6)])
    r2 = build("held", HELD, 2002, HALL_HELD, BABBLE_VOICES_HELD, NEAR_HELD, 96, [(293.7, 370.0, 440.0), (246.9, 311.1, 370.0), (196.0, 246.9, 293.7), (220.0, 277.2, 329.6)])
    for name, r in (("dev", r1), ("held", r2)):
        print(f"== {name}: {len(r)} clips")
        for row in r:
            print("  %-42s %5.2fs mix %6.1f dBFS speech %s dBFS snr %s measured %s" % row)
    print(f"TTS characters sent this run: {TTS_CHARS[0]}")


if __name__ == "__main__":
    main()
