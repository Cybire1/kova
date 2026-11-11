"""The cash-out film's sound (src/cashout/Film.tsx): a synthesised score and the departure board's
clatter, from the same timeline as the picture (src/cashout/cues.json). Nothing licensed, no voice.

120 bpm in D major: D, Bm, G, A, a bar each (2 s). A pulse under the hook, the groove under the
board and the run, a breath and a rise into LANDED (24.0, a downbeat), the hit there, the full band
under the wall of flags, and a chord that rings out under the end card. Every flap word clatters
for as long as its letters flip; the 52 flags each land with a clack.

Mastered with one fixed gain to -14 LUFS, then a limiter for peaks only, checked after encoding.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from synth import SR, add, band, bass, bell, high, kalimba, low, noise, pad, shaker, snap, thump, whoosh  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CUES = json.loads((ROOT / 'src/cashout/cues.json').read_text())
OUT = ROOT / 'public/cashout/mix.wav'
WORK = ROOT / 'out/cashout'
WORK.mkdir(parents=True, exist_ok=True)

DURATION = CUES['duration']
N = int(DURATION * SR)
BEAT = 60 / CUES['bpm']
BAR = BEAT * 4
LANDED = CUES['ticket']['landed']
WALL = CUES['wall']['at']
END = CUES['end']['at']
RUN = CUES['run']['at']
BOARD = CUES['board']['at']

music = np.zeros((2, N))
fx = np.zeros((2, N))

CHORDS = [(62, 66, 69), (59, 62, 66), (55, 59, 62), (57, 61, 64)]  # D Bm G A
ROOTS = [38, 35, 31, 33]
rng = np.random.default_rng(7)


def clack(seed, vel=1.0):
    """One flap falling: a dry click with a little paper and a knock of the frame."""
    n = noise(0.012, seed)
    env = np.exp(-np.arange(len(n)) / (SR * 0.0016))
    click = band(n * env, 1800, 7000) * 0.9
    knock = np.sin(2 * np.pi * 210 * np.arange(int(0.01 * SR)) / SR) * np.exp(-np.arange(int(0.01 * SR)) / (SR * 0.002))
    out = np.zeros(max(len(click), len(knock)))
    out[: len(click)] += click
    out[: len(knock)] += knock * 0.35
    return out * vel


def clatter(at, letters, pan=0.0, vel=0.5, flips=8, stagger=0.022, step=2 / 30):
    """A word flipping in: each letter clacks once a flip, for its own run of flips."""
    for i in range(letters):
        start = at + i * stagger
        for k in range(flips + int(rng.integers(-3, 3))):
            when = start + k * step + rng.uniform(-0.004, 0.004)
            add(fx, clack(int(rng.integers(1, 1e6)), vel * rng.uniform(0.55, 1.0)), when, pan=pan + rng.uniform(-0.15, 0.15))


# ── Music ─────────────────────────────────────────────────────────────────────────────────────────

def section(t):
    if t < BOARD:
        return 'hook'
    if t < LANDED - 2.0:
        return 'groove'
    if t < LANDED:
        return 'rise'
    if t < WALL:
        return 'after'
    if t < END:
        return 'full'
    return 'end'


bar = 0
t = 0.0
while t < END:
    chord = CHORDS[bar % 4]
    root = ROOTS[bar % 4]
    s = section(t)
    # The pad: quiet under the hook and the run, open under the wall.
    pad_vel = {'hook': 0.22, 'groove': 0.26, 'rise': 0.34, 'after': 0.3, 'full': 0.42}.get(s, 0.3)
    add(music, pad(chord, BAR + 0.4, vel=pad_vel), t)
    for b in range(4):
        at = t + b * BEAT
        st = section(at)
        if st in ('groove', 'after', 'full'):
            add(music, bass(root if b % 2 == 0 else root + 12, vel=0.7 if b == 0 else 0.45), at)
        if st in ('groove', 'after', 'full') and b in (1, 3):
            add(music, snap(int(at * 100), vel=0.5), at, pan=0.1)
        if st in ('hook', 'groove', 'after', 'full'):
            for e in range(2):
                add(music, shaker(int(at * 1000) + e, vel=0.28 if e else 0.4), at + e * BEAT / 2, pan=-0.25)
        # The kalimba line: an arpeggio of the chord, brighter under the wall.
        if st in ('hook', 'full') or (st == 'groove' and b in (0, 2)):
            note = chord[(b + bar) % 3] + (12 if st == 'full' else 0)
            add(music, kalimba(note, vel=0.5 if st == 'full' else 0.38), at, pan=0.3)
            if st == 'full':
                add(music, kalimba(chord[(b + 1) % 3] + 12, vel=0.3), at + BEAT / 2, pan=-0.3)
    t += BAR
    bar += 1

# The rise into LANDED: the drums drop for a beat, a swell and a whoosh lift to the downbeat.
add(fx, whoosh(1.8, 200, 4200, 11, peak=0.85, vel=0.5), LANDED - 1.8, pan=0.0)
# The hit: a thump, a bell on D, and the chord again, wide.
add(fx, thump(vel=1.0), LANDED)
add(fx, bell(587.33, seconds=2.4, vel=0.55), LANDED, pan=0.15)
add(fx, bell(880.0, seconds=2.0, vel=0.3), LANDED + 0.02, pan=-0.2)
add(music, pad((62, 66, 69, 74), 2.6, vel=0.5), LANDED)

# The end: the chord rings out under the logo, a bell as it settles.
add(music, pad((50, 62, 66, 69), DURATION - END, vel=0.55), END)
add(fx, bell(587.33, seconds=3.0, vel=0.45), END + 0.3)
add(fx, whoosh(0.5, 3000, 300, 21, peak=0.5, vel=0.3), END - 0.25)

# Morphs of the board: a soft air move each time the ink shape changes.
for at in (BOARD - 0.3, RUN - 0.35, CUES['peak']['at'] - 0.2, WALL - 0.35):
    add(fx, whoosh(0.6, 500, 2600, int(at * 10), peak=0.6, vel=0.22), at)

# ── The board's clatter ───────────────────────────────────────────────────────────────────────────

for name, at in CUES['hook']['names']:
    clatter(at, max(len(name), 5), pan=0.45, vel=0.45, flips=3, stagger=0.03)
clatter(BOARD + 0.2, 5, pan=0.6, vel=0.3)
for i, at in enumerate(CUES['board']['rows']):
    for j, (dt, letters) in enumerate([(0.0, 9), (0.12, 7), (0.24, 8)]):
        clatter(at + dt, letters, pan=-0.6 + j * 0.6, vel=0.38)
tk = CUES['ticket']
for key, letters in [('to', 12), ('by', 12), ('send', 12), ('gets', 12), ('status', 12)]:
    clatter(tk[key], letters, pan=-0.5, vel=0.32, flips=6)
clatter(CUES['peak']['at'] + 0.2, 10, pan=-0.3, vel=0.45)
clatter(LANDED - 0.3, 6, pan=-0.3, vel=0.7, flips=3, stagger=0.015)
clatter(CUES['peak']['at'] + 0.6, 12, pan=-0.3, vel=0.3, flips=6)
for i in range(52):
    add(fx, clack(1000 + i, 0.9), CUES['wall']['flags'] + rng.uniform(0, 1.2), pan=rng.uniform(-0.8, 0.8))
clatter(CUES['wall']['title'], 13, pan=0.0, vel=0.55)

# Each change of section lands with a soft low knock on its frame.
for at in (BOARD, RUN, WALL, END):
    add(fx, thump(vel=0.4), at)

# ── What the footage does ─────────────────────────────────────────────────────────────────────────

# A soft tick on every cut of the phone, so the cut is heard, not only seen.
for cut in CUES['run']['cuts'][1:] + [CUES['peak']]:
    add(fx, clack(int(cut['at'] * 1000), 0.35), cut['at'], pan=0.45)
# A key under each typed character: the phone number, then the 5 and the 0.
for i, at in enumerate(CUES['keys']):
    key = band(noise(0.02, 500 + i), 900, 4000) * np.exp(-np.arange(int(0.02 * SR)) / (SR * 0.003))
    add(fx, key * 0.5, at, pan=0.4)
# The end card's address flips in.
clatter(END + 0.75, 10, pan=0.0, vel=0.45, flips=4)

# ── Ambience: a quiet hall under everything, so the cuts never land in silence ───────────────────

hall = low(noise(DURATION, 99), 900) * 0.035
hall += band(noise(DURATION, 98), 2000, 6000) * 0.004
swell = np.clip(np.sin(np.linspace(0, np.pi * 3, N)) * 0.3 + 0.7, 0, 1)
fx[0] += hall * swell
fx[1] += np.roll(hall, 2400) * swell

# ── Mix and master ────────────────────────────────────────────────────────────────────────────────

music = low(high(music, 35), 15000)
TRACK = ROOT / 'public/cashout/music.mp3'
if TRACK.exists():
    # The produced track (scripts/cashout/music.mjs) replaces the synthesised band: its biggest hit
    # near the landing is moved onto LANDED, and it dips under the board's clatter.
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(TRACK), '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    track = np.frombuffer(pcm, np.float32).reshape(-1, 2).T.astype(np.float64)
    mono = np.abs(track).mean(axis=0)
    hop = SR // 100
    env = np.array([mono[i:i + hop].mean() for i in range(0, len(mono) - hop, hop)])
    rise_at = np.diff(env, prepend=env[0])
    lo, hi = int((LANDED - 1.0) * 100), int((LANDED + 1.0) * 100)
    hit = (lo + int(np.argmax(rise_at[lo:hi]))) / 100
    shift = LANDED - hit
    print(f'track: biggest hit at {hit:.2f}s, moved {shift:+.2f}s onto LANDED')
    k = int(round(shift * SR))
    placed = np.zeros((2, N))
    if k >= 0:
        n = min(N - k, track.shape[1])
        placed[:, k:k + n] = track[:, :n]
    else:
        n = min(N, track.shape[1] + k)
        placed[:, :n] = track[:, -k:-k + n]
    placed[:, -int(1.2 * SR):] *= np.linspace(1, 0, int(1.2 * SR)) ** 2
    # Duck under the clatter: follow the clicks (fast in, slow out) and dip up to 7 dB.
    clicks = np.abs(high(fx.mean(axis=0), 1500))
    follow = np.zeros(N)
    y = 0.0
    att, rel = np.exp(-1 / (0.004 * SR)), np.exp(-1 / (0.14 * SR))
    for i in range(0, N, 32):
        x = clicks[i:i + 32].max()
        y = att * y + (1 - att) * x if x > y else rel * y + (1 - rel) * x
        follow[i:i + 32] = y
    amount = np.clip(follow / (np.percentile(follow, 99) + 1e-9), 0, 1)
    duckt = 10 ** (-7 * amount / 20)
    mix = placed * duckt * 0.55 + fx * 0.9
else:
    mix = music * 0.55 + fx * 0.9
mix[:, -int(0.6 * SR):] *= np.linspace(1, 0, int(0.6 * SR))
# The effects alone, for the mute-music test (onsets on every cut).
wavfile.write(WORK / 'fx.wav', SR, (fx.T / max(1e-9, np.abs(fx).max()) * 0.7).astype(np.float32))
raw = WORK / 'raw.wav'
wavfile.write(raw, SR, (mix.T / max(1e-9, np.abs(mix).max()) * 0.7).astype(np.float32))
meas = subprocess.run(['ffmpeg', '-nostats', '-i', str(raw), '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
lufs = float([ln for ln in meas.splitlines() if ln.strip().startswith('I:')][-1].split()[1])
gain = -14.0 - lufs


def true_peak_after_aac(path):
    """The true peak once encoded as the film's AAC, where sharp clicks overshoot."""
    test = WORK / 'tp.m4a'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-c:a', 'aac', '-b:a', '192k', str(test)], check=True)
    out = subprocess.run(['ffmpeg', '-nostats', '-i', str(test), '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float([ln for ln in out.splitlines() if ln.strip().startswith('Peak:')][-1].split()[1])


# One fixed gain toward -14 LUFS and a limiter for peaks only; less gain until the encoded peak
# sits under -1 dBTP.
for _ in range(6):
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-af', f'volume={gain:.2f}dB,alimiter=limit=0.70:level=false', '-ar', '48000', '-c:a', 'pcm_s16le', str(OUT)],
        check=True,
    )
    tp = true_peak_after_aac(OUT)
    if tp <= -1.2:
        break
    gain -= tp + 1.4
print(f'encoded true peak {tp:.1f} dBTP')
print(f'{OUT}: raw {lufs:.1f} LUFS, +{gain:.1f} dB')
