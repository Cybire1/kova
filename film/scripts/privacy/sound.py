"""
The sound of the private payments explainer (src/privacy): voice, a quiet synthesised score, and
the record's own ticks, placed from src/privacy/cues.json. Nothing licensed (numpy/scipy, the
instruments of scripts/xstocks5).

  score   A minor at 120 bpm, kept low under an explaining voice: a pad and a soft pluck from the
          start, a light pulse once the record rises (7.2), a lift on the brand-new address, a held
          breath while Sam's phone opens his note, the groove back for the spend, a resolve at the end.
  effects a tick under every character the record prints, a whoosh into every beat, a thump when
          the sealed note lands in the record, a chime when Sam's key opens it, a blip on "0 results".
  voice   public/privacy/audio (Sarah).

Writes public/privacy/mix.wav (and voice.wav, score.wav, effects.wav).
Run: python3 scripts/privacy/sound.py
"""

import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from synth import SR, add, band, bell, blip, boing, glint, high, low, mtof, noise, pad, tap, thump, ts, whoosh  # noqa: E402

P = ROOT / "public/privacy"
A = P / "audio"
C = json.loads((ROOT / "src/privacy/cues.json").read_text())
DUR = C["duration"]
N = int(SR * DUR)
FPS = C["fps"]
F = 1 / FPS
CUT = C["cuts"]
S = C["strip"]
T = C["moments"]
BEAT = 60 / C["bpm"]
VO = json.loads((A / "vo.json").read_text())["lines"]

# ── instruments ───────────────────────────────────────────────────────────────────────────────


def kick(vel=1.0):
    t = ts(0.45)
    f = 52 + 110 * np.exp(-t / 0.035)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    s += band(noise(0.45, 3), 2000, 6000) * np.exp(-t / 0.003) * 0.35
    return np.tanh(s * 1.6) * vel * 0.55


def clap(seed, vel=1.0):
    t = ts(0.3)
    env = sum(np.exp(-np.clip(t - d, 0, None) / 0.008) * (t >= d) for d in (0, 0.011, 0.022))
    env = env / 3 + np.exp(-np.clip(t - 0.03, 0, None) / 0.09) * (t >= 0.03) * 0.6
    return band(noise(0.3, seed), 900, 5200) * env * vel * 0.32


def hat(seed, vel=1.0, open_=False):
    d = 0.18 if open_ else 0.04
    t = ts(d + 0.02)
    return high(noise(d + 0.02, seed), 7500) * np.exp(-t / (d / 3)) * vel * 0.12


def saw_stab(notes, seconds=0.32, vel=1.0, cutoff=2600):
    t = ts(seconds)
    s = np.zeros_like(t)
    for m in notes:
        for det in (-0.006, 0.0, 0.006):
            ph = (mtof(m) * (1 + det) * t) % 1
            s += 2 * ph - 1
    s = low(s / (3 * len(notes)), cutoff)
    return s * np.minimum(1, t / 0.003) * np.exp(-t / (seconds / 3)) * vel * 0.5


def pluck_bass(m, vel=1.0, seconds=0.24):
    t = ts(seconds)
    ph = (mtof(m) * t) % 1
    s = (2 * ph - 1) * 0.6 + np.sin(2 * np.pi * mtof(m) * t)
    env = np.exp(-t / 0.05)  # the filter closes: a bright attack crossfading to a dark body
    s = low(s, 1800) * env + low(s, 420) * (1 - env)
    return np.tanh(1.4 * s) * np.minimum(1, t / 0.003) * np.exp(-t / 0.12) * vel * 0.32


def sub_boom(vel=1.0):
    t = ts(1.6)
    f = 38 + 50 * np.exp(-t / 0.12)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.55)
    return np.tanh(s * 2.0) * vel * 0.55


def impact(vel=1.0, seconds=1.4, seed=5):
    t = ts(seconds)
    body = low(noise(seconds, seed), 1800) * np.exp(-t / 0.06)
    tail = low(noise(seconds, seed + 1), 600) * np.exp(-t / 0.45) * 0.4
    k = np.zeros_like(t)
    kk = kick(1.0)[: len(t)]
    k[: len(kk)] = kk
    return (body + tail + k) * vel * 0.5


def riser(seconds, seed=9, vel=1.0):
    t = ts(seconds)
    p = t / seconds
    out = np.zeros_like(t)
    hop = int(0.02 * SR)
    src = noise(seconds, seed)
    for i in range(0, len(t) - hop, hop):
        c = 400 * (9000 / 400) ** p[i]
        out[i : i + hop] = band(src[i : i + hop * 2], c / 1.5, min(c * 1.5, SR / 2 - 200))[:hop]
    tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (2 * p)) / SR) * 0.25
    return (out + tone) * p**2.2 * vel * 0.35


def tick(seed, vel=1.0):
    """One flap of the board: a dry plastic click."""
    t = ts(0.03)
    s = band(noise(0.03, 100 + seed), 2200, 7500) * np.exp(-t / 0.0025)
    s += np.sin(2 * np.pi * (1500 + (seed * 137) % 700) * t) * np.exp(-t / 0.004) * 0.5
    return s * vel * 0.22


def rattle(bus, start, count, seed, vel=1.0, step=F, pan=0.0):
    for i in range(count):
        add(bus, tick(seed + i, vel * (1.0 if i == 0 else 0.8)), start + i * step, pan=pan + 0.04 * (i % 3 - 1))


def reverb(x, seconds=1.6, seed=21, mix=0.25):
    t = ts(seconds)
    ir = noise(seconds, seed) * np.exp(-t / (seconds / 5))
    ir = low(ir, 5000)
    ir /= np.sqrt((ir**2).sum())
    out = np.stack([fftconvolve(x[0], ir)[: x.shape[1]], fftconvolve(x[1], np.roll(ir, 97))[: x.shape[1]]])
    return x + out * mix * 6


# ── score ───────────────────────────────────────────────────────────────────────────────────

drums = np.zeros((2, N))
tonal = np.zeros((2, N))
fxwet = np.zeros((2, N))

CHORD = {"Am": (45, [57, 60, 64, 69]), "F": (41, [57, 60, 65, 69]), "G": (43, [55, 59, 62, 67]), "C": (48, [55, 60, 64, 67]), "Em": (40, [55, 59, 64, 67])}
PLAN = [(CUT["send"], "Am"), (CUT["address"], "F"), (CUT["note"], "C"), (CUT["find"], "G"), (CUT["spend"], "Em"), (CUT["end"], "F"), (99, "C")]


def chord_at(t):
    for edge, name in PLAN:
        if t < edge:
            return name
    return "C"


# A pad that changes chord with each beat of the story.
edges = [0.0] + [e for e, _ in PLAN[:-1]] + [DUR]
for i in range(len(edges) - 1):
    a, b = edges[i], edges[i + 1]
    _, notes = CHORD[chord_at(a + 0.01)]
    add(tonal, pad([n - 12 for n in notes], b - a + 0.6, vel=0.55), a)

beats = np.arange(0, DUR - 0.01, BEAT)
for t0 in beats:
    b = int(round(t0 / BEAT))
    root, notes = CHORD[chord_at(t0)]
    bar_beat = b % 4
    # A soft pluck arpeggio throughout, quieter while Sam opens his note.
    hush = 0.5 if CUT["find"] <= t0 < CUT["spend"] else 1.0
    add(tonal, pluck_bass(notes[b % 4] + 12, 0.32 * hush, 0.3), t0, pan=0.25 * ((b % 3) - 1))
    if t0 < S["rise"] or t0 >= CUT["end"] + 2.5:
        continue
    if CUT["find"] <= t0 < CUT["spend"]:
        continue  # the held breath
    if bar_beat in (0, 2):
        add(drums, kick(0.6), t0)
    add(drums, hat(b, 0.45), t0 + BEAT / 2, pan=0.3)
    if bar_beat == 0:
        add(tonal, pluck_bass(root, 0.6, 0.35), t0)

# Lifts and the resolve.
add(fxwet, riser(1.2, vel=0.5), CUT["address"] - 1.2)
add(fxwet, riser(1.0, seed=12, vel=0.4), CUT["spend"] - 1.0)
add(drums, impact(0.5), CUT["address"])
add(drums, impact(0.45, seed=6), CUT["spend"])
add(drums, impact(0.4, seed=8), CUT["end"])
for i, m in enumerate([72, 76, 79, 84]):
    add(fxwet, bell(mtof(m), 2.6, 0.45), CUT["end"] + i * 0.035, pan=-0.2 + 0.13 * i)

music = drums + reverb(fxwet, mix=0.3) + reverb(tonal, mix=0.12)
fade = np.ones(N)
fade[-int(1.2 * SR) :] = np.linspace(1, 0, int(1.2 * SR)) ** 2
music *= fade

# ── effects ───────────────────────────────────────────────────────────────────────────────

fx = np.zeros((2, N))
room = low(noise(DUR, 77), 400) * 0.006
fx[0] += room
fx[1] += np.roll(room, 2400)

for i, k in enumerate(["send", "address", "note", "find", "spend", "end"]):
    add(fx, whoosh(0.45, 500, 3800, 40 + i, peak=0.85, vel=0.45), CUT[k] - 0.38, pan=(-0.2, 0.2)[i % 2])

# The hook's row prints, character by character (every other one), then the names land.
row = 33
for c in range(0, row, 2):
    add(fx, tick(c, 0.6), 0.5 + c * 0.7 * F + 2 * F, pan=-0.3 + 0.02 * c)
add(fx, thump(0.4), T["names"])
add(fx, thump(0.35), T["names"] + 4 * F)

# The hook's crowd: each pair of eyes pops in on its eighth, one blink each, a squint, then they pop away.
H = C["hook"]
E0, ESTEP = H["eyes"]
for i in range(10):
    t0 = E0 + i * ESTEP
    if t0 >= 0:
        add(fx, blip(72 + (i * 3) % 12, 0.55), t0, pan=-0.4 + 0.09 * i)
        add(fx, tap(), t0 + 0.01, pan=-0.4 + 0.09 * i, gain=0.35)
    add(fx, tick(400 + i, 0.4), E0 + i * ESTEP + 1.1 + ((i * 37) % 9) * 0.13, pan=-0.3 + 0.07 * i)
    add(fx, blip(64 - i, 0.35), H["squint"] + 0.25 + i * 0.05, pan=0.4 - 0.09 * i)
# Kovi drops in with his key, lands on the box, pulls the shutter down, cheers.
ka, kb = H["kovi"]
add(fx, whoosh(kb - ka + 0.05, 3000, 600, 90, peak=0.9, vel=0.4), ka, pan=0.35)
add(fx, boing(), kb, pan=0.35, gain=0.8)
sa, sb = H["shutter"]
add(fx, whoosh(sb - sa + 0.15, 1200, 300, 91, peak=0.85, vel=0.55), sa - 0.05, pan=0.1)
add(fx, thump(0.75), sb)
for i, m in enumerate([79, 84, 88]):
    add(fx, bell(mtof(m), 1.2, 0.35), H["cheer"] + i * 0.05, pan=0.35)

# The record rises; each entry prints with a short rattle.
add(fx, whoosh(0.4, 300, 1200, 60, peak=0.7, vel=0.35), S["rise"], pan=0.0)
for key in ("entry1", "entry2", "entry3"):
    rattle(fx, S[key] + 2 * F, 6, 80 + int(S[key]), vel=0.55, step=0.025, pan=-0.2)
# The lifted pieces of screen.
for key in ("lift1", "lift2"):
    add(fx, whoosh(0.3, 400, 1600, 70 + int(T[key]), peak=0.6, vel=0.3), T[key] - 0.1, pan=0.3)
    add(fx, tap(), T[key] + 6 * F, pan=0.3, gain=0.6)
# The brand-new address prints; the lock closes.
for c in range(0, 12, 2):
    add(fx, tick(200 + c, 0.7), T["address"] + c * 1.2 * F + 2 * F, pan=0.05 * c)
add(fx, thump(0.5), T["lock"])
add(fx, blip(76, 0.6), T["lock"] + 0.02)
# The sealed note: it lands on the table, flies down into the record.
add(fx, thump(0.5), C["vo"]["note"] + 0.5)
ea, eb = S["envelope"]
add(fx, whoosh(eb - ea + 0.1, 1800, 400, 61, peak=0.8, vel=0.45), ea, pan=-0.1)
add(fx, thump(0.55), eb)
add(fx, blip(70, 0.5), S["notWho"])
# Sam's phone, and his key opening the note.
add(fx, thump(0.4), T["arrival"])
for i, m in enumerate([84, 88, 91]):
    add(fx, bell(mtof(m), 1.2, 0.35), T["lift2"] + 0.05 + i * 0.05, pan=0.3)
add(fx, glint(90), T["lift2"] + 0.2, pan=0.35)
# Paid, and the search that finds nothing.
add(fx, blip(86, 0.8), T["paid"])
add(fx, bell(mtof(91), 0.8, 0.3), T["paid"] + 0.03)
rattle(fx, S["search"] + 2 * F, 8, 300, vel=0.5, step=0.02, pan=0.3)
add(fx, blip(64, 0.9), S["search"] + 0.35, pan=0.3)
add(fx, blip(64, 0.7), S["search"] + 0.5, pan=0.3)


# The rest of the film: Kovi's moves, the sparkles, the finale (the eyes are the opening's only).
lock, lift2 = T["lock"], T["lift2"]
add(fx, whoosh(0.4, 3000, 600, 92, peak=0.9, vel=0.35), lock - 0.4, pan=-0.3)
add(fx, boing(), lock, pan=-0.3, gain=0.7)
ea, eb = S["envelope"]
add(fx, whoosh(0.5, 3000, 600, 93, peak=0.9, vel=0.35), ea - 0.5, pan=0.3)
add(fx, boing(), ea, pan=0.3, gain=0.6)
for k in range(6):
    add(fx, glint(110 + k), lift2 + 0.1 + k * 0.05, pan=0.2 + 0.05 * k)
add(fx, boing(), lift2 + 0.1, pan=0.35, gain=0.6)
add(fx, boing(), lift2 + 0.6, pan=0.35, gain=0.45)
# The finale: Kovi drops in waving, the shutter comes down over everything, he cheers.
add(fx, whoosh(0.4, 3000, 600, 94, peak=0.9, vel=0.4), CUT["end"] + 0.05, pan=0.35)
add(fx, boing(), CUT["end"] + 0.4, pan=0.35, gain=0.7)
fin_a, fin_b = CUT["end"] + 0.55, CUT["end"] + 1.05
add(fx, whoosh(fin_b - fin_a + 0.2, 1400, 250, 95, peak=0.85, vel=0.7), fin_a - 0.05, pan=0.0)
add(fx, impact(0.5, seed=11), fin_b)
add(fx, thump(0.9), fin_b)
cheer = C["vo"]["end"] + 3.0
for j, m in enumerate([79, 84, 88, 91]):
    add(fx, bell(mtof(m), 1.4, 0.35), cheer + j * 0.05, pan=0.35)
add(fx, boing(), cheer, pan=0.35, gain=0.6)


# ── voice ─────────────────────────────────────────────────────────────────────────────────


def read(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)


voice = np.zeros((2, N))
for i, line in enumerate(VO):
    v = read(A / f"vo-{i + 1}.mp3")
    a = int(C["vo"][line["id"]] * SR)
    n = min(v.shape[1], N - a)
    voice[:, a : a + n] += v[:, :n]

level = np.sqrt(np.convolve((voice**2).mean(axis=0), np.ones(int(0.03 * SR)) / int(0.03 * SR), "same"))
speaking = (level > 0.004).astype(float)
duck = np.zeros(N)
g = 0.0
up, down = np.exp(-1 / (0.3 * SR)), np.exp(-1 / (0.03 * SR))
for i in range(0, N, 48):
    target = speaking[i]
    kk = down if target > g else up
    g = target + (g - target) * kk**48
    duck[i : i + 48] = g
music *= 1 - 0.55 * duck
fx *= 1 - 0.2 * duck

VOICE, SCORE, FX = 1.9, float(sys.argv[1]) if len(sys.argv) > 1 else 0.7, 1.0


def write(path, x):
    x = np.clip(x.T, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


write(P / "voice.wav", voice * VOICE)
write(P / "score.wav", music * SCORE)
write(P / "effects.wav", fx * FX)
write(P / ".raw.wav", (voice * VOICE + music * SCORE + fx * FX) * 0.5)

out = subprocess.run(["ffmpeg", "-nostats", "-i", str(P / ".raw.wav"), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
lufs = float([l for l in out.splitlines() if l.strip().startswith("I:")][-1].split()[1])
subprocess.run(
    ["ffmpeg", "-v", "error", "-y", "-i", str(P / ".raw.wav"), "-af", f"volume={-14 - lufs:.2f}dB,alimiter=limit=0.8:level=false:attack=3:release=60", "-ar", str(SR), "-c:a", "pcm_s16le", str(P / "mix.wav")],
    check=True,
)
(P / ".raw.wav").unlink()
print(f"mix.wav: raw {lufs} LUFS -> -14 (score x{SCORE})")
