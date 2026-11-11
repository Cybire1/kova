"""
The sound of "xStocks. Live in Kova." v4 (src/xstocks4; v3 set smaller, the resolve at 13.9): voice, a synthesised score with a real beat,
and the board's own effects, all placed from src/xstocks4/cues.json. Nothing licensed: every sound is
numpy/scipy (scripts/synth.py plus the drums, riser, impact and board ticks below).

  score   A minor at 120 bpm (a beat is 0.5 s, 15 frames; a bar is 2 s, bars start at 7.5 - 2k).
          0-3.0    the hook: an impact on frame 0, the $5.00 lands on the first beat (0.5), kick,
                   off-beat hats, a plucked bass
          3.0-6.0  the build: claps on 2 and 4, 16th hats, the bass walks to F and G
          6.0-7.5  a riser and a snare roll (8ths, 16ths, 32nds), the last 8th is air
          7.5      THE DROP (the one big hit): sub boom, impact, stab. Four on the floor through the
                   montage; a stab on every stock; the board's hit at 12.25
          12.5-13  near-silence: only the stab's tail and the room
          13.0     the resolve and the end card: a soft low hit, a bell chord, a C major pad, out
                   over the last second
  effects a tick under every character or word the board rolls in, a whoosh into every cut, a slam
          under every object that lands, Kovi's fall, tap and hop, the plane, the token's chime.
  voice   public/xstocks2/audio (Sarah). The hook line plays at 1.15x (it has 3 s); the montage line
          is cut at its word gaps and each name placed on its beat; the end line loses 0.24 s of its
          pause.

Cuts sit 2 frames before their hits (cues.cuts); sounds land on the hits.
Writes public/xstocks4/mix.wav (and voice.wav, score.wav, effects.wav to check levels).
Run: python3 scripts/xstocks4/sound.py
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

P = ROOT / "public/xstocks4"  # the mix is written here; the voice is read from public/xstocks2/audio
A = ROOT / "public/xstocks2/audio"
C = json.loads((ROOT / "src/xstocks4/cues.json").read_text())
DUR = C["duration"]
N = int(SR * DUR)
FPS = C["fps"]
F = 1 / FPS
HIT = C["hits"]
CUT = {k: v / FPS for k, v in C["cuts"].items()}
W = C["words"]
VOL = {l["id"]: l for l in json.loads((A / "vo.json").read_text())["lines"]}
BEAT = 60 / C["bpm"]

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
fxwet = np.zeros((2, N))  # stabs and bells that get the room

CHORD = {"Am": (45, [57, 60, 64, 69]), "F": (41, [57, 60, 65, 69]), "G": (43, [55, 59, 62, 67]), "C": (48, [55, 60, 64, 67])}


def chord_at(t):  # one chord a bar; bars start at 7.5 - 2k
    if t < 3.5:
        return "Am"
    if t < 5.5:
        return "F"
    if t < 7.5:
        return "G"
    if t < 9.5:
        return "Am"
    if t < 11.5:
        return "F"
    return "G"


DROP, BOARD, END = HIT["drop"], HIT["board"], HIT["end"]
beats = np.arange(0, DUR, BEAT)
for t0 in beats:
    b = int(round(t0 / BEAT))
    bar_beat = int(round((t0 - C["downbeat"]) / BEAT)) % 4
    root, _ = CHORD[chord_at(t0)]
    if t0 < HIT["tap"]:  # hook
        if bar_beat in (0, 2) or t0 == HIT["five"]:
            add(drums, kick(0.9), t0)
        add(drums, hat(b, 0.9), t0 + BEAT / 2, pan=0.3)
        for e in range(2):
            add(tonal, pluck_bass(root + (12 if e else 0), 0.75), t0 + e * BEAT / 2)
    elif t0 < HIT["wallet"]:  # build
        if bar_beat in (0, 2):
            add(drums, kick(0.95), t0)
        if bar_beat in (1, 3):
            add(drums, clap(b, 0.8), t0, pan=-0.1)
        for e in range(4):
            add(drums, hat(b * 4 + e, 0.5 + 0.4 * (e == 2)), t0 + e * BEAT / 4, pan=0.3)
        for e in range(2):
            add(tonal, pluck_bass(root + (12 if e else 0), 0.85), t0 + e * BEAT / 2)
    elif t0 < DROP - BEAT / 2:  # riser and roll
        if bar_beat in (0, 2):
            add(drums, kick(0.8), t0)
        for e in range(2):
            add(tonal, pluck_bass(root, 0.7), t0 + e * BEAT / 2)
    elif DROP <= t0 < BOARD + BEAT / 2:  # the drop: four on the floor
        add(drums, kick(1.05), t0)
        if bar_beat in (1, 3):
            add(drums, clap(b, 0.95), t0, pan=-0.1)
        for e in range(4):
            add(drums, hat(b * 4 + e, 0.55 + 0.45 * (e == 2), open_=(e == 2)), t0 + e * BEAT / 4, pan=0.3)
        for e in range(4):
            add(tonal, pluck_bass(root + (12 if e % 2 else 0), 1.0, 0.2), t0 + e * BEAT / 4)

# The snare roll into the drop: 8ths, then 16ths, then 32nds, rising; the last 8th is air.
roll = np.concatenate([np.arange(DROP - 1.0, DROP - 0.5, BEAT / 2), np.arange(DROP - 0.5, DROP - 0.25, BEAT / 4), np.arange(DROP - 0.25, DROP - 0.125, BEAT / 8)])
for i, t0 in enumerate(roll):
    add(drums, clap(200 + i, 0.35 + 0.5 * (t0 - roll[0]) / 0.9), t0, pan=-0.05)
add(fxwet, riser(1.375), DROP - 1.5)


# The stabs: the hook's first frame, the $5.00 landing, every stock, the board.
def stab(t0, name, vel=1.0):
    root, notes = CHORD[name]
    add(fxwet, saw_stab([n + 12 for n in notes], 0.4, vel), t0)
    add(tonal, pluck_bass(root, vel), t0)


stab(0.0, "Am", 0.9)
stab(HIT["five"], "Am", 0.7)
for k in ("drop", "nvda", "spy", "qqq"):
    stab(HIT[k], chord_at(HIT[k]), 1.0)
stab(BOARD, "C", 1.15)
add(drums, impact(0.8), 0.0)
add(drums, sub_boom(1.0), DROP)
add(drums, impact(1.0, seed=6), DROP)
add(drums, impact(0.6, seed=7), BOARD)
add(drums, kick(1.0), BOARD)

# The end: the resolve. A soft low hit, a bell chord, a bright pad; hats keep it moving.
add(drums, impact(0.45, seed=8), END)
add(tonal, pad([48, 55, 60, 64, 67, 74], DUR - END + 0.4, vel=0.75), END - 0.05)
for i, m in enumerate([72, 76, 79, 84]):
    add(fxwet, bell(mtof(m), 2.6, 0.5), END + i * 0.035, pan=-0.2 + 0.13 * i)
for i, m in enumerate([79, 84, 88]):
    add(fxwet, bell(mtof(m), 1.4, 0.28), END + 1.0 + i * BEAT / 2, pan=0.25)
for t0 in np.arange(END + BEAT, DUR - 0.75, BEAT):
    add(drums, hat(int(t0 * 10), 0.35), t0 + BEAT / 2, pan=0.3)

music = drums + reverb(fxwet, mix=0.3) + reverb(tonal, mix=0.08)

# Sidechain: everything but the drums breathes with the kick through the drop.
pump = np.ones(N)
for t0 in beats:
    if DROP <= t0 < BOARD + BEAT / 2:
        i = int(t0 * SR)
        n = int(0.22 * SR)
        pump[i : i + n] = np.minimum(pump[i : i + n], 0.55 + 0.45 * (np.arange(n) / n) ** 0.7)
music = drums + (music - drums) * pump

fade = np.ones(N)
fade[-int(1.0 * SR) :] = np.linspace(1, 0, int(1.0 * SR)) ** 2
# The breath before the end line: the band drops out after the board's hit, only its tail remains.
tt = np.arange(N) / SR
breath = np.interp(tt, [0, BOARD + 0.17, BOARD + 0.31, END - 0.06, END, DUR], [1, 1, 0.12, 0.12, 1, 1])
music *= fade * breath

# ── effects ───────────────────────────────────────────────────────────────────────────────

fx = np.zeros((2, N))
room = low(noise(DUR, 77), 400) * 0.006
fx[0] += room
fx[1] += np.roll(room, 2400)

# A whoosh into every cut, peaking on the hit.
for i, k in enumerate(["tap", "fee", "wallet", "drop", "nvda", "spy", "spyPrice", "qqq", "qqqPrice", "board", "end"]):
    length = 0.32 if k in ("nvda", "spy", "spyPrice", "qqq", "qqqPrice", "board") else 0.45
    add(fx, whoosh(length, 500, 4200, 40 + i, peak=0.85, vel=0.55), HIT[k] - length * 0.85, pan=(-0.2, 0.2)[i % 2])

# The board's rolls. Each tick lands 2 frames after its roll starts (when the character shows).
# The count-up: the 5 spins 0 → 5 on a quadratic ease-out; a tick as each digit passes, a slam as it lands.
s0, s1 = C["spin"]
for k in range(1, 6):
    add(fx, tick(k, 0.9), s0 + (s1 - s0) * (1 - np.sqrt(1 - k / 5)) + 2 * F, pan=0.05 * k)
add(fx, thump(0.6), HIT["five"])
tesla = HIT["morph"] - 2 * F  # the visual start of the morph
add(fx, whoosh(0.4, 300, 1400, 60, peak=0.6, vel=0.4), tesla - 3 * F, pan=0.3)  # $5.00 travels
rattle(fx, tesla + 6 * F, 7, 10, vel=1.0)  # 0.01225
add(fx, thump(0.5), tesla + 6 * F)  # the Tesla tile slams
rattle(fx, tesla + 8 * F, 1, 20, vel=0.8)  # TSLAx
rattle(fx, tesla + 11 * F, 1, 21, vel=0.6)  # for
rattle(fx, W["hook"]["Monad"], 4, 25, vel=0.45, step=0.02)  # the mono proof line
for j in range(4):  # the end line, word by word on the resolve
    add(fx, tick(140 + j, 0.6), END + j * 3 * F, pan=-0.2)
for line in ("tap", "fee"):
    for j, (w, t0) in enumerate(W[line].items()):
        add(fx, tick(30 + j + len(line), 0.5), t0, pan=-0.2)

# Tap: the button slams; Kovi falls, taps, hops.
add(fx, thump(0.7), HIT["tap"])
fa, fb = C["kovi"]["fall"]
add(fx, whoosh(fb - fa + 0.05, 3000, 600, 61, peak=0.9, vel=0.45), fa, pan=0.25)
add(fx, tap(), fb, pan=0.25, gain=1.3)
add(fx, blip(84, 0.9), fb + 0.01, pan=0.25)
add(fx, bell(mtof(88), 0.9, 0.45), fb + 0.03, pan=0.25)
add(fx, boing(), fb + 0.04, pan=0.25, gain=0.8)

# Fee: the ink panel lands; $0.00 rolls; the coral rule draws with a ding.
add(fx, thump(0.55), HIT["fee"])
fee = W["fee"]["fee"]
rattle(fx, fee, 5, 40, vel=1.0)
add(fx, bell(mtof(91), 0.8, 0.4), fee + 4 * F, pan=0.4)
rattle(fx, fee + 8 * F + 2 * F, 1, 46, vel=0.5)

# Wallet: the card rises; Kovi's plane crosses; the token drops into "You got".
pa, pb = C["kovi"]["plane"]
add(fx, whoosh(0.5, 300, 1500, 62, peak=0.4, vel=0.35), HIT["wallet"], pan=0.3)
add(fx, thump(0.5), HIT["wallet"])
add(fx, whoosh(pb - pa + 0.2, 350, 2800, 63, peak=0.7, vel=0.7), pa, pan=-0.3)
for i, m in enumerate([84, 88, 91]):
    add(fx, bell(mtof(m), 1.4, 0.4), pb + 9 * F + i * 0.04, pan=0.4)
for k in range(4):
    add(fx, glint(70 + k), pb + 9 * F + 0.1 + k * 0.06, pan=0.3 + 0.1 * k)
add(fx, boing(), pb, pan=-0.1, gain=0.5)
rattle(fx, W["fee"]["holds"], 3, 50, vel=0.4, step=0.02)

# Montage: each logo slams on its hit; each name ticks; each price rattles in on its own time.
for k, sym in (("drop", "TSLAx"), ("nvda", "NVDAx"), ("spy", "SPYx"), ("qqq", "QQQx")):
    add(fx, thump(0.6), HIT[k])
    rattle(fx, HIT[k] + F, 1, 60, vel=0.7)
    rattle(fx, C["price"][sym], 7, 70 + len(sym), vel=0.95, pan=0.15)
# The two price cuts: an accent and a slam (the figure itself rattles in above).
for k in ("spyPrice", "qqqPrice"):
    add(fx, thump(0.45), HIT[k])
    add(fx, clap(300 + int(HIT[k] * 10), 0.7), HIT[k], pan=0.1)
# Board: four tiles, two frames apart, then their prices.
for i in range(4):
    add(fx, thump(0.4), HIT["board"] + i * 2 * F)
    rattle(fx, HIT["board"] + (i * 2 + 2) * F, 7, 90 + i * 7, vel=0.45, pan=-0.3 + 0.2 * i)
# End: the mark lands; the address rolls, Kovi hops, the small print settles.
# v3's finale: the board becomes the phone. The tiles roll out, the phone rises, the Tesla tile lands
# in the page's logo; on the resolve the Bought sheet rises (Kovi in it) and the line lands.
ra, rb = C["phone"]["rise"]
fa2, fb2 = C["phone"]["fly"]
sa, sb = C["phone"]["sheet"]
add(fx, whoosh(rb - ra + 0.1, 250, 1400, 65, peak=0.75, vel=0.55), ra, pan=0.35)  # the phone rises
for i in range(1, 4):  # three tiles roll out upward
    add(fx, whoosh(0.3, 900, 3000, 66 + i, peak=0.6, vel=0.25), fa2 + i * 2 * F, pan=-0.3 + 0.25 * i)
add(fx, thump(0.6), rb)
add(fx, tick(150, 1.2), fb2, pan=0.3)  # the Tesla tile lands in the logo
add(fx, blip(86, 1.0), fb2, pan=0.3)
add(fx, thump(0.5), END)  # the resolve: the sheet starts to rise
for k in range(3):
    add(fx, glint(80 + k), fb2 + 0.03 + k * 0.05, pan=0.35)
add(fx, whoosh(sb - sa + 0.1, 300, 1600, 70, peak=0.7, vel=0.4), sa, pan=0.3)  # the sheet rises
add(fx, boing(), sb, pan=0.35, gain=0.6)  # Kovi in the sheet
za, zb = C["phone"]["zoom"]
add(fx, whoosh(zb - za, 200, 700, 71, peak=0.5, vel=0.18), za, pan=0.3)  # the camera pushes in on the receipt
url = END + 8 * F
add(fx, tick(120, 1.0), url + 2 * F)
add(fx, blip(88, 0.8), url + 4 * F)


# ── voice ─────────────────────────────────────────────────────────────────────────────────


def read(path, tempo=1.0):
    af = ["-af", f"atempo={tempo}"] if tempo != 1.0 else []
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), *af, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)


voice = np.zeros((2, N))
ids = [l["id"] for l in json.loads((A / "vo.json").read_text())["lines"]]
for line in ("hook", "tap", "fee", "end"):
    v = read(A / f"vo-{ids.index(line) + 1}.mp3", C["voTempo"].get(line, 1.0))
    if line in C["voCut"]:  # close a gap inside the line (crossfaded)
        c0, c1 = (int(x * SR) for x in C["voCut"][line])
        r = int(0.01 * SR)
        head, tail = v[:, :c0].copy(), v[:, c1:].copy()
        head[:, -r:] *= np.linspace(1, 0, r)
        tail[:, :r] *= np.linspace(0, 1, r)
        v = np.concatenate([head, tail], axis=1)
    a = int(C["vo"][line] * SR)
    n = min(v.shape[1], N - a)
    voice[:, a : a + n] += v[:, :n]
names = read(A / f"vo-{ids.index('names') + 1}.mp3")
for seg in C["names"]:
    s0, s1 = (int(x * SR) for x in seg["src"])
    piece = names[:, s0:s1].copy()
    r = int(0.012 * SR)
    piece[:, :r] *= np.linspace(0, 1, r)
    piece[:, -r * 3 :] *= np.linspace(1, 0, r * 3)
    a = int(seg["at"] * SR)
    voice[:, a : a + piece.shape[1]] += piece[:, : N - a]

# Duck the score under the voice (less in the montage, where the names ride the beat).
level = np.sqrt(np.convolve((voice**2).mean(axis=0), np.ones(int(0.03 * SR)) / int(0.03 * SR), "same"))
speaking = (level > 0.004).astype(float)
duck = np.zeros(N)
g = 0.0
up, down = np.exp(-1 / (0.3 * SR)), np.exp(-1 / (0.03 * SR))
for i in range(0, N, 48):
    target = speaking[i]
    k = down if target > g else up
    g = target + (g - target) * k**48
    duck[i : i + 48] = g
depth = np.full(N, 0.6)
depth[int(HIT["drop"] * SR) : int(HIT["board"] * SR)] = 0.62
depth[int(HIT["end"] * SR) :] = 0.7
# The names ride over the drop: 2 dB more voice in the montage.
voice[:, int((HIT["drop"] - 0.1) * SR) : int(HIT["board"] * SR)] *= 1.26
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
