"""
The sound of "Credit alert" (src/credit-alert): the voice, the score, and the film's own effects,
synthesised here and placed on the frames of what they belong to. One master: a fixed gain to
-14 LUFS and a limiter for peaks only (loudnorm would compress the voice into the music).

  score    kovaphone/music-a (ElevenLabs, 103.4 BPM), 0.4 s in, so its last fall lands after the
           address; ducked about 12 dB under the voice
  voice    public/credit-alert/audio (Sarah), at the starts in Film.tsx's VO
  effects  a two-note alert for the bank's banner, a marker stroke for the underline, a reverse
           swell back in time, soft taps and key ticks from the recording's own log, a lift when
           the bank names the account, air as the dollars leave, a D major chime for "Done", a bell
           chord under the mark. Tuned to the score's D major pentatonic.

Writes public/credit-alert/mix.wav (and voice.wav, score.wav, effects.wav to check levels).
Run: python3 scripts/credit-alert/sound.py
"""

import json
import subprocess
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parents[2]
P = ROOT / "public/credit-alert"
SR = 48_000
DUR = 36.5
N = int(SR * DUR)
rng = np.random.default_rng(2710)

# Film.tsx's clock.
VO = {"alert": 0.3, "before": 2.6, "amount": 7.42, "bank": 10.4, "send": 16.35, "moves": 20.3, "done": 26.9, "end": 29.7}
take = json.loads((P / "take-a.json").read_text())
A0 = 6.7 - take["taps"][0]["t"]
HOLD_AT, HOLD_UNTIL, B0, END = 12.3, 19.4, 19.95, 29.4
TAPS = [HOLD_UNTIL + (p["t"] - HOLD_AT) if p["label"] == "send" else A0 + p["t"] for p in take["taps"]]
KEYS = [A0 + k["t"] + i * k["delay"] for k in take["typed"] for i in range(len(k["text"]))]
NAMED = A0 + 9.0  # the bank names the account (take A, 9.0 s)
DONE = B0 + 6.533  # take B shows "Done"

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


# The bank's alert: two glass notes, as a phone would ring for it (not OPay's own tone).
place(bell(NOTE["B6"], 1.0, 0.35), 0.0, 0.16)
place(bell(NOTE["E6"], 1.2, 0.5), 0.11, 0.18)
# The underline: a marker stroke, brightening.
place(sweep(0.45, 1800, 5200, 2.2, lambda x: np.minimum(1, x / 0.1) * (1 - x) ** 0.5), 0.95, 0.05, 0.1)
# Back eleven seconds: a reversed swell, then the phone's air as it rises.
place(sweep(0.6, 5000, 500, 1.8, lambda x: x**2.2 * (1 - np.maximum(0, x - 0.9) / 0.1)), 1.6, 0.14)
place(sweep(0.9, 300, 1400, 1.6), 2.15, 0.07, 0.2)
# Taps: a small click with a felt body.
for at in TAPS:
    click = band(noise(0.03), 1800, 7000) * env(0.03, 0.0005, 0.006)
    body = np.sin(2 * np.pi * 140 * t_(0.08)) * env(0.08, 0.001, 0.025)
    place(np.pad(click, (0, len(body) - len(click))) * 0.6 + body * 0.5, at, 0.22, 0.25)
# Keys: the lightest ticks.
for i, at in enumerate(KEYS):
    tick = band(noise(0.02), 3000, 9000) * env(0.02, 0.0003, 0.004)
    place(tick, at, 0.09, 0.15 + 0.05 * ((i % 3) - 1))
# The bank names the account: two notes up.
place(bell(NOTE["A5"], 0.6, 0.18), NAMED, 0.07, 0.2)
place(bell(NOTE["D6"], 0.8, 0.25), NAMED + 0.09, 0.08, 0.2)
# Send: the dollars leave.
place(sweep(0.7, 600, 3800, 1.7, lambda x: np.minimum(1, x / 0.15) * (1 - x) ** 1.5), TAPS[-1] + 0.05, 0.1, 0.3)
# Done: a D major chime up the pentatonic, and the confetti's glints.
for j, n in enumerate(["D5", "F#5", "A5", "D6"]):
    place(bell(NOTE[n], 1.6, 0.6), DONE + j * 0.075, 0.075 + 0.01 * j, 0.15 * (j - 1.5))
for j in range(7):
    f = NOTE[["A6", "B6", "D6", "E6", "F#6", "A6", "B6"][j]]
    place(bell(f, 0.4, 0.09, ((1, 1), (3.1, 0.2))), DONE + 0.2 + j * 0.11 + 0.03 * rng.random(), 0.025, rng.uniform(-0.6, 0.6))
# The push into "Done in 11 seconds", and the phone leaving.
place(sweep(1.2, 250, 900, 1.5), 26.95, 0.04, 0.1)
place(sweep(0.55, 2400, 300, 1.7, lambda x: np.minimum(1, x / 0.08) * (1 - x) ** 1.2), END, 0.09, 0.15)
# The mark: a soft D major bell chord. The address: a small pop.
for n, g in (("D5", 0.06), ("F#5", 0.045), ("A5", 0.045), ("D6", 0.03)):
    place(bell(NOTE[n], 2.6, 1.1), VO["end"] - 0.02, g)
url_at = VO["end"] + 3.84
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
print(f"mix.wav: raw {lufs} LUFS → -14; taps {[round(x, 2) for x in TAPS]}; done {DONE:.2f}")
