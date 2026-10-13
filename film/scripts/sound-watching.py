#!/usr/bin/env python3
"""Sound for "Everyone's watching" (WatchingFilm): the score carries the film; a few subtle effects mark the
real moments: a hush as the train racks out of focus, the lock as "Send privately" turns on, a soft
swell each time a card lifts out of the phone, the slide, the money landing, the hush as the
strangers give up, Sam's phone arriving, his tap to pay, "Paid" and the logo. Effects are high-passed
and softened to sit inside the music, which dips a little under the big moments.
Mastered to -14 LUFS with one fixed gain and a peak limiter.

Usage: python3 scripts/sound-watching.py <score variant, e.g. w1>   -> public/private/sound-<variant>.wav
"""
import json
import subprocess
import sys

import numpy as np

SR = 48000
variant = sys.argv[1] if len(sys.argv) > 1 else 'w1'
c = json.load(open('src/private/watching-cues.json'))
DUR = c['duration']
N = int(DUR * SR)
t = np.arange(N) / SR


def load(path, af=None):
    cmd = ['ffmpeg', '-v', 'error', '-i', path]
    if af:
        cmd += ['-af', af]
    cmd += ['-f', 'f32le', '-ac', '2', '-ar', str(SR), '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


sfx_bus = np.zeros((N, 2), dtype=np.float32)
SOFT = 'highpass=f=140,lowpass=f=13000'


def put(path, at, db, af=SOFT):
    sig = load(path, af)
    i = int(at * SR)
    if i >= N:
        return
    j = min(N, i + len(sig))
    sfx_bus[i:j] += sig[: j - i] * (10 ** (db / 20))


L, P = 'public/link/sfx', 'public/private/sfx'
put(f'{P}/hush.mp3', c['focusOut'][0] - 0.1, -17)
put(f'{L}/tap.mp3', c['switchTap'] - 0.02, -22)
put(f'{P}/lock.mp3', c['switchOn'] - 0.03, -13)
for k in ('lift1', 'lift2', 'lift3', 'lift4', 'lift5'):
    put(f'{P}/lift.mp3', c[k][0] - 0.05, -19)
put(f'{L}/slide.mp3', c['slide'][0] - 0.05, -19)
put(f'{L}/land.mp3', c['ada'][-1][0] - 0.05, -19)
put(f'{P}/hush.mp3', c['payoff'] - 0.15, -20)
put(f'{L}/land.mp3', c['samIn'][1] - 0.2, -19)
put(f'{L}/tap.mp3', c['payTap'] - 0.02, -22)
put(f'{L}/tap.mp3', c['sam'][4][0] - 0.02, -27)
put(f'{L}/success.mp3', c['sam'][-1][0] - 0.08, -11)
put(f'{L}/logo.mp3', c['mark'] - 0.08, -13, af='lowpass=f=12000')

music = load(f'public/private/score-{variant}.mp3')[:N]
score = np.zeros((N, 2), dtype=np.float32)
score[: len(music)] = music
duck = np.ones(N)
for at, depth in [(c['switchOn'], 0.2), (c['sam'][-1][0], 0.22), (c['mark'], 0.15)]:
    duck -= depth * np.exp(-((t - at - 0.35) ** 2) / 0.25)
duck *= np.clip(t / 0.08, 0, 1) * np.clip((DUR - t) / 0.8, 0, 1)
bus = score * duck[:, None] + sfx_bus

raw = f'public/private/sound-{variant}-raw.wav'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', raw], input=np.clip(bus, -1, 1).astype(np.float32).tobytes(), check=True)
stats = subprocess.run(['ffmpeg', '-i', raw, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
lufs = float([l for l in stats.splitlines() if l.strip().startswith('I:')][-1].split()[1])
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', f'volume={-14 - lufs}dB,alimiter=limit=0.84:attack=3:release=60:level=false', '-ar', str(SR), f'public/private/sound-{variant}.wav'], check=True)
subprocess.run(['rm', raw])
print(f'{variant}: raw {lufs:.1f} LUFS -> -14')
