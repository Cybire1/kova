"""Score for "Kova on the wall" (12 s): python3 scripts/wall/score.py -> public/wall/score.wav
Synthesised (numpy), nothing licensed. A warm pad that breathes, a swell into each transformation
(the melt at 2.2 s, the flow at 8.2 s) peaking on the move, soft bells as the payment lands (3.1 s)
and as the name forms (9.1 s), one low thump under the name. Quiet everywhere else."""
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR, DUR = 48000, 12.0
n = int(SR * DUR)
t = np.arange(n) / SR
rng = np.random.default_rng(7)

def env(a, d, s_end, r, total=DUR):
    e = np.ones(n)
    e[t < a] = t[t < a] / a
    rel = t > total - r
    e[rel] *= np.clip((total - t[rel]) / r, 0, 1)
    return e

def lp(x, f):
    return sosfilt(butter(2, f, 'low', fs=SR, output='sos'), x)

def bp(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)

# pad: D major 9, three detuned voices per note, slow breathing
notes = [73.42, 146.83, 220.0, 329.63, 369.99, 554.37]
pad = np.zeros(n)
for i, f in enumerate(notes):
    for d in (-0.18, 0.0, 0.21):
        ph = rng.uniform(0, 2 * np.pi)
        pad += np.sin(2 * np.pi * (f + d) * t + ph) + 0.25 * np.sin(2 * np.pi * 2 * (f + d) * t + ph)
pad = lp(pad, 1800) / 18
breathe = 0.85 + 0.15 * np.sin(2 * np.pi * 0.25 * t)
lift = 1 + 0.6 * np.exp(-((t - 2.4) / 0.7) ** 2) + 0.6 * np.exp(-((t - 8.4) / 0.7) ** 2) + 0.4 * (t > 9.1) * np.exp(-(t - 9.1) / 2.5)
pad *= env(1.0, 0, 0, 1.6) * breathe * lift

# swells: filtered noise rising into the move, peaking on it
def swell(peak, length=1.0):
    k = np.clip((t - (peak - length)) / length, 0, 1) ** 2.2
    k[t > peak] = np.exp(-(t[t > peak] - peak) / 0.25)
    noise = rng.standard_normal(n)
    return bp(noise, 500, 6000) * k * 0.09

sw = swell(2.25) + swell(8.25)

# bells: inharmonic partials, soft attack, long decay
def bell(at, f, amp):
    x = np.zeros(n)
    m = t >= at
    tt = t[m] - at
    for ratio, a, dec in ((1.0, 1.0, 1.6), (2.76, 0.35, 0.8), (5.4, 0.12, 0.4)):
        x[m] += a * np.sin(2 * np.pi * f * ratio * tt) * np.exp(-tt / dec)
    x[m] *= np.clip(tt / 0.004, 0, 1)
    return x * amp

bells = bell(3.1, 880.0, 0.10) + bell(3.22, 1318.5, 0.06)
bells += bell(9.1, 587.33, 0.10) + bell(9.2, 739.99, 0.08) + bell(9.3, 880.0, 0.07)

# thump under the name
m = t >= 9.08
tt = t[m] - 9.08
thump = np.zeros(n)
thump[m] = np.sin(2 * np.pi * (52 + 40 * np.exp(-tt / 0.03)) * tt) * np.exp(-tt / 0.22) * 0.35

mix = pad + sw + bells + thump
mix = np.tanh(mix * 1.2) / 1.2
st = np.stack([mix * 0.98, np.roll(mix, 24) * 1.0], axis=1)  # a touch of width
st /= np.max(np.abs(st)) / 0.7
wavfile.write('public/wall/score.wav', SR, (st * 32767).astype(np.int16))
print('public/wall/score.wav', DUR, 's')
