#!/usr/bin/env python3
"""Sound for "Send by link" (LinkFilm): the score carries the film; a handful of subtle effects
(public/link/sfx, ElevenLabs at 192 kbps) mark the real moments: the slide, the envelope's flight,
the message landing, Face ID, "It's yours" and the logo. Effects are high-passed and softened so
they sit inside the music, and the music dips a little under the two big moments.
Mastered to -14 LUFS with one fixed gain and a peak limiter.

Usage: python3 scripts/sound-link.py <score variant, e.g. d>   -> public/link/sound-<variant>.wav
"""
import json
import subprocess
import sys

import numpy as np

SR = 48000
variant = sys.argv[1] if len(sys.argv) > 1 else 'd'
c = json.load(open('src/link/link-cues.json'))
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


def put(name, at, db, af=SOFT, seconds=None):
    sig = load(f'public/link/sfx/{name}.mp3', af)
    if seconds:
        sig = sig[: int(seconds * SR)]
        f = min(len(sig), int(0.08 * SR))
        sig[-f:] *= np.linspace(1, 0, f)[:, None]
    i = int(at * SR)
    if i >= N:
        return
    j = min(N, i + len(sig))
    sfx_bus[i:j] += sig[: j - i] * (10 ** (db / 20))


put('slide', c['slide'][0] - 0.05, -20)
put('tap', c['shareTap'] - 0.02, -24)
put('swoosh', c['flight'][0] - 0.05, -15)
put('land', c['banner'] - 0.05, -18)
put('tap', c['bannerTap'] - 0.02, -24)
put('tap', c['faceTap'] - 0.02, -24)
put('tap', c['makeTap'] - 0.02, -24)
put('faceid', c['faceid'][0] + 0.5, -17)
put('success', c['done'] - 0.08, -11)
put('logo', c['mark'] - 0.08, -13, af='lowpass=f=12000')

music = load(f'public/link/score-{variant}.mp3')[:N]
score = np.zeros((N, 2), dtype=np.float32)
score[: len(music)] = music
duck = np.ones(N)
for at, depth in [(c['faceid'][0] + 0.5, 0.18), (c['done'], 0.25), (c['mark'], 0.15)]:
    duck -= depth * np.exp(-((t - at - 0.35) ** 2) / 0.25)
duck *= np.clip(t / 0.08, 0, 1) * np.clip((DUR - t) / 0.6, 0, 1)
bus = score * duck[:, None] + sfx_bus

raw = f'public/link/sound-{variant}-raw.wav'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', raw], input=np.clip(bus, -1, 1).astype(np.float32).tobytes(), check=True)
stats = subprocess.run(['ffmpeg', '-i', raw, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
lufs = float([l for l in stats.splitlines() if l.strip().startswith('I:')][-1].split()[1])
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', f'volume={-14 - lufs}dB,alimiter=limit=0.84:attack=3:release=60:level=false', '-ar', str(SR), f'public/link/sound-{variant}.wav'], check=True)
subprocess.run(['rm', raw])
print(f'{variant}: raw {lufs:.1f} LUFS -> -14')
