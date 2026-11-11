"""
The sound of "xStocks, live in Kova" (src/xstocks): the voice, a synthesised score and the film's own
effects, placed on the cues in src/xstocks/cues.json. Nothing licensed: every instrument is numpy
(scripts/synth.py). One master: a fixed gain to -14 LUFS and a limiter for peaks only (loudnorm would
compress the voice into the music).

  score    D major at 100 bpm (a bar is 2.4 s): kalimba and pad under the hook, a groove from the buy,
           a breath for the Face ID, the music box as it lands, the full band on Monad, a resolve on the
           name. Ducked about 12 dB under the voice, out over the last 1.5 s.
  voice    public/xstocks/audio (Sarah), at the starts in cues.json
  effects  a soft chord for the opening, taps where the phone is touched, the sheet's air, a quiet tick
           each second the price holds, air for each camera move, Face ID's two notes and its chime, a
           chime for "Bought", the receipt's thump, the $5 going in and Kovi flying the stock back, a pop
           for the fee, a bell chord under the mark, a pop for the address.

Writes public/xstocks/mix.wav (and voice.wav, score.wav, effects.wav to check levels).
Run: python3 scripts/xstocks/sound.py
"""

import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from synth import SR, add, bass, bell, blip, glint, kalimba, mtof, musicbox, pad, shaker, snap, tap, thump, whoosh  # noqa: E402

P = ROOT / "public/xstocks"
C = json.loads((ROOT / "src/xstocks/cues.json").read_text())
DUR = C["duration"]
N = int(SR * DUR)
VO = C["vo"]
words = {l["id"]: l["words"] for l in json.loads((P / "audio/vo.json").read_text())["lines"]}


def word(line, text):
    return VO[line] + next(w["start"] for w in words[line] if w["text"].startswith(text))


# ── score ──────────────────────────────────────────────────────────────────────────────────

BEAT = 0.6
BAR = 4 * BEAT
CHORDS = {  # root for the bass, four arp notes, pad triad
    "D": (38, [74, 78, 81, 86], [62, 66, 69]),
    "Bm": (35, [71, 74, 78, 83], [59, 62, 66]),
    "G": (43, [67, 71, 74, 79], [55, 59, 62]),
    "A": (45, [69, 73, 76, 81], [57, 61, 64]),
}
PROGRESSION = ["D", "Bm", "G", "A"] * 3 + ["D", "D"]
ARP = [0, 2, 3, 1, 2, 3, 1, 2]


def section(start):
    if start < 2.4:
        return "sparse"
    if start < 14.0:
        return "groove"
    if start < 16.8:
        return "breath"
    if start < 19.2:
        return "lift"
    if start < 25.9:
        return "full"
    return "end"


music = np.zeros((2, N))
for bar, name in enumerate(PROGRESSION):
    start = bar * BAR
    if start >= DUR:
        break
    kind = section(start)
    root, arp, triad = CHORDS[name]
    if kind != "end":
        add(music, pad(triad, BAR + 0.6, vel=1.2 if kind in ("breath", "full") else 1.0), start)
    if kind in ("sparse", "breath"):
        for i, idx in enumerate([0, 2, 3, 2]):
            add(music, kalimba(arp[idx], vel=0.85 if i == 0 else 0.6), start + i * BEAT, pan=-0.2 + 0.13 * i)
    elif kind in ("groove", "lift", "full"):
        for i, idx in enumerate(ARP):
            add(music, kalimba(arp[idx], vel=0.9 if i % 2 == 0 else 0.58), start + i * BEAT / 2, pan=-0.3 + 0.08 * i)
        add(music, bass(root + 12, 1.0), start)
        add(music, bass(root + 12, 0.8), start + 2 * BEAT)
        for i in range(8):
            add(music, shaker(bar * 10 + i, 1.0 if i % 2 else 0.6), start + i * BEAT / 2 + (0.03 if i % 2 else 0), pan=0.35)
    if kind == "breath":
        add(music, bass(root + 12, 0.6), start)
    if kind == "lift":
        for i, m in enumerate([86, 85, 81, 78] if name in ("G", "A") else [81, 83, 86, 90]):
            add(music, musicbox(m, 0.7), start + i * BEAT + BEAT / 2, pan=0.25)
    if kind == "full":
        add(music, snap(bar * 3, 0.9), start + BEAT, pan=-0.15)
        add(music, snap(bar * 3 + 1, 0.9), start + 3 * BEAT, pan=-0.15)

# The name: a warm resolve on D.
add(music, pad([50, 57, 62, 66, 69], DUR - 25.9 + 0.5, vel=1.5), 25.9)
for i, m in enumerate([78, 81, 86]):
    add(music, musicbox(m, 0.45), VO["end"] + 2.6 + i * 0.3, pan=0.2)

fade = np.ones(N)
fade[-int(1.5 * SR):] = np.linspace(1, 0, int(1.5 * SR)) ** 2
music *= fade

# ── effects ────────────────────────────────────────────────────────────────────────────────

fx = np.zeros((2, N))
# The opening: a soft chord under the line.
for i, m in enumerate([74, 78, 81]):
    add(fx, bell(mtof(m), 2.2, 0.35), 0.05 + i * 0.03, pan=-0.2 + 0.2 * i)
# Taps on the phone.
for at in (C["tapBuyTesla"], C["tapFive"], C["tapSeePrice"], C["tapBuy"], C["tapProof"]):
    add(fx, tap(), at, pan=0.35, gain=0.9)
# The sheet rises; the price arrives.
add(fx, whoosh(0.5, 300, 1500, 31, peak=0.5, vel=0.5), C["sheetUp"][0], pan=0.3)
add(fx, whoosh(0.45, 400, 1800, 32, peak=0.5, vel=0.45), C["review"][0], pan=0.3)
add(fx, blip(86, 0.6), C["tapFive"] + 0.02, pan=0.35)
# The price holds: a quiet tick each second the countdown moves.
for k in range(1, 10):
    add(fx, glint(k + 3), C["review"][0] + k, pan=0.4, gain=0.45)
# The camera: in, along, and back out.
add(fx, whoosh(0.8, 250, 1100, 33, peak=0.55, vel=0.5), C["push"][0], pan=0.1)
add(fx, whoosh(0.8, 300, 900, 34, peak=0.5, vel=0.35), C["pan"][0], pan=0.1)
add(fx, whoosh(0.8, 1100, 280, 35, peak=0.45, vel=0.45), C["pull"][0], pan=0.0)
# Face ID: two notes as it looks, a chime when it's you.
add(fx, blip(81, 0.7), C["faceId"][0] + 0.05, pan=0.1)
add(fx, blip(86, 0.7), C["faceId"][0] + 0.18, pan=0.1)
for i, m in enumerate([86, 90]):
    add(fx, bell(mtof(m), 1.2, 0.45), C["faceIdOk"] + 0.05 + i * 0.07, pan=0.1)
# Bought.
for i, m in enumerate([74, 78, 81, 86]):
    add(fx, bell(mtof(m), 1.8, 0.5), C["bought"][0] + i * 0.07, pan=-0.15 + 0.1 * i)
for k in range(5):
    add(fx, glint(20 + k), C["bought"][0] + 0.25 + k * 0.1, pan=-0.5 + 0.25 * k)
# On Monad: the phone falls away and the receipt lands.
add(fx, whoosh(0.5, 2200, 300, 36, peak=0.2, vel=0.6), C["drop"][0], pan=0.0)
add(fx, thump(0.55), C["ink"][1] - 0.15)
# The $5 goes in; Kovi flies the stock back; it lands; the fee.
add(fx, whoosh(C["coin"][1] - C["coin"][0] + 0.2, 400, 2200, 37, peak=0.55, vel=0.55), C["coin"][0], pan=0.35)
add(fx, blip(81, 0.7), C["coin"][1], pan=0.45)
add(fx, blip(86, 0.6), word("proof", "$5"), pan=-0.3)
add(fx, whoosh(C["flight"][1] - C["flight"][0] + 0.3, 350, 2800, 38, peak=0.55, vel=0.8), C["flight"][0], pan=0.5)
for i, m in enumerate([81, 86, 90]):
    add(fx, bell(mtof(m), 2.0, 0.55), C["flight"][1] + i * 0.035, pan=0.55)
add(fx, bell(mtof(93), 0.6, 0.3), C["feeRow"], pan=-0.3)
# The end: air as the receipt leaves, a bell chord under the mark, a pop on the address.
add(fx, whoosh(0.5, 2200, 300, 39, peak=0.2, vel=0.45), C["proofOut"][0], pan=0.0)
for i, m in enumerate([62, 66, 69, 74]):
    add(fx, bell(mtof(m + 12), 2.6, 0.4), VO["end"] - 0.02 + i * 0.03)
add(fx, bell(mtof(93), 0.5, 0.35), C["url"])


def read(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)


voice = np.zeros((2, N))
for i, (key, at) in enumerate(VO.items()):
    v = read(P / f"audio/vo-{i + 1}.mp3")
    a = int(at * SR)
    n = min(v.shape[1], N - a)
    voice[:, a : a + n] += v[:, :n]

# Duck the score under the voice: an envelope of the voice, quick down, slow up.
level = np.sqrt(np.convolve((voice**2).mean(axis=0), np.ones(int(0.03 * SR)) / int(0.03 * SR), "same"))
speaking = (level > 0.004).astype(float)
duck = np.zeros(N)
up, down = np.exp(-1 / (0.35 * SR)), np.exp(-1 / (0.04 * SR))
g = 0.0
for i in range(0, N, 48):
    target = speaking[i]
    k = down if target > g else up
    g = target + (g - target) * k**48
    duck[i : i + 48] = g
music *= 1 - 0.86 * duck
fx *= 1 - 0.35 * duck

VOICE, SCORE, FX = 1.8, float(sys.argv[1]) if len(sys.argv) > 1 else 0.8, 1.0


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
    ["ffmpeg", "-v", "error", "-y", "-i", str(P / ".raw.wav"), "-af", f"volume={-14 - lufs:.2f}dB,alimiter=limit=0.84:level=false:attack=4:release=80", "-ar", str(SR), "-c:a", "pcm_s16le", str(P / "mix.wav")],
    check=True,
)
(P / ".raw.wav").unlink()
print(f"mix.wav: raw {lufs} LUFS -> -14 (score x{SCORE})")
