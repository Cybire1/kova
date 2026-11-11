"""
The sound of "Ramps" (src/ramps): the voice, the score, and the film's own effects, synthesised here
and placed on the frames of what they belong to. One master: a fixed gain to -14 LUFS and a limiter
for peaks only (loudnorm would compress the voice into the music).

  score    kovaphone/music-a (ElevenLabs, 103.4 BPM), 0.4 s in; ducked about 12 dB under the voice
  voice    public/ramps/audio (Sarah), at the starts in Film.tsx's VO
  effects  a soft chord for the opening pair, air as the phone travels, taps and key ticks where the
           recordings were touched, a glass pair for OPay's "Transfer successful", a clock's ticks
           on the recording's own seconds while Kova waits, D major chimes when money lands or the
           cash-out is done, the alert's two notes, a marker stroke, a bell chord under the mark.

Film.tsx's SEGS (which film seconds play which seconds of which recording) are repeated here.
Writes public/ramps/mix.wav (and voice.wav, score.wav, effects.wav to check levels).
Run: python3 scripts/ramps/sound.py
"""

import json
import subprocess
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parents[2]
P = ROOT / "public/ramps"
SR = 48_000
DUR = 42.0
N = int(SR * DUR)
rng = np.random.default_rng(2810)

# Film.tsx's clock.
VO = {"hook": 0.3, "in": 3.9, "lands": 11.2, "crypto": 16.4, "out": 23.2, "done": 32.6, "end": 35.7}
FLOW, DEP, ARR, TA, TB = "flow", "dep", "arr", "ta", "tb"
SEGS = [
    (3.45, 4.9, FLOW, 2.8, 5.8), (4.9, 6.3, FLOW, 5.8, 10.3), (6.3, 7.7, FLOW, 10.3, 12.25),
    (7.7, 8.4, FLOW, 12.25, 15.5), (8.4, 10.0, FLOW, 15.6, 17.2), (10.0, 11.0, FLOW, 43.5, 44.1),
    (11.0, 12.6, FLOW, 46.0, 53.2), (12.6, 16.2, FLOW, 53.2, 56.8),
    (16.2, 17.5, DEP, 5.9, 7.2), (17.5, 19.4, DEP, 7.2, 7.2), (19.4, 22.6, ARR, 0.2, 3.4),
    (22.6, 28.6, TA, 0.4, 11.0), (28.6, 30.5, TA, 11.0, 12.9), (30.5, 32.4, TB, 0.0, 7.0), (32.4, 36.2, TB, 7.0, 10.8),
]


def film(src, at):
    for a, b, s, f, t in SEGS:
        if s == src and t > f and f <= at <= t:
            return a + (at - f) / (t - f) * (b - a)
    raise ValueError((src, at))


take = json.loads((ROOT / "public/credit-alert/take-a.json").read_text())
TAPS = [film(FLOW, 5.45), film(FLOW, 10.45), film(FLOW, 12.2), film(DEP, 6.15)] + [film(TA, p["t"]) for p in take["taps"]]
KEYS = [film(TA, k["t"] + i * k["delay"]) for k in take["typed"] for i in range(len(k["text"]))]
SEND = film(TA, take["taps"][-1]["t"])
TICKS = [film(FLOW, s) for s in range(47, 54)]  # the recording's own seconds while Kova waits
LANDED, CRYPTO, DONE = 12.6, 19.4, film(TB, 6.533)
TRAVELS = [3.1, 15.9, 22.3]
OPAY, ALERT, LEAVES = 10.0, 33.25, 35.2

NOTE = {"D5": 587.33, "E5": 659.26, "F#5": 739.99, "A5": 880.0, "B5": 987.77, "D6": 1174.66, "E6": 1318.51,
        "F#6": 1479.98, "A6": 1760.0, "B6": 1975.53, "D4": 293.66, "A4": 440.0, "F#4": 369.99}


def t_(d):
    return np.arange(int(d * SR)) / SR


def env(d, attack=0.004, decay=0.3):
    t = t_(d)
    return np.minimum(1, t / attack) * np.exp(-t / decay)


def bell(f, d=1.2, decay=0.45, partials=((1, 1), (2.76, 0.3), (5.4, 0.12))):
    t = t_(d)
    return sum(a * np.sin(2 * np.pi * f * m * t) * np.exp(-t / (decay / m**0.5)) for m, a in partials) * np.minimum(1, t / 0.003)


def noise(d):
    return rng.standard_normal(int(d * SR))


def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), x)


def sweep(d, f0, f1, q=1.6, shape=None):
    """Filtered air whose centre moves from f0 to f1: a whoosh."""
    x = noise(d)
    out = np.zeros_like(x)
    steps = 24
    edges = np.linspace(0, len(x), steps + 1).astype(int)
    for i in range(steps):
        f = f0 * (f1 / f0) ** (i / (steps - 1))
        seg = band(x, f / q, min(f * q, SR / 2 - 100))[edges[i] : edges[i + 1]]
        out[edges[i] : edges[i + 1]] = seg
    s = np.sin(np.pi * np.linspace(0, 1, len(x))) ** 2 if shape is None else shape(np.linspace(0, 1, len(x)))
    return out * s


L = np.zeros(N)
R = np.zeros(N)


def place(sig, at, gain=1.0, pan=0.0):
    i = int(round(at * SR))
    if i >= N:
        return
    s = sig[: N - i] * gain
    a = (pan + 1) * np.pi / 4
    L[i : i + len(s)] += s * np.cos(a) * np.sqrt(2)
    R[i : i + len(s)] += s * np.sin(a) * np.sqrt(2)


def chime(at, notes, gain=0.075, glints=6):
    for j, n in enumerate(notes):
        place(bell(NOTE[n], 1.6, 0.6), at + j * 0.075, gain + 0.01 * j, 0.15 * (j - 1.5))
    for j in range(glints):
        f = NOTE[["A6", "B6", "D6", "E6", "F#6", "A6", "B6"][j % 7]]
        place(bell(f, 0.4, 0.09, ((1, 1), (3.1, 0.2))), at + 0.2 + j * 0.11 + 0.03 * rng.random(), 0.022, rng.uniform(-0.6, 0.6))


# The opening pair: a soft chord as the line rises.
for n, g in (("D5", 0.045), ("A5", 0.035), ("F#5", 0.03)):
    place(bell(NOTE[n], 2.2, 0.9), 0.05, g)
# The phone travels; the right one of the pair drops away.
for at in TRAVELS:
    place(sweep(0.8, 300, 1400, 1.6), at, 0.07, 0.2)
place(sweep(0.55, 2400, 300, 1.7, lambda x: np.minimum(1, x / 0.08) * (1 - x) ** 1.2), 3.05, 0.07, 0.4)
# Taps: a small click with a felt body.
for at in TAPS:
    click = band(noise(0.03), 1800, 7000) * env(0.03, 0.0005, 0.006)
    body = np.sin(2 * np.pi * 140 * t_(0.08)) * env(0.08, 0.001, 0.025)
    place(np.pad(click, (0, len(body) - len(click))) * 0.6 + body * 0.5, at, 0.22, 0.25)
# Keys: the lightest ticks.
for i, at in enumerate(KEYS):
    tick = band(noise(0.02), 3000, 9000) * env(0.02, 0.0003, 0.004)
    place(tick, at, 0.09, 0.15 + 0.05 * ((i % 3) - 1))
# OPay: "Transfer successful".
place(bell(NOTE["E6"], 0.8, 0.3), OPAY + 0.02, 0.06, -0.2)
place(bell(NOTE["B6"], 0.9, 0.35), OPAY + 0.12, 0.06, -0.2)
# Kova waits: a clock on the recording's own seconds, a little brighter each tick.
for j, at in enumerate(TICKS):
    tock = band(noise(0.04), 1500 + 250 * j, 6000) * env(0.04, 0.0005, 0.01)
    place(tock + 0.4 * np.sin(2 * np.pi * (900 + 60 * j) * t_(0.04)) * env(0.04, 0.0005, 0.012), at, 0.12, 0.1)
# Money lands: naira in, crypto in.
chime(LANDED, ["D5", "F#5", "A5", "D6"])
chime(CRYPTO, ["A5", "D6", "F#6"], 0.06, 4)
# Send: the dollars leave. Done: the chime.
place(sweep(0.7, 600, 3800, 1.7, lambda x: np.minimum(1, x / 0.15) * (1 - x) ** 1.5), SEND + 0.05, 0.1, 0.3)
chime(DONE, ["D5", "F#5", "A5", "D6"], 0.07, 7)
# The alert drops in: two glass notes; then the underline: a marker stroke.
place(bell(NOTE["B6"], 1.0, 0.35), ALERT + 0.1, 0.13, -0.3)
place(bell(NOTE["E6"], 1.2, 0.5), ALERT + 0.21, 0.15, -0.3)
place(sweep(0.45, 1800, 5200, 2.2, lambda x: np.minimum(1, x / 0.1) * (1 - x) ** 0.5), ALERT + 0.6, 0.05, -0.3)
# The phone leaves; the mark: a soft D major bell chord; the address: a small pop.
place(sweep(0.55, 2400, 300, 1.7, lambda x: np.minimum(1, x / 0.08) * (1 - x) ** 1.2), LEAVES, 0.09, 0.15)
for n, g in (("D5", 0.06), ("F#5", 0.045), ("A5", 0.045), ("D6", 0.03)):
    place(bell(NOTE[n], 2.6, 1.1), VO["end"] - 0.02, g)
end_words = {l["id"]: l["words"] for l in json.loads((P / "audio/vo.json").read_text())["lines"]}["end"]
url_at = VO["end"] + next(w["start"] for w in end_words if w["text"].startswith("mykova"))
place(bell(NOTE["A6"], 0.5, 0.12), url_at - 0.1, 0.04)

effects = np.stack([L, R], axis=1)


def read(path, offset=0.0):
    """Decodes `path` to stereo 48 kHz floats, from `offset` seconds in."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(offset), "-i", str(path), "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


voice = np.zeros((N, 2))
for i, (key, at) in enumerate(VO.items()):
    v = read(P / f"audio/vo-{i + 1}.mp3")
    a = int(at * SR)
    voice[a : a + len(v)] += v[: N - a]

score = np.zeros((N, 2))
m = read(ROOT / "public/kovaphone/music-a.mp3", 0.4)[:N]
score[: len(m)] = m
fade = np.ones(N)
fade[-int(1.2 * SR) :] = np.linspace(1, 0, int(1.2 * SR)) ** 2
score *= fade[:, None]

# Duck the score under the voice: an envelope of the voice, quick down, slow up.
level = np.sqrt(np.convolve((voice**2).mean(axis=1), np.ones(int(0.03 * SR)) / int(0.03 * SR), "same"))
speaking = (level > 0.01).astype(float)
duck = np.zeros(N)
up, down = np.exp(-1 / (0.35 * SR)), np.exp(-1 / (0.04 * SR))
g = 0.0
for i in range(0, N, 48):
    target = speaking[i]
    k = down if target > g else up
    g = target + (g - target) * k**48
    duck[i : i + 48] = g
score *= (1 - 0.74 * duck)[:, None]

VOICE, SCORE, FX = 1.8, 0.75, 1.0


def write(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


write(P / "voice.wav", voice * VOICE)
write(P / "score.wav", score * SCORE)
write(P / "effects.wav", effects * FX)
raw = voice * VOICE + score * SCORE + effects * FX
write(P / ".raw.wav", raw * 0.5)

out = subprocess.run(["ffmpeg", "-nostats", "-i", str(P / ".raw.wav"), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
lufs = float([l for l in out.splitlines() if l.strip().startswith("I:")][-1].split()[1])
subprocess.run(
    ["ffmpeg", "-v", "error", "-y", "-i", str(P / ".raw.wav"), "-af", f"volume={-14 - lufs:.2f}dB,alimiter=limit=0.84:level=false:attack=4:release=80", "-ar", str(SR), "-c:a", "pcm_s16le", str(P / "mix.wav")],
    check=True,
)
(P / ".raw.wav").unlink()
print(f"mix.wav: raw {lufs} LUFS → -14; taps {[round(x, 2) for x in TAPS]}; ticks {[round(x, 2) for x in TICKS]}; done {DONE:.2f}")
