"""The stealth film's sound (src/stealth/Film.tsx): a synthesised score and its clicks, from the same
timeline as the picture (src/stealth/cues.json). Nothing licensed, no voice.

120 bpm in D major, a bar each of D, Bm, G, A (2 s), the kalimba groove of the cash-out film. A note
for every ledger row, a lift into the split and a note for each address as it lands, a tap for each
terminal line, a hit on "finds it", a bell as the note opens, a click for every chip, and a chord
that rings out under the name. Mastered to -14 LUFS, true peak checked after AAC.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from synth import SR, add, band, bass, bell, glint, kalimba, noise, pad, shaker, snap, thump, whoosh  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CUES = json.loads((ROOT / 'src/stealth/cues.json').read_text())
OUT = ROOT / 'public/stealth/mix.wav'
WORK = ROOT / 'out/stealth'
WORK.mkdir(parents=True, exist_ok=True)

DURATION = CUES['duration']
N = int(DURATION * SR)
BEAT = 60 / CUES['bpm']
BAR = BEAT * 4
SPLIT, FAN = CUES['split']['at'], CUES['split']['fan']
FOUND = CUES['found']['at']
SPEND = CUES['spend']['at']
END = CUES['end']['at']
CHORDS = [(62, 66, 69), (59, 62, 66), (55, 59, 62), (57, 61, 64)]  # D Bm G A
ROOTS = [38, 35, 31, 33]
rng = np.random.default_rng(11)
music = np.zeros((2, N))
fx = np.zeros((2, N))


def click(seed, vel=1.0):
    """A key's dry click: paper and a little wood."""
    n = noise(0.014, seed)
    env = np.exp(-np.arange(len(n)) / (SR * 0.0018))
    out = band(n * env, 1600, 7500) * 0.9
    k = int(0.012 * SR)
    out[:k] += np.sin(2 * np.pi * 240 * np.arange(k) / SR) * np.exp(-np.arange(k) / (SR * 0.0025)) * 0.35
    return out * vel


def section(t):
    if t < SPLIT:
        return 'hook'
    if t < FOUND:
        return 'groove'
    if t < SPEND:
        return 'found'
    if t < END:
        return 'full'
    return 'end'


bar, t = 0, 0.0
while t < END:
    chord, root, s = CHORDS[bar % 4], ROOTS[bar % 4], section(t)
    add(music, pad(chord, BAR + 0.4, vel={'hook': 0.22, 'groove': 0.28, 'found': 0.26, 'full': 0.38}[s]), t)
    for b in range(4):
        at = t + b * BEAT
        st = section(at)
        if st in ('groove', 'found', 'full'):
            add(music, bass(root if b % 2 == 0 else root + 12, vel=0.7 if b == 0 else 0.45), at)
        if st in ('groove', 'full') and b in (1, 3):
            add(music, snap(int(at * 100), vel=0.5), at, pan=0.1)
        for e in range(2):
            add(music, shaker(int(at * 1000) + e, vel=0.26 if e else 0.36), at + e * BEAT / 2, pan=-0.25)
        if st in ('hook', 'full') or (st == 'groove' and b in (0, 2)):
            note = chord[(b + bar) % 3] + (12 if st == 'full' else 0)
            add(music, kalimba(note, vel=0.45 if st == 'full' else 0.34), at, pan=0.3)
    t += BAR
    bar += 1

# The hook: each payment to the public address lands with a note.
for i, at in enumerate(CUES['hook']['rows']):
    if at >= 0:
        add(fx, kalimba([74, 78, 81, 86, 78][i], vel=0.42), at + 0.12, pan=0.35)
        add(fx, click(100 + i, vel=0.45), at + 0.12, pan=0.35)

# The address leaving the ledger and crossing the frame: a soft pass of air.
add(fx, whoosh(0.8, 500, 2600, 3, peak=0.5, vel=0.22), SPLIT)

# The split: a lift into the fan, a thump as the string splits, a rising note for each address.
add(fx, whoosh(0.9, 260, 3600, 5, peak=0.8, vel=0.4), FAN - 0.9)
add(fx, thump(vel=0.8), FAN)
for i in range(5):
    at = FAN + i * CUES['split']['stagger'] + 0.35
    add(fx, kalimba([62, 66, 69, 74, 78][i], vel=0.5), at, pan=-0.4 + i * 0.2)

# Found: a tap per terminal line; the hit on "finds it"; a bell and a glint as the note opens.
for i, at in enumerate(CUES['found']['lines'][:3]):
    for k in range(3):
        add(fx, click(200 + i * 10 + k, vel=0.35), at + k * 0.045, pan=-0.3)
HIT = CUES['found']['lines'][3]
add(fx, whoosh(1.0, 220, 3000, 9, peak=0.85, vel=0.35), HIT - 1.0)
add(fx, thump(vel=1.0), HIT)
add(fx, bell(587.33, seconds=2.2, vel=0.5), HIT, pan=0.15)
add(music, pad((62, 66, 69, 74), 2.4, vel=0.4), HIT)
OPEN = CUES['found']['open']
add(fx, bell(880.0, seconds=2.0, vel=0.38), OPEN + 0.05, pan=0.3)
add(fx, glint(31), OPEN + 0.1, pan=0.3)

# Spend: a click for every chip as it fills, pitched up the row.
sp = CUES['spend']
for i in range(5):
    for k in range(3):
        at = sp['rows'] + i * sp['stagger'] + k * sp['chip'] + 0.06
        add(fx, click(300 + i * 10 + k, vel=0.55), at, pan=-0.3 + k * 0.3)
        if k == 2:
            add(fx, kalimba([69, 71, 74, 76, 78][i] + 12, vel=0.3), at, pan=0.2)

# The end: the chord rings under the name.
add(fx, whoosh(0.8, 300, 2600, 13, peak=0.8, vel=0.3), END - 0.8)
add(fx, bell(587.33, seconds=3.0, vel=0.45), END + 0.05)
add(music, pad((50, 62, 66, 69), DURATION - END, vel=0.5), END)

mix = music * 0.55 + fx * 0.9
mix[:, -int(0.8 * SR):] *= np.linspace(1, 0, int(0.8 * SR))
raw = WORK / 'raw.wav'
wavfile.write(raw, SR, (mix.T / max(1e-9, np.abs(mix).max()) * 0.7).astype(np.float32))
meas = subprocess.run(['ffmpeg', '-nostats', '-i', str(raw), '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
lufs = float([ln for ln in meas.splitlines() if ln.strip().startswith('I:')][-1].split()[1])
gain = -14.0 - lufs


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
