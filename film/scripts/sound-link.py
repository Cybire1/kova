#!/usr/bin/env python3
"""Sound for "Send by link" (LinkFilm): the score leads, and a few effects land on the real moments
(the slide, the flight, the message, Face ID, "It's yours"). Cues: src/link/link-cues.json.
Mastered to -14 LUFS with one fixed gain and a peak limiter. Writes public/link/sound.wav.
"""
import json
import subprocess

import numpy as np

SR = 48000
c = json.load(open('src/link/link-cues.json'))
DUR = c['duration']
N = int(DUR * SR)


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


bus = np.zeros((N, 2), dtype=np.float32)
t = np.arange(N) / SR


def put(path, at, gain=1.0, seconds=None):
    sig = load(path)
    if seconds:
        sig = sig[: int(seconds * SR)]
        f = min(len(sig), int(0.06 * SR))
        sig[-f:] *= np.linspace(1, 0, f)[:, None]
    i = int(at * SR)
    if i >= N:
        return
    j = min(N, i + len(sig))
    bus[i:j] += sig[: j - i] * gain


spot = lambda n: f'public/spot/sfx/{n}.mp3'
queue = lambda n: f'public/queue/sfx/{n}.mp3'
put(spot('whoosh'), c['slide'][0], 0.25, seconds=0.7)
put(spot('tick'), c['ada'][1][0], 0.45)
put(spot('pop'), c['ada'][3][0], 0.45)
put(spot('tick'), c['shareTap'], 0.5)
put(spot('whoosh'), c['flight'][0], 0.6)
put(spot('pop'), c['flight'][1], 0.55)
put(queue('blip'), c['banner'] + 0.05, 0.45)
put(spot('tick'), c['bannerTap'], 0.5)
put(spot('tick'), c['faceTap'], 0.45)
put(spot('type'), c['lucia'][2][0], 0.35, seconds=0.55)
put(spot('tick'), c['makeTap'], 0.45)
put(spot('faceid'), c['faceid'][0] + 0.5, 0.7)
put(spot('whoosh'), c['lucia'][9][0], 0.22, seconds=0.6)
put(spot('ready'), c['done'] - 0.05, 0.75)
put(spot('sparkle'), c['done'] + 0.1, 0.35)
put(spot('whoosh'), c['end'], 0.3, seconds=0.6)
put(spot('thud'), c['mark'] - 0.05, 0.5)

music = load('public/link/music.mp3')[:N]
score = np.zeros((N, 2), dtype=np.float32)
score[: len(music)] = music
duck = np.ones(N)
for at in [c['faceid'][0] + 0.5, c['done']]:
    duck -= 0.22 * np.exp(-((t - at - 0.3) ** 2) / 0.2)
duck *= np.clip(t / 0.15, 0, 1) * np.clip((DUR - t) / 0.7, 0, 1)
bus += score * (0.85 * duck)[:, None]

raw = 'public/link/sound-raw.wav'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', raw], input=np.clip(bus, -1, 1).astype(np.float32).tobytes(), check=True)
stats = subprocess.run(['ffmpeg', '-i', raw, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
lufs = float([l for l in stats.splitlines() if l.strip().startswith('I:')][-1].split()[1])
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', f'volume={-14 - lufs}dB,alimiter=limit=0.84:level=false', '-ar', str(SR), 'public/link/sound.wav'], check=True)
subprocess.run(['rm', raw])
print(f'raw {lufs:.1f} LUFS -> -14')
