"""
The sound of "This link is a restaurant." (src/oyin): voice, a synthesised score with a real beat, and
the board's own effects, all placed from src/oyin/cues.json. Nothing licensed: every sound is
numpy/scipy (scripts/synth.py plus the drums, riser, impact and board ticks of scripts/xstocks5).

  score   A minor at 120 bpm (a beat is 0.5 s; bars start at 2.5 + 2k).
          0-2.5    the hook: an impact on frame 0, kick and off-beat hats, a plucked bass; the link
                   ticks in; a riser and a snare roll into the tap (2.0) and the drop
          2.5      THE DROP: sub boom, impact. Four on the floor through the menu; a stab and a slam on
                   every dish; the board's hit at 5.5; the phone rises and the menu flies into it
          6.5-10.5 the order: a lighter groove under the voice; a tap under every tap
          10.5-13  the payment: the drums thin to hats and a pulse, a riser into Face ID's check
          13.0     PAID (the one big release): impact, a C major stab, a bell chord, glints
          14.5     the proof: the groove back, each figure rattles in
          19.5     the end: a soft low hit, a pad, bells, out over the last second
  voice   public/oyin/audio (Sarah, ElevenLabs), each line where cues.vo puts it.

Writes public/oyin/mix.wav (and voice.wav, score.wav, effects.wav to check levels).
Run: python3 scripts/oyin/sound.py
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
from synth import SR, add, band, bell, blip, glint, high, low, mtof, noise, pad, tap, thump, ts, whoosh  # noqa: E402

P = ROOT / "public/oyin"
A = P / "audio"
C = json.loads((ROOT / "src/oyin/cues.json").read_text())
DUR = C["duration"]
N = int(SR * DUR)
FPS = C["fps"]
F = 1 / FPS
HIT = C["hits"]
TAPS = C["taps"]
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

CHORD = {"Am": (45, [57, 60, 64, 69]), "F": (41, [57, 60, 65, 69]), "G": (43, [55, 59, 62, 67]), "C": (48, [55, 60, 64, 67])}
PLAN = [(2.5, "Am"), (4.5, "Am"), (6.5, "F"), (8.5, "C"), (10.5, "G"), (13.0, "F"), (14.5, "C"), (16.5, "Am"), (18.5, "F"), (19.5, "G"), (99, "C")]


def chord_at(t):
    for edge, name in PLAN:
        if t < edge:
            return name
    return "C"


DROP, BOARD, ORDER, PAY, PAID, PROOF, END = (HIT[k] for k in ("drop", "board", "order", "pay", "paid", "proof", "end"))
beats = np.arange(0, DUR - 0.01, BEAT)
for t0 in beats:
    b = int(round(t0 / BEAT))
    bar_beat = int(round((t0 - DROP) / BEAT)) % 4
    root, _ = CHORD[chord_at(t0)]
    if t0 < DROP - 1.0:  # hook
        if bar_beat in (0, 2):
            add(drums, kick(0.85), t0)
        add(drums, hat(b, 0.8), t0 + BEAT / 2, pan=0.3)
        for e in range(2):
            add(tonal, pluck_bass(root + (12 if e else 0), 0.7), t0 + e * BEAT / 2)
    elif t0 < DROP:  # into the drop: bass only under the roll
        for e in range(2):
            add(tonal, pluck_bass(root, 0.6), t0 + e * BEAT / 2)
    elif t0 < ORDER:  # the drop: four on the floor
        add(drums, kick(1.05), t0)
        if bar_beat in (1, 3):
            add(drums, clap(b, 0.95), t0, pan=-0.1)
        for e in range(4):
            add(drums, hat(b * 4 + e, 0.55 + 0.45 * (e == 2), open_=(e == 2)), t0 + e * BEAT / 4, pan=0.3)
        for e in range(4):
            add(tonal, pluck_bass(root + (12 if e % 2 else 0), 1.0, 0.2), t0 + e * BEAT / 4)
    elif t0 < PAY:  # the order: lighter, under the voice
        if bar_beat in (0, 2):
            add(drums, kick(0.85), t0)
        if bar_beat in (1, 3):
            add(drums, clap(b, 0.6), t0, pan=-0.1)
        for e in range(2):
            add(drums, hat(b * 2 + e, 0.5 + 0.3 * e), t0 + e * BEAT / 2, pan=0.3)
        for e in range(2):
            add(tonal, pluck_bass(root + (12 if e else 0), 0.8), t0 + e * BEAT / 2)
    elif t0 < PAID:  # the payment: hats and a pulse, waiting
        for e in range(4):
            add(drums, hat(b * 4 + e, 0.35 + 0.25 * (e == 2)), t0 + e * BEAT / 4, pan=0.3)
        add(tonal, pluck_bass(root, 0.55, 0.3), t0)
    elif t0 < PROOF:  # after Paid!: four on the floor in C
        add(drums, kick(0.95), t0)
        if bar_beat in (1, 3):
            add(drums, clap(b, 0.8), t0, pan=-0.1)
        for e in range(4):
            add(drums, hat(b * 4 + e, 0.5 + 0.4 * (e == 2)), t0 + e * BEAT / 4, pan=0.3)
        for e in range(2):
            add(tonal, pluck_bass(root + (12 if e else 0), 0.9), t0 + e * BEAT / 2)
    elif t0 < END:  # the proof: the groove, quieter, under the voice
        if bar_beat in (0, 2):
            add(drums, kick(0.85), t0)
        if bar_beat in (1, 3):
            add(drums, clap(b, 0.55), t0, pan=-0.1)
        for e in range(2):
            add(drums, hat(b * 2 + e, 0.45 + 0.3 * e), t0 + e * BEAT / 2, pan=0.3)
        for e in range(2):
            add(tonal, pluck_bass(root + (12 if e else 0), 0.75), t0 + e * BEAT / 2)

# The roll into the drop: 8ths, 16ths, 32nds; the last 8th is air (the tap sits in it).
roll = np.concatenate([np.arange(DROP - 1.0, DROP - 0.5, BEAT / 2), np.arange(DROP - 0.5, DROP - 0.25, BEAT / 4), np.arange(DROP - 0.25, DROP - 0.125, BEAT / 8)])
for i, t0 in enumerate(roll):
    add(drums, clap(200 + i, 0.3 + 0.5 * (t0 - roll[0]) / 0.9), t0, pan=-0.05)
add(fxwet, riser(1.375), DROP - 1.5)
add(fxwet, riser(1.6, seed=12, vel=0.8), PAID - 1.65)


def stab(t0, name, vel=1.0):
    root, notes = CHORD[name]
    add(fxwet, saw_stab([n + 12 for n in notes], 0.4, vel), t0)
    add(tonal, pluck_bass(root, vel), t0)


stab(0.0, "Am", 0.85)
add(drums, impact(0.8), 0.0)
for d in C["dishes"]:
    stab(d["at"], chord_at(d["at"]), 1.0)
stab(BOARD, "C", 1.1)
add(drums, sub_boom(1.0), DROP)
add(drums, impact(1.0, seed=6), DROP)
add(drums, impact(0.55, seed=7), BOARD)
add(drums, kick(1.0), ORDER)

# PAID: the release.
add(drums, impact(0.9, seed=9), PAID)
add(drums, sub_boom(0.7), PAID)
stab(PAID, "C", 1.15)
for i, m in enumerate([72, 76, 79, 84]):
    add(fxwet, bell(mtof(m), 2.0, 0.45), PAID + i * 0.035, pan=-0.2 + 0.13 * i)

# The end: the resolve.
add(drums, impact(0.45, seed=8), END)
add(tonal, pad([48, 55, 60, 64, 67, 74], DUR - END + 0.4, vel=0.75), END - 0.05)
for i, m in enumerate([72, 76, 79, 84]):
    add(fxwet, bell(mtof(m), 2.6, 0.5), END + i * 0.035, pan=-0.2 + 0.13 * i)
for i, m in enumerate([79, 84, 88]):
    add(fxwet, bell(mtof(m), 1.4, 0.28), END + 2.5 + i * BEAT / 2, pan=0.25)
for t0 in np.arange(END + BEAT, DUR - 0.75, BEAT):
    add(drums, hat(int(t0 * 10), 0.35), t0 + BEAT / 2, pan=0.3)

music = drums + reverb(fxwet, mix=0.3) + reverb(tonal, mix=0.08)

pump = np.ones(N)
for t0 in beats:
    if DROP <= t0 < ORDER or PAID <= t0 < PROOF:
        i = int(t0 * SR)
        n = int(0.22 * SR)
        pump[i : i + n] = np.minimum(pump[i : i + n], 0.55 + 0.45 * (np.arange(n) / n) ** 0.7)
music = drums + (music - drums) * pump

fade = np.ones(N)
fade[-int(1.0 * SR) :] = np.linspace(1, 0, int(1.0 * SR)) ** 2
music *= fade

# ── effects ───────────────────────────────────────────────────────────────────────────────

fx = np.zeros((2, N))
room = low(noise(DUR, 77), 400) * 0.006
fx[0] += room
fx[1] += np.roll(room, 2400)

# A whoosh into every shot change, peaking on the hit.
changes = [DROP] + [d["at"] for d in C["dishes"][1:]] + [BOARD, ORDER, PAY, PROOF, END]
for i, h in enumerate(changes):
    length = 0.3 if DROP < h < BOARD + 0.1 else 0.45
    add(fx, whoosh(length, 500, 4200, 40 + i, peak=0.85, vel=0.5), h - length * 0.85, pan=(-0.2, 0.2)[i % 2])

# Hook: the pill slams, the link ticks in (every other character), the tap.
add(fx, thump(0.6), 0.0)
LINK = 25
for c in range(0, LINK, 2):
    add(fx, tick(c, 0.75), 3 * F + c * 0.6 * F + 2 * F, pan=-0.3 + 0.025 * c)
add(fx, tap(), HIT["tap"], gain=1.3)
add(fx, blip(84, 0.9), HIT["tap"] + 0.01)

# The menu: each photo slams; its name ticks; its price rattles in.
for d in C["dishes"]:
    a = d["at"]
    add(fx, thump(0.6), a)
    rattle(fx, a + 1 * F + 2 * F, 1, 60, vel=0.7)
    rattle(fx, a + 4 * F + 2 * F, len(d["price"]), 70, vel=0.9, pan=0.15)
# The board: six tiles, two frames apart; the phone rises; the menu flies into it and lands.
for i in range(6):
    add(fx, thump(0.35), BOARD + i * 2 * F)
    rattle(fx, BOARD + (i * 2 + 3) * F + 2 * F, 5, 90 + i * 5, vel=0.35, pan=-0.3 + 0.12 * i)
ra, rb = C["phone"]["rise"]
fa, fb = C["phone"]["fly"]
add(fx, whoosh(rb - ra + 0.1, 250, 1400, 65, peak=0.75, vel=0.55), ra, pan=-0.35)
add(fx, whoosh(fb - fa + 0.1, 900, 3000, 66, peak=0.8, vel=0.4), fa, pan=-0.2)
add(fx, thump(0.55), rb)
for k in range(3):
    add(fx, glint(80 + k), fb + 0.02 + k * 0.05, pan=-0.35)

# The order and the payment: a tap under every tap in the footage.
for name in ("jollof", "add", "bag", "pay"):
    add(fx, tap(), TAPS[name], pan=-0.4, gain=1.1)
    add(fx, blip(86 if name == "pay" else 81, 0.6), TAPS[name] + 0.01, pan=-0.4)
for k in range(4):  # Face ID scanning
    add(fx, glint(90 + k), TAPS["faceid"] + 0.15 + k * 0.18, pan=0.05 * k)
add(fx, blip(88, 0.9), TAPS["check"])
add(fx, bell(mtof(91), 0.9, 0.35), TAPS["check"] + 0.02)
for k in range(5):
    add(fx, glint(100 + k), PAID + 0.05 + k * 0.06, pan=-0.3 + 0.15 * k)


# Words and figures: a tick as each rolls in.
def line_words(lid):
    line = next(l for l in VO if l["id"] == lid)
    return [(w["text"], C["vo"][lid] + w["start"]) for w in line["words"]]


for lid, seed in (("order", 30), ("pay", 40), ("end", 50)):
    for j, (_, t0) in enumerate(line_words(lid)):
        add(fx, tick(seed + j, 0.45), t0, pan=0.2)
proof = dict((w.strip(".,"), t0) for w, t0 in line_words("proof"))
add(fx, whoosh(0.5, 300, 1500, 67, peak=0.3, vel=0.3), PROOF, pan=0.0)
for key, txt, pan in (("$6.50", "$6.50", -0.4), ("14", "14 s", 0.0), ("No", "$0.00", 0.4)):
    rattle(fx, proof[key] - 2 * F + 2 * F + 2 * F, len(txt), 120 + len(txt), vel=0.85, pan=pan)
add(fx, bell(mtof(88), 0.8, 0.35), proof["14"] + 6 * F, pan=0.0)
endw = line_words("end")
url = [t0 for w, t0 in endw if w.startswith("mykova")][0]
add(fx, blip(88, 0.8), url + 4 * F)
add(fx, thump(0.5), END)


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
depth = np.full(N, 0.6)
depth[int(END * SR) :] = 0.7
music *= 1 - depth * duck
fx *= 1 - 0.25 * duck

VOICE, SCORE, FX = 1.9, float(sys.argv[1]) if len(sys.argv) > 1 else 0.75, 1.0


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
