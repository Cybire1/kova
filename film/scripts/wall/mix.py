"""Sound for "Kova on the wall" (12 s): python3 scripts/wall/mix.py -> public/wall/score.wav
The groove is ElevenLabs Music (public/wall/music/a.mp3, 120 BPM, beats every 0.5 s from 0.56 s).
The structure is sound design on top of it, every event on the grid the picture uses:
  0–2.06  the groove behind a closed filter that opens, a riser into the drop
  2.06    the drop: filter wide open, an impact, a whoosh as the letters melt
  3.06    the payment lands: a soft hit, the count-up ticks, then one tick per figure on the beat
  5.06    Kovi pops up on the frame
  7.56    the filter closes, the groove sinks; a riser pulls into the flow at 8.06
  9.06    the final hit under the name is the track's own ending (its hit at 8.06 s, moved two beats
          later by repeating the bar 6.56–7.56 s, a seamless loop on the grid), ringing out in its key
"""
import numpy as np, librosa
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR, DUR = 48000, 12.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(11)

def load(path, mono=False):
    y, _ = librosa.load(path, sr=SR, mono=mono)
    if y.ndim == 1:
        y = np.stack([y, y])
    return y

def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x, axis=-1)

def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x, axis=-1)

def place(buf, clip, at, gain=1.0):
    i = int(at * SR)
    if i >= N:
        return
    if i < 0:
        clip = clip[:, -i:]
        i = 0
    n = min(clip.shape[1], N - i)
    buf[:, i:i + n] += clip[:, :n] * gain

def ramp(a, b, x):
    return np.clip((x - a) / (b - a), 0, 1)

out = np.zeros((2, N))

# ── the groove ──────────────────────────────────────────────────────────────────────────────
src = load('public/wall/music/a.mp3')
# two beats repeated at 7.56 s: everything after moves 1.0 s later, so the track's own final hit
# (8.06 s) lands on the picture's (9.06 s). Both cut points sit on the beat; a 10 ms crossfade.
cut, back_to = int(7.56 * SR), int(6.56 * SR)
xf = int(0.01 * SR)
head = src[:, :cut]
tail = src[:, back_to:]
ramp_in = np.linspace(0, 1, xf)
tail[:, :xf] = tail[:, :xf] * ramp_in + src[:, cut:cut + xf] * (1 - ramp_in)
music = np.concatenate([head, tail], axis=1)[:, :N]
music = np.pad(music, ((0, 0), (0, N - music.shape[1])))
closed = lp(music, 320, 4)
# open: 0 → 1 across the intro (closed filter opening), shut again 7.56 → 8.06
openness = ramp(0.2, 2.06, t) ** 2.4
openness = np.where(t >= 7.56, 1 - ramp(7.56, 8.2, t) + ramp(8.6, 9.06, t), openness)
openness = np.clip(openness, 0, 1)
groove = music * openness + closed * (1 - openness)
level = np.ones(N) * 0.95
level *= 0.55 + 0.45 * ramp(0, 2.06, t)  # the intro sits lower
dip = 0.65 * ramp(7.56, 8.3, t) * (1 - ramp(8.7, 9.06, t))  # sinks into the breath, rises to the hit
level = np.where(t >= 7.56, level * (1 - dip), level)
level *= 1 - ramp(11.6, 12.0, t)  # the ring-out closes with the picture
out += groove * level

# ── risers: noise swept upward, peaking on the hit ────────────────────────────────────────
def riser(peak, length, gain):
    n = int(length * SR)
    x = rng.standard_normal(n)
    y = np.zeros(n)
    blocks = 48
    for b in range(blocks):
        a, z = b * n // blocks, (b + 1) * n // blocks
        f = 300 * (40 ** (b / blocks))
        y[a:z] = sosfilt(butter(2, [f, min(f * 2.2, 20000)], 'band', fs=SR, output='sos'), x[a:z])
    y *= np.linspace(0, 1, n) ** 2.5
    place(out, np.stack([y, np.roll(y, 60)]), peak - length, gain)

riser(2.06, 1.4, 0.10)
riser(9.06, 1.0, 0.13)

# ── impacts ───────────────────────────────────────────────────────────────────────────────
def impact(at, size):
    n = int(2.2 * SR)
    tt = np.arange(n) / SR
    sub = np.sin(2 * np.pi * (38 + 45 * np.exp(-tt / 0.05)) * tt) * np.exp(-tt / (0.35 * size))
    noise = hp(rng.standard_normal(n), 1800) * np.exp(-tt / (0.25 * size)) * 0.35
    body = lp(rng.standard_normal(n), 900) * np.exp(-tt / 0.06) * 0.6
    x = sub * 0.9 + noise + body
    x[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    place(out, np.stack([x, np.roll(x, 90)]), at, 0.42 * size)

impact(2.06, 1.0)
impact(3.06, 0.45)
impact(9.06, 0.8)  # weight under the track's own hit, no pitch of its own

# ── foley on the picture's moves ──────────────────────────────────────────────────────────
whoosh = load('public/audio/sfx/whoosh-real.wav')
swish = load('public/audio/sfx/swish.mp3')
pop = load('public/audio/sfx/pop.mp3')
card = [load(f'public/audio/kenney/card-place-{i}.ogg') for i in (1, 2, 3)]
sparkle = load('public/audio/sfx/sparkle.mp3')

place(out, lp(whoosh, 6000), 2.06 - 0.078, 0.55)          # the letters melt
for k in range(8):                                         # the count-up, ticking down in level
    n = int(0.012 * SR)
    tick = np.sin(2 * np.pi * 2600 * np.arange(n) / SR) * np.exp(-np.arange(n) / (0.003 * SR))
    place(out, np.stack([tick, tick]), 3.19 + k * 0.067, 0.10 * (1 - k / 10))
for i, at in enumerate((3.56, 4.06, 4.56)):                # one figure per beat
    place(out, hp(card[i], 400), at - 0.159, 0.32)
place(out, pop, 5.06 - 0.073, 0.42)                        # Kovi on the frame
place(out, sparkle, 5.06 - 0.141, 0.6)
place(out, swish * 4, 8.06 - 0.115, 0.5)                   # the frame lets go
place(out, pop, 9.56 - 0.073, 0.32)                        # Kovi beside the name

# ── finish: gentle glue, true-peak headroom; loudness is set in render.sh ──────────────────
out = np.tanh(out * 1.1) / 1.1
out /= np.max(np.abs(out)) / 0.8
wavfile.write('public/wall/score.wav', SR, (out.T * 32767).astype(np.int16))
print('public/wall/score.wav', DUR, 's')
