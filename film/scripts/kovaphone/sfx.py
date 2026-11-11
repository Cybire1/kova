"""Synthesised effects for KovaPhoneFilm (nothing licensed): python3 sfx.py <out_dir>
dtmf.wav   *384*53916# as real keypad tones, 75 ms each with 45 ms gaps
sms.wav    a soft two-note text chime
buzz.wav   two short phone vibrations"""
import sys, numpy as np
from scipy.io import wavfile
SR = 48000
out = sys.argv[1]
def save(name, x):
    x = x / max(1e-9, np.max(np.abs(x))) * 0.8
    wavfile.write(f'{out}/{name}.wav', SR, (np.stack([x, x], 1) * 32767).astype(np.int16))
ROW = {'1': 697, '2': 697, '3': 697, '4': 770, '5': 770, '6': 770, '7': 852, '8': 852, '9': 852, '*': 941, '0': 941, '#': 941}
COL = {'1': 1209, '4': 1209, '7': 1209, '*': 1209, '2': 1336, '5': 1336, '8': 1336, '0': 1336, '3': 1477, '6': 1477, '9': 1477, '#': 1477}
tone, gap = int(0.075 * SR), int(0.045 * SR)
parts = []
for k in '*384*53916#':
    t = np.arange(tone) / SR
    env = np.minimum(1, np.minimum(t / 0.004, (tone / SR - t) / 0.006))
    parts += [(np.sin(2 * np.pi * ROW[k] * t) + np.sin(2 * np.pi * COL[k] * t)) * env * 0.5, np.zeros(gap)]
save('dtmf', np.concatenate(parts))
def bell(f, dur, amp):
    t = np.arange(int(dur * SR)) / SR
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (d)) for r, a, d in ((1, 1, 0.35), (2.0, 0.25, 0.18), (3.0, 0.08, 0.1)))
    return x * np.minimum(1, t / 0.003) * amp
a, b = bell(1318.5, 0.6, 1.0), bell(1760.0, 0.8, 0.9)
x = np.zeros(int(1.0 * SR)); x[:len(a)] += a; x[int(0.13 * SR):int(0.13 * SR) + len(b)] += b
save('sms', x)
t = np.arange(int(0.22 * SR)) / SR
pulse = (np.sin(2 * np.pi * 150 * t) * 0.7 + np.sin(2 * np.pi * 300 * t) * 0.3) * np.minimum(1, np.minimum(t / 0.01, (0.22 - t) / 0.03)) * (1 + 0.3 * np.sin(2 * np.pi * 23 * t))
save('buzz', np.concatenate([pulse, np.zeros(int(0.12 * SR)), pulse]))
print('dtmf sms buzz written')
