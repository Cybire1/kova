"""The Kova Dollar Card film's sound (src/dollar-card/Film.tsx): Sarah's voice, a synthesised score
and effects, mixed and mastered to one file. Nothing licensed.

100 bpm, D major: D, A, Bm, G, one bar each (2.4 s). A bright open under the hook, the groove under
the top-up and the purchase, a lift for the facts, and a chord that rings out under the end card.
The music dips under every spoken line (about 9 dB), and the effects sit on the film's own cuts.

Mastered with one fixed gain to -14 LUFS, then a limiter for peaks only (loudnorm alone would compress).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from synth import SR, add, bass, bell, blip, glint, kalimba, musicbox, pad, shaker, snap, tap, thump, whoosh  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public'
OUT = PUBLIC / 'dollar-card/score.wav'
WORK = ROOT / 'out/dollar-card'
WORK.mkdir(parents=True, exist_ok=True)

DURATION = 27.0
N = int(DURATION * SR)
BEAT = 60 / 100
BAR = BEAT * 4
# A bar starts at 2.0 s, so every cut in the film lands on a beat: the sheet 3.8, the 5 typed 4.4,
# Face ID 5.6, the new balance 7.4, the checkout 9.2 (a downbeat), the receipt 12.2, the card 15.8,
# the facts 18.8 (a downbeat) and 20.6, and the end card 23.0, where A resolves to D.
GRID = 2.0
END_AT = 23.0
# When each voice line starts (the film's VO_AT).
VO_AT = {'hook': 0.35, 'topup': 3.9, 'spend': 9.6, 'paid': 12.75, 'there': 16.15}

music = np.zeros((2, N))
sfx = np.zeros((2, N))
voice = np.zeros((2, N))

CHORDS = [(62, 66, 69), (57, 61, 64), (59, 62, 66), (55, 59, 62)]  # D A Bm G
ROOTS = [38, 33, 35, 31]


def section(t):
    if t < 4.4:
        return 'open'
    if t < 18.8:
        return 'groove'
    if t < END_AT:
        return 'lift'
    return 'end'


def bed(sig, at, **kw):
    """A note of the bed, unless it would fall before the film or on the end card (the chord's)."""
    if 0 <= at < END_AT:
        add(music, sig, at, **kw)


# Bar -1 is a pickup: its pad starts on the film's first frame, and the last pad releases into the end.
for b in range(-1, int((END_AT - GRID) / BAR) + 1):
    t0 = GRID + b * BAR
    chord, root = CHORDS[b % 4], ROOTS[b % 4]
    if t0 + BAR > END_AT:
        chord, root = CHORDS[1], ROOTS[1]  # the bar into the end card is A, so it resolves V to I
    s = section(max(t0, 0))
    start = max(t0, 0)
    add(music, pad([n - 12 for n in chord], min(t0 + BAR + 0.4, END_AT + 0.3) - start, vel=0.9), start, gain=0.55)
    if s != 'open':
        bed(bass(root, vel=0.95), t0, gain=0.85)
        bed(bass(root, vel=0.75), t0 + 2 * BEAT, gain=0.75)
        for i in range(16):
            bed(shaker((b + 1) * 16 + i, vel=0.9 if i % 4 == 2 else 0.5), t0 + i * BEAT / 4, pan=0.35, gain=0.8)
        bed(snap(b + 1, vel=0.85), t0 + BEAT, pan=-0.2, gain=0.75)
        bed(snap(b + 100, vel=0.85), t0 + 3 * BEAT, pan=-0.2, gain=0.75)
    pattern = [0, 1, 2, 1, 2, 0, 1, 2] if s != 'open' else [0, None, 2, None, 1, None, 2, None]
    for i, k in enumerate(pattern):
        if k is None:
            continue
        note = chord[k] + (12 if i in (3, 6) else 0)
        bed(kalimba(note, vel=0.85 if i % 2 == 0 else 0.6), t0 + i * BEAT / 2, pan=-0.25 + 0.5 * (i % 2), gain=0.9)
    if s == 'lift':
        for i, k in enumerate([2, 1, 0, 1]):
            bed(musicbox(chord[k] + 12, vel=0.8), t0 + i * BEAT, pan=0.15, gain=0.6)

# The end: one D major chord that rings out under the end card.
for n, pan in zip((62, 66, 69, 74), (-0.3, 0.1, 0.3, -0.1)):
    add(music, bell(440.0 * 2 ** ((n - 69) / 12), seconds=4.0, vel=0.8), END_AT, pan=pan, gain=0.5)
add(music, pad([50, 54, 57], 4.0, vel=1.0), END_AT, gain=0.6)
add(music, bass(38, vel=1.0), END_AT, gain=0.9)

# ── Voice ─────────────────────────────────────────────────────────────────────────────────────
vo = json.loads((PUBLIC / 'dollar-card/audio/vo-cut.json').read_text())
duck = np.ones(N)
for line in vo['lines']:
    at = VO_AT[line['id']]
    pcm = np.frombuffer(subprocess.check_output(
        ['ffmpeg', '-v', 'error', '-i', str(PUBLIC / line['file']), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-']
    ), dtype=np.float32).astype(float)
    add(voice, pcm, at, gain=1.0)
    # Dip the music under the line, easing in and out over 120 ms.
    i0, i1 = int((at - 0.1) * SR), int((at + line['duration'] + 0.1) * SR)
    duck[max(0, i0):min(N, i1)] = 0.35
ease = int(0.12 * SR)
kernel = np.ones(ease) / ease
duck = np.convolve(duck, kernel, mode='same')

# ── Effects, on the film's own cuts ───────────────────────────────────────────────────────────
# A whoosh peaks at (start + length x peak), so each starts that much before its cut.
add(sfx, glint(3), 0.02, pan=-0.3, gain=0.55)                                      # the card screen
add(sfx, whoosh(0.35, 500, 1500, seed=2, peak=0.35), 3.68, pan=-0.3, gain=0.45)    # the sheet (3.8)
add(sfx, tap(), 4.4, pan=-0.3, gain=0.5)                                           # 5
add(sfx, tap(), 5.6, pan=-0.3, gain=0.55)                                          # Top up $5.00
for i, n in enumerate((79, 83, 86)):
    add(sfx, blip(n, vel=0.9), 5.95 + i * 0.07, pan=-0.3, gain=0.55)              # Face ID
add(sfx, glint(8), 6.7, pan=-0.3, gain=0.75)                                       # its tick
add(sfx, whoosh(0.3, 1400, 500, seed=4, peak=0.3), 7.31, pan=-0.3, gain=0.35)     # the sheet goes (7.4)
for i, n in enumerate((74, 78, 81, 86)):
    add(sfx, blip(n, vel=0.9), 7.8 + i * 0.06, pan=-0.3, gain=0.6)                # $5.12
add(sfx, whoosh(0.5, 400, 1800, seed=9, peak=0.6), 8.9, gain=0.7)                 # to the checkout (9.2)
add(sfx, tap(), 10.15, pan=0.3, gain=0.55)                                         # Confirm Order
add(sfx, whoosh(0.5, 1600, 400, seed=10, peak=0.55), 11.93, gain=0.65)            # to the receipt (12.2)
add(sfx, thump(vel=0.8), 12.75, gain=0.6)                                          # Paid.
add(sfx, glint(11), 12.8, pan=0.2, gain=0.6)
add(sfx, blip(86, vel=0.85), 14.2, pan=0.3, gain=0.6)                              # 3421
add(sfx, blip(90, vel=0.85), 14.5, pan=0.3, gain=0.6)                              # $2.20
add(sfx, whoosh(0.5, 700, 250, seed=13, peak=0.55), 15.53, gain=0.6)              # to the card (15.8)
for i, at in enumerate((18.8, 20.6)):
    add(sfx, thump(vel=0.9), at, gain=0.8)                                         # the facts, on the beat
    add(sfx, whoosh(0.3, 500, 2000, seed=20 + i, peak=0.45), at - 0.135, gain=0.5)
add(sfx, whoosh(0.9, 250, 2600, seed=15, peak=0.85), END_AT, pan=-0.4, gain=0.85)  # the end card
add(sfx, glint(16), END_AT + 0.9, pan=0.2, gain=0.75)

# ── Mix and master ────────────────────────────────────────────────────────────────────────────
t = np.arange(N) / SR
fade = np.interp(t, [0, 0.01, DURATION - 1.0, DURATION], [0, 1, 1, 0])
mixdown = (music * 0.5 * duck + sfx * 0.8 + voice * 1.9) * fade
raw = WORK / 'score-raw.wav'
wavfile.write(raw, SR, (np.clip(mixdown.T, -1, 1) * 32767).astype(np.int16))
measured = subprocess.run(
    ['ffmpeg', '-hide_banner', '-i', str(raw), '-af', 'loudnorm=I=-14:TP=-1.5:print_format=json', '-f', 'null', '-'],
    capture_output=True, text=True,
).stderr
stats = json.loads(measured[measured.rindex('{'):measured.rindex('}') + 1])
gain = -14 - float(stats['input_i'])
subprocess.run(
    ['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-af', f'volume={gain:.2f}dB,alimiter=limit=0.84:level=false', '-ar', str(SR), str(OUT)],
    check=True,
)
# Stems at the same gain, for checking the balance of voice and music.
for name, bus in (('voice', voice * 1.9), ('music', music * 0.5 * duck)):
    wavfile.write(WORK / f'stem-{name}.wav', SR, (np.clip((bus * fade).T * 10 ** (gain / 20), -1, 1) * 32767).astype(np.int16))
print(f'raw {stats["input_i"]} LUFS, gain {gain:+.2f} dB -> {OUT}')
