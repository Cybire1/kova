"""The score and effects for the Kova for Chrome announcement, synthesised: python3 scripts/chrome/score.py
Writes public/chrome/mix.wav (48 kHz stereo). 100 BPM: a feature every five beats from 2.4 s, as in
src/chrome/Film.tsx."""
import numpy as np, wave, subprocess, os
SR, DUR = 48000, 25.4
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(4)
f = lambda n: 440 * 2 ** ((n - 69) / 12)

def put(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N: return
    sig = sig[: N - i] * gain
    L[i:i + len(sig)] += sig * np.sqrt((1 - pan) / 2)
    R[i:i + len(sig)] += sig * np.sqrt((1 + pan) / 2)

def env(n, a, d):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)

def pluck(note, dur=1.2, bright=0.5):
    n = int(dur * SR); t = np.arange(n) / SR; w = 2 * np.pi * f(note) * t
    s = np.sin(w) + bright * 0.5 * np.sin(2 * w) * np.exp(-t * 6) + bright * 0.25 * np.sin(3 * w) * np.exp(-t * 10)
    return s * env(n, 0.004, dur / 4)

def pad(notes, dur):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for k, note in enumerate(notes):
        for det in (-0.06, 0.07):
            s += np.sin(2 * np.pi * f(note + det) * t + k) + 0.3 * np.sin(4 * np.pi * f(note + det) * t)
    e = np.minimum(1, t / 0.9) * np.minimum(1, (dur - t) / 1.2)
    return s / len(notes) * e * 0.5

def kick(g=1.0):
    n = int(0.32 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * (48 * t + 60 * (1 - np.exp(-t * 28)) / 28)) * np.exp(-t * 11) * g

def tick(hz=5200, d=0.02):
    n = int(0.09 * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n); x = x - np.concatenate(([0], x[:-1]))
    return (x * 0.6 + np.sin(2 * np.pi * hz * t) * 0.4) * np.exp(-t / d)

def noise(dur, lo, hi, shape):
    n = int(dur * SR); x = rng.standard_normal(n)
    X = np.fft.rfft(x); fr = np.fft.rfftfreq(n, 1 / SR); X[(fr < lo) | (fr > hi)] = 0
    return np.fft.irfft(X, n) * shape(np.arange(n) / n)

whoosh = lambda d: noise(d, 400, 7000, lambda p: np.sin(np.pi * p) ** 2 * (0.3 + p))
n = int(1.2 * SR); tt = np.arange(n) / SR
thud = np.sin(2 * np.pi * (40 * tt + 50 * (1 - np.exp(-tt * 18)) / 18)) * np.exp(-tt * 3.2)
CH = [[48, 60, 64, 67], [45, 57, 60, 64], [41, 53, 57, 60], [43, 55, 59, 62]]
# the name: three notes and a chord
put(pad([48, 60, 64, 67, 74], 2.6), 0.0, 0.17)
for at, n_ in ((0.1, 72), (0.3, 79), (1.0, 84)): put(pluck(n_, 1.6), at, 0.3, -0.2)
# five features, five beats each at 100 BPM; a new chord, a rise and a note for each, a tick for its tap
for i in range(5):
    at = 2.4 + i * 3.0
    ch = CH[i % 4]
    put(pad(ch + [ch[1] + 14], 3.2), at - 0.1, 0.15)
    put(whoosh(0.6), at - 0.15, 0.08); put(pluck(ch[3] + 12, 1.2, 0.9), at + 0.05, 0.3, 0.3)
    for k in range(5):
        b = at + k * 0.6
        put(kick(), b, 0.44); put(tick(7600, 0.012), b + 0.3, 0.11, 0.5)
        put(pluck(ch[0], 0.5, 0.2), b, 0.28); put(pluck(ch[1 + (k % 3)] + 12, 0.5, 0.7), b + 0.3, 0.1, -0.4)
    if i == 3: put(thud, at + 1.3, 0.7)
    else: put(tick(1700, 0.035), at + 1.75, 0.75, 0.3); put(pluck(ch[2] + 24, 0.8, 0.8), at + 1.82, 0.2, 0.4)
# three more, in words: the beat steps back, one hit a line
put(pad([45, 57, 60, 64, 71], 3.2), 17.3, 0.16)
for k, n_ in enumerate((57, 60, 64)):
    put(kick(), 17.5 + k * 0.75, 0.6); put(pluck(n_, 1.4, 1.0), 17.5 + k * 0.75, 0.42); put(pluck(n_ + 12, 1.0, 0.6), 17.5 + k * 0.75, 0.2, 0.3)
# the end
put(whoosh(0.9), 20.2, 0.1)
put(pad([48, 55, 64, 72, 76], 4.8), 20.3, 0.2)
for b in np.arange(20.8, 23.21, 0.6):
    put(kick(), b, 0.42); put(tick(7600, 0.012), b + 0.3, 0.11, -0.5)
    put(pluck([72, 76, 79, 84][int(round((b - 20.8) / 0.6)) % 4], 0.8, 0.8), b + 0.3, 0.15, 0.3)
    put(pluck(48, 0.5, 0.2), b, 0.28)
for k in range(15): put(tick(3200, 0.01), 21.9 + k * 0.08, 0.16, 0.2)
put(tick(1700, 0.035), 23.98, 0.75, 0.3)
for n_ in (48, 60, 64, 67, 72): put(pluck(n_, 3.0, 0.5), 24.0, 0.2)

m = np.stack([L, R], 1)
fade = np.minimum(1, (DUR - np.arange(N) / SR) / 1.2)[:, None]
m = np.tanh(m * 1.5) * fade
m = m / np.abs(m).max() * 0.89
out = os.path.join(os.path.dirname(__file__), '../../public/chrome')
with wave.open(f'{out}/raw.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((m * 32767).astype('<i2').tobytes())
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', f'{out}/raw.wav', '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11', '-ar', '48000', f'{out}/mix.wav'], check=True)
os.remove(f'{out}/raw.wav')
