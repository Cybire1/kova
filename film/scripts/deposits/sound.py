"""
The sound of "Deposits" (src/deposits): the voice, the score, and the film's own effects, synthesised
here and placed on the frames of what they belong to. One master: a fixed gain to -14 LUFS and a
limiter for peaks only (loudnorm would compress the voice into the music).

  score    kovaphone/music-b (ElevenLabs), ducked about 12 dB under the voice, out over the last 1.6 s
  voice    public/deposits/audio (Sarah), at the starts in Film.tsx's VO
  effects  a soft chord for the opening, air as the phone leaves and returns, a rising glass note for
           each network said aloud, a fast rattle as the other 48 light, a chord when the counter
           reaches 53, taps where the recording was touched, a chime for "Sent $5.00" and another as
           it lands, a pop for the on-chain times, a bell chord under the mark.

Film.tsx's SEGS (which film seconds play which seconds of which recording) are repeated here.
Writes public/deposits/mix.wav (and voice.wav, score.wav, effects.wav to check levels).
Run: python3 scripts/deposits/sound.py
"""

import json
import subprocess
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parents[2]
P = ROOT / "public/deposits"
SR = 48_000
DUR = 28.0
N = int(SR * DUR)
rng = np.random.default_rng(2811)

# Film.tsx's clock.
VO = {"hook": 0.3, "list": 4.3, "send": 11.7, "this": 14.0, "lands": 19.3, "end": 23.6}
DEP = "dep"
SEGS = [(11.0, 12.6, DEP, 4.3, 6.0), (12.6, 14.2, DEP, 28.9, 31.3), (14.2, 16.0, DEP, 39.95, 40.9), (16.0, 17.6, DEP, 42.0, 44.7)]


def film(src, at):
    for a, b, s, f, t in SEGS:
        if s == src and t > f and f <= at <= t:
            return a + (at - f) / (t - f) * (b - a)
    raise ValueError((src, at))


words = {l["id"]: l["words"] for l in json.loads((P / "audio/vo.json").read_text())["lines"]}
start = lambda line, text: VO[line] + next(w["start"] for w in words[line] if w["text"].startswith(text))
SAID = [start("list", n) for n in ("Base", "Solana", "Arbitrum", "Tron", "Bitcoin")]
CASCADE = start("list", "48")
NAMES = len(json.loads((P / "networks.json").read_text())["networks"])
TAPS = [film(DEP, 4.88), film(DEP, 29.75)]
SENT = film(DEP, 44.0)
PROOF = start("lands", "about")
URL = start("end", "mykova")

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


def tap(at, gain=0.22):
    click = band(noise(0.03), 1800, 7000) * env(0.03, 0.0005, 0.006)
    body = np.sin(2 * np.pi * 140 * t_(0.08)) * env(0.08, 0.001, 0.025)
    place(np.pad(click, (0, len(body) - len(click))) * 0.6 + body * 0.5, at, gain, 0.25)


# The opening: a soft chord under the line.
for n, g in (("D5", 0.045), ("A5", 0.035), ("F#5", 0.03)):
    place(bell(NOTE[n], 2.2, 0.9), 0.05, g)
# The phone drops away; the names arrive.
place(sweep(0.55, 2400, 300, 1.7, lambda x: np.minimum(1, x / 0.08) * (1 - x) ** 1.2), 3.6, 0.08, 0.2)
# Each network said aloud: a glass note, a step up the pentatonic.
for at, n in zip(SAID, ["D5", "E5", "F#5", "A5", "B5"]):
    place(bell(NOTE[n], 0.9, 0.3), at + 0.02, 0.07, -0.25)
# "And 48 more": a fast rattle as each lights, then the chord as the counter reaches 53.
others = NAMES - len(SAID)
for k in range(others):
    at = CASCADE + k / (others - 1) * 1.2
    tick = band(noise(0.018), 2600 + 40 * k, 9000) * env(0.018, 0.0003, 0.004)
    place(tick, at, 0.08, rng.uniform(-0.3, 0.3))
chime(CASCADE + 1.25, ["D5", "F#5", "A5", "D6"], 0.07, 4)
# The phone comes back; taps on the recording.
place(sweep(0.8, 300, 1400, 1.6), 11.0, 0.07, 0.25)
for at in TAPS:
    tap(at)
# "Sent $5.00", then the receipt: it lands.
place(bell(NOTE["A5"], 0.8, 0.25), SENT, 0.08, 0.3)
place(bell(NOTE["D6"], 1.0, 0.35), SENT + 0.09, 0.09, 0.3)
place(sweep(0.8, 300, 1200, 1.6), 18.5, 0.05, 0.0)
chime(start("lands", "lands"), ["D5", "F#5", "A5", "D6"], 0.065, 5)
# The on-chain times: a small pop.
place(bell(NOTE["A6"], 0.5, 0.12), PROOF, 0.045, 0.35)
# The phone leaves; the mark: a soft D major bell chord; the address: a small pop.
place(sweep(0.55, 2400, 300, 1.7, lambda x: np.minimum(1, x / 0.08) * (1 - x) ** 1.2), 23.2, 0.09, 0.15)
for n, g in (("D5", 0.06), ("F#5", 0.045), ("A5", 0.045), ("D6", 0.03)):
    place(bell(NOTE[n], 2.6, 1.1), VO["end"] - 0.02, g)
place(bell(NOTE["A6"], 0.5, 0.12), URL - 0.1, 0.04)

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
m = read(ROOT / "public/kovaphone/music-b.mp3", 0.0)[:N]
score[: len(m)] = m
fade = np.ones(N)
fade[-int(1.6 * SR) :] = np.linspace(1, 0, int(1.6 * SR)) ** 2
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
print(f"mix.wav: raw {lufs} LUFS → -14; taps {[round(x, 2) for x in TAPS]}; said {[round(x, 2) for x in SAID]}; sent {SENT:.2f}")
