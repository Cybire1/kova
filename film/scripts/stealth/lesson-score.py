"""The stealth lesson's sound (src/stealth/Explainer.tsx): a calm synthesised bed and a sound for each
thing the picture does, from the same timeline (src/stealth/explainer.json). Nothing licensed, no voice.

100 bpm in D major, pad and kalimba, no drums: it is a lesson. Coins clink into the glass mailbox, eyes
glint, every colour lands with a note, every mix pours, the new mailbox lands, each hint Ada checks
ticks, the match rings, the lid opens, the fee stamps, and a chord rings under the end card.
Mastered to -16 LUFS (quieter than an ad), true peak checked after AAC.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from synth import SR, add, band, bass, bell, glint, kalimba, noise, pad, shaker, thump, whoosh  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
E = json.loads((ROOT / 'src/stealth/explainer.json').read_text())
OUT = ROOT / 'public/stealth/lesson.wav'
WORK = ROOT / 'out/stealth'
WORK.mkdir(parents=True, exist_ok=True)

DURATION = E['duration']
N = int(DURATION * SR)
BEAT = 60 / E['bpm']
BAR = BEAT * 4
S = E['scenes']
END = E['end']['at']
CHORDS = [(62, 66, 69), (59, 62, 66), (55, 59, 62), (57, 61, 64)]
ROOTS = [38, 35, 31, 33]
music = np.zeros((2, N))
fx = np.zeros((2, N))


def click(seed, vel=1.0):
    n = noise(0.014, seed)
    out = band(n * np.exp(-np.arange(len(n)) / (SR * 0.0018)), 1600, 7500) * 0.9
    k = int(0.012 * SR)
    out[:k] += np.sin(2 * np.pi * 240 * np.arange(k) / SR) * np.exp(-np.arange(k) / (SR * 0.0025)) * 0.35
    return out * vel


def note(at, m, vel=0.4, pan=0.0):
    add(fx, kalimba(m, vel=vel), at, pan=pan)


def pour(at, vel=0.3):
    add(fx, whoosh(0.7, 300, 1800, int(at * 10), peak=0.6, vel=vel), at)


# The bed: pad every bar, a soft bass, a kalimba arpeggio, a quiet shaker.
bar, t = 0, 0.0
while t < END:
    chord, root = CHORDS[bar % 4], ROOTS[bar % 4]
    add(music, pad(chord, BAR + 0.4, vel=0.26), t)
    for b in range(4):
        at = t + b * BEAT
        add(music, bass(root if b % 2 == 0 else root + 12, vel=0.42 if b == 0 else 0.26), at)
        add(music, kalimba(chord[(b + bar) % 3] + 12, vel=0.2), at, pan=0.3)
        add(music, shaker(int(at * 1000), vel=0.16), at + BEAT / 2, pan=-0.3)
    t += BAR
    bar += 1

# 1. Coins clink into the glass mailbox; the onlookers' eyes glint.
for i, c in enumerate(E['glass']['coins']):
    add(fx, bell(1760.0 + i * 220, seconds=0.5, vel=0.22), c + 0.45, pan=0.1)
    add(fx, click(10 + i, vel=0.5), c + 0.45, pan=0.1)
for i in range(2):
    add(fx, glint(3 + i), E['glass']['onlookers'] + 0.6 + i * 0.3, pan=0.5)

# 2. Ada's colours: a note for each, a pour for the mix, a ring for the result.
R = E['recipe']
note(R['secret'], 62, pan=-0.3)
note(R['common'], 66, pan=0.0)
pour(R['mix'])
note(R['mix'] + 0.7, 69, vel=0.5, pan=0.3)
add(fx, bell(880.0, seconds=1.2, vel=0.2), R['mix'] + 0.75, pan=0.3)
note(R['note'], 74, vel=0.3)

# 3. Sam pays.
P = E['pay']
note(P['sam'], 57, pan=-0.5)
note(P['secret'], 61, pan=-0.4)
pour(P['mix'])
note(P['mix'] + 0.7, 64, vel=0.5)
add(fx, whoosh(0.6, 400, 2400, 21, peak=0.5, vel=0.25), P['mailbox'])
add(fx, thump(vel=0.6), P['mailbox'] + 0.35)
add(fx, bell(1760.0, seconds=0.5, vel=0.24), P['coin'] + 0.8)
add(fx, click(30, vel=0.5), P['coin'] + 0.8)
add(fx, click(31, vel=0.4), P['board'], pan=0.6)
note(P['hint'], 66, vel=0.3, pan=-0.2)
pour(P['hint'] + 0.4, vel=0.22)
add(fx, whoosh(0.9, 500, 3000, 22, peak=0.5, vel=0.25), P['hint'] + 1.6)
add(fx, click(32, vel=0.6), P['hint'] + 2.5, pan=0.6)

# 4. Ada checks each hint; the fourth rings true; the onlooker's try buzzes flat.
F = E['find']
for i in range(5):
    at = F['first'] + i * F['step']
    add(fx, click(40 + i, vel=0.45), at + 0.3, pan=-0.5 + i * 0.15)
    note(at + 0.3, [62, 64, 66, 69, 71][i] + (12 if i == F['match'] else 0), vel=0.5 if i == F['match'] else 0.22)
add(fx, whoosh(0.7, 400, 2600, 23, peak=0.6, vel=0.25), F['line'])
add(fx, bell(587.33, seconds=2.0, vel=0.45), F['line'] + 0.5, pan=0.4)
add(fx, bell(880.0, seconds=1.8, vel=0.3), F['line'] + 0.52, pan=0.4)
add(fx, glint(9), F['line'] + 0.55, pan=0.4)
note(F['onlooker'], 50, vel=0.35, pan=-0.6)
note(F['onlooker'] + 0.12, 49, vel=0.3, pan=-0.6)

# 5. Ada spends.
Sp = E['spend']
note(Sp['key'], 62, pan=-0.2)
pour(Sp['key'] + 0.4, vel=0.2)
add(fx, glint(11), Sp['key'] + 0.9)
add(fx, whoosh(0.7, 400, 2600, 24, peak=0.5, vel=0.25), Sp['fly'])
add(fx, thump(vel=0.5), Sp['open'])
add(fx, click(50, vel=0.6), Sp['open'])
add(fx, bell(1760.0, seconds=0.6, vel=0.26), Sp['coin'] + 0.8, pan=-0.5)
note(Sp['helper'], 57, pan=0.5)
add(fx, click(51, vel=0.7), Sp['stamp'] + 0.7, pan=0.3)
add(fx, click(52, vel=0.5), Sp['stamp'] + 0.74, pan=0.3)

# 6. Recap: each new mailbox lands, and each of Ada's ticks rises.
Rc = E['recap']
for i in range(6):
    add(fx, click(60 + i, vel=0.35), Rc['boxes'] + i * 0.22, pan=-0.3 + i * 0.12)
    note(Rc['ticks'] + i * 0.28, [62, 66, 69, 74, 78, 81][i], vel=0.35, pan=-0.3 + i * 0.12)

# 7. The end card.
add(fx, whoosh(0.8, 300, 2600, 25, peak=0.7, vel=0.25), END - 0.8)
add(fx, bell(587.33, seconds=3.0, vel=0.4), END + 0.05)
add(music, pad((50, 62, 66, 69), DURATION - END, vel=0.45), END)

mix = music * 0.5 + fx * 0.9
mix[:, -int(1.0 * SR):] *= np.linspace(1, 0, int(1.0 * SR))
raw = WORK / 'lesson-raw.wav'
wavfile.write(raw, SR, (mix.T / max(1e-9, np.abs(mix).max()) * 0.7).astype(np.float32))
meas = subprocess.run(['ffmpeg', '-nostats', '-i', str(raw), '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
lufs = float([ln for ln in meas.splitlines() if ln.strip().startswith('I:')][-1].split()[1])
gain = -16.0 - lufs


def true_peak_after_aac(path):
    test = WORK / 'tp.m4a'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-c:a', 'aac', '-b:a', '192k', str(test)], check=True)
    out = subprocess.run(['ffmpeg', '-nostats', '-i', str(test), '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float([ln for ln in out.splitlines() if ln.strip().startswith('Peak:')][-1].split()[1])


for _ in range(6):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-af', f'volume={gain:.2f}dB,alimiter=limit=0.70:level=false', '-ar', '48000', '-c:a', 'pcm_s16le', str(OUT)], check=True)
    tp = true_peak_after_aac(OUT)
    if tp <= -1.2:
        break
    gain -= tp + 1.4
print(f'{OUT}: raw {lufs:.1f} LUFS, +{gain:.1f} dB, encoded true peak {tp:.1f} dBTP')
