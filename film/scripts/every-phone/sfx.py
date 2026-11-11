"""
The sound of "Dollars for every phone" (src/every-phone), made for it rather than borrowed.

One family of sounds, all synthesised here and tuned to the score (kovaphone/music-a: its strongest
notes are D, E, F#, A and B, the D major / B minor pentatonic), placed on the frame of the thing they
belong to (frames from src/every-phone/Film.tsx; CUT values match its CUT):

  Kovi        soft mallet notes that climb as he crosses the phones, a puff of air when he lands
  movement    filtered air: up for a lift, down for a dive, long and low for the flight
  paper       cards, the sealed note, panels: a short paper flick
  proof       a felt thump when the note lands on Monad's announcement; glass pings for arrivals
  the phone   Grandma's: a real vibration, a two-note text tone, true DTMF tones under every key
  the end     a warm D major swell under the end card, and a bell chord on the logo

Writes public/every-phone/sfx.wav (stereo, 48 kHz, 56 s).
Run: python3 scripts/every-phone/sfx.py
"""

import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

SR = 48_000
FPS = 30
DUR = 56.0
N = int(SR * DUR)
OUT = Path(__file__).resolve().parents[2] / "public/every-phone/sfx.wav"
rng = np.random.default_rng(2026)

L = np.zeros(N)
R = np.zeros(N)

# Notes of the D major / B minor pentatonic, in Hz.
NOTE = {
    "D4": 293.66, "E4": 329.63, "F#4": 369.99, "A4": 440.00, "B4": 493.88,
    "D5": 587.33, "E5": 659.26, "F#5": 739.99, "A5": 880.00, "B5": 987.77,
    "D6": 1174.66, "E6": 1318.51, "F#6": 1479.98, "A6": 1760.00, "B6": 1975.53, "D7": 2349.32,
}


def t_(dur):
    return np.arange(int(dur * SR)) / SR


# The score is quiet until 18.2 s and full until about 48.7 s: there, sounds need 5 dB more to be heard.
LOUD = (547, 1460)


def place(sig, frame, gain=1.0, pan=0.0):
    """Adds a sound at a film frame. Equal-power pan, -1 left to 1 right; centre is unity."""
    if LOUD[0] <= frame < LOUD[1]:
        gain *= 10 ** (5 / 20)
    i = int(round(frame / FPS * SR))
    if i >= N or i + len(sig) <= 0:
        return
    s = sig[: N - i] * gain
    a = (pan + 1) * np.pi / 4
    L[i : i + len(s)] += s * np.cos(a) * np.sqrt(2)
    R[i : i + len(s)] += s * np.sin(a) * np.sqrt(2)


def norm(x):
    p = np.max(np.abs(x))
    return x / p if p > 0 else x


def lowpass(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x)


def highpass(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def fades(x, a=0.002, r=0.004):
    n = len(x)
    ia, ir = max(1, int(a * SR)), max(1, int(r * SR))
    env = np.ones(n)
    env[:ia] = np.linspace(0, 1, ia)
    env[-ir:] = np.minimum(env[-ir:], np.linspace(1, 0, ir))
    return x * env


# ── the palette ────────────────────────────────────────────────────────────────────────────────


def mallet(f, dur=1.1, bright=1.0):
    """A felt mallet on a wooden bar: marimba-like partials (1 : 3.93 : 9.5), a soft felt click."""
    t = t_(dur)
    x = np.zeros_like(t)
    for ratio, amp, tau in ((1.0, 1.0, 0.42), (3.932, 0.30 * bright, 0.11), (9.54, 0.08 * bright, 0.035)):
        x += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / tau)
    x *= 1 - np.exp(-t / 0.0025)
    click = lowpass(rng.standard_normal(len(t)), 2400) * np.exp(-t / 0.004) * 0.12
    return fades(norm(x + click), 0.001, 0.05)


def glass(f, dur=1.6):
    """A small glass or bell ping: slightly inharmonic, a long soft tail."""
    t = t_(dur)
    x = np.zeros_like(t)
    for ratio, amp, tau in ((1.0, 1.0, 0.75), (2.756, 0.22, 0.28), (5.404, 0.07, 0.12), (1.002, 0.35, 0.9)):
        x += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / tau)
    x *= 1 - np.exp(-t / 0.0015)
    return fades(norm(x), 0.001, 0.08)


def air(dur, f0, f1, shape=0.6):
    """Moving air: noise through a band that sweeps from f0 to f1; rises for `shape` of its length."""
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    block = 256
    zi = None
    for s in range(0, n, block):
        p = s / n
        fc = f0 * (f1 / f0) ** p
        b, a = butter(2, [fc / 1.6, min(fc * 1.6, SR / 2 - 100)], "band", fs=SR)
        if zi is None:
            zi = np.zeros(max(len(a), len(b)) - 1)
        seg, zi = lfilter(b, a, noise[s : s + block], zi=zi)
        out[s : s + block] = seg
    u = np.linspace(0, 1, n)
    env = np.where(u < shape, np.sin(u / shape * np.pi / 2) ** 2, np.cos((u - shape) / (1 - shape) * np.pi / 2) ** 2)
    return norm(out * env)


def tick():
    """A small tactile tick: a soft click with a hint of pitch."""
    t = t_(0.05)
    x = bandpass(rng.standard_normal(len(t)), 2500, 6000) * np.exp(-t / 0.0025)
    x += 0.5 * np.sin(2 * np.pi * 1600 * t) * np.exp(-t / 0.004)
    return fades(norm(x), 0.0005, 0.01)


def paper():
    """A paper card landing or a sheet flicked: two short bright bursts."""
    t = t_(0.14)
    burst = highpass(rng.standard_normal(len(t)), 1800) * np.exp(-t / 0.014)
    x = burst.copy()
    k = int(0.032 * SR)
    x[k:] += 0.55 * burst[: len(x) - k]
    x += 0.25 * lowpass(rng.standard_normal(len(t)), 900) * np.exp(-t / 0.02)
    return fades(norm(x), 0.0005, 0.02)


def thump():
    """A felt stamp: a low note that drops, with a muted click."""
    t = t_(0.4)
    f = 95 * np.exp(-t / 0.25) + 52
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.13)
    x += 0.35 * lowpass(rng.standard_normal(len(t)), 1200) * np.exp(-t / 0.006)
    return fades(norm(x), 0.001, 0.05)


def puff():
    """Air pushed out when Kovi lands."""
    t = t_(0.18)
    return fades(norm(lowpass(rng.standard_normal(len(t)), 500) * np.exp(-t / 0.045)), 0.001, 0.03)


def digital(f=1850, dur=0.035):
    """An old phone's screen beep: a filtered square."""
    t = t_(dur)
    return fades(norm(lowpass(np.sign(np.sin(2 * np.pi * f * t)), 5000)), 0.002, 0.006)


DTMF = {
    "1": (697, 1209), "2": (697, 1336), "3": (697, 1477),
    "4": (770, 1209), "5": (770, 1336), "6": (770, 1477),
    "7": (852, 1209), "8": (852, 1336), "9": (852, 1477),
    "*": (941, 1209), "0": (941, 1336), "#": (941, 1477),
}


def dtmf(key, dur=0.075):
    """The true tone pair a phone keypad plays for a key."""
    t = t_(dur)
    lo, hi = DTMF[key]
    return fades(0.5 * np.sin(2 * np.pi * lo * t) + 0.5 * np.sin(2 * np.pi * hi * t), 0.003, 0.006)


def buzz():
    """A phone's vibration motor, twice: a low rattle that buzzes rather than beeps."""
    pulse = t_(0.2)
    carrier = 2 * ((165 * pulse) % 1) - 1
    one = lowpass(carrier, 700) + 0.6 * np.sin(2 * np.pi * 82.5 * pulse)
    one *= 0.85 + 0.15 * np.sin(2 * np.pi * 31 * pulse)
    one += 0.15 * bandpass(rng.standard_normal(len(pulse)), 1500, 3500) * (0.5 + 0.5 * np.sin(2 * np.pi * 165 * pulse))
    one = fades(one, 0.012, 0.02)
    gap = np.zeros(int(0.07 * SR))
    return norm(np.concatenate([one, gap, one]))


def text_tone():
    """A text arriving: two soft retro beeps, B5 then F#6."""
    a = digital(NOTE["B5"], 0.09)
    b = digital(NOTE["F#6"], 0.13)
    return norm(np.concatenate([a, np.zeros(int(0.045 * SR)), b]))


def shimmer(notes=("D6", "F#6", "A6", "D7"), step=0.04):
    """A quick climb of glass: something turning, or being opened."""
    total = np.zeros(int((len(notes) * step + 1.4) * SR))
    for i, n in enumerate(notes):
        g = glass(NOTE[n], 1.3) * (1 - i * 0.12)
        k = int(i * step * SR)
        total[k : k + len(g)] += g
    return norm(highpass(total, 600))


def clink():
    """A coin settling: bright, metallic, short."""
    t = t_(0.5)
    x = np.zeros_like(t)
    for ratio, amp, tau in ((1.0, 1.0, 0.16), (2.43, 0.6, 0.09), (4.11, 0.35, 0.06), (6.32, 0.2, 0.04)):
        x += amp * np.sin(2 * np.pi * 2093 * ratio * t) * np.exp(-t / tau)
    return fades(norm(x), 0.0005, 0.03)


def chord(notes, dur=3.2, stagger=0.014):
    """A bell chord, notes struck a hair apart."""
    total = np.zeros(int((dur + len(notes) * stagger) * SR))
    for i, n in enumerate(notes):
        g = glass(NOTE[n], dur) * (1.0 if i == 0 else 0.7)
        k = int(i * stagger * SR)
        total[k : k + len(g)] += g
    return norm(total)


def pad(dur, notes=("D4", "A4", "D5", "F#5")):
    """A warm swell: detuned soft saws, low-passed, rising and falling slowly."""
    t = t_(dur)
    x = np.zeros_like(t)
    for n in notes:
        for det in (-0.25, 0.0, 0.3):
            f = NOTE[n] * 2 ** (det / 100)
            x += (2 * ((f * t) % 1) - 1) * 0.3
    x = lowpass(x, 1100, 2)
    u = np.linspace(0, 1, len(t))
    env = np.sin(np.minimum(u / 0.35, 1) * np.pi / 2) ** 2 * np.where(u > 0.7, np.cos((u - 0.7) / 0.3 * np.pi / 2) ** 2, 1)
    return norm(x * env)


# ── where they go (frames: src/every-phone/Film.tsx) ───────────────────────────────────────────

CUT = {"ch1": 161, "priv": 370, "off": 649, "gma": 858, "all": 1275, "end": 1484}
dB = lambda d: 10 ** (d / 20)  # noqa: E731

# Hook: Kovi crosses the four phones; each lights up on a rising note.
for frame, note, pan in ((24, "D5", -0.55), (59, "F#5", -0.2), (94, "A5", 0.2), (129, "D6", 0.55)):
    place(mallet(NOTE[note]), frame - 1, dB(-17), pan)
    place(puff(), frame - 1, dB(-30), pan)
for frame, pan in ((36, -0.4), (71, 0.0), (106, 0.4)):
    place(air(0.22, 700, 2200, 0.7), frame - 2, dB(-31), pan)
place(digital(1850, 0.04), 131, dB(-29), 0.55)
place(air(0.85, 500, 2600, 0.55), 128, dB(-25))  # the line lifts into the first phone
place(air(0.38, 2600, 700, 0.3), 140, dB(-29), 0.2)  # Kovi dives
place(glass(NOTE["A6"]), 157, dB(-24), 0.25)

# 01 Your phone
c = CUT["ch1"]
place(tick(), c + 18, dB(-30), 0.4)
place(tick(), c + 48, dB(-24), 0.45)  # the press
place(chord(("D6", "A6"), 1.6, 0.07), c + 65, dB(-19), 0.4)  # paid
place(paper(), c + 73, dB(-28), -0.4)  # the chip
place(air(0.55, 1800, 600, 0.4), c + 100, dB(-28))
place(thump(), c + 108, dB(-18))  # $0.00 lands
place(mallet(NOTE["D4"], 1.6, 0.6), c + 108, dB(-21))
place(air(0.6, 600, 2400, 0.6), CUT["priv"] - 10, dB(-28))

# 02 Private
c = CUT["priv"]
place(tick(), c + 10, dB(-30), -0.5)
place(tick(), c + 27, dB(-24), -0.5)  # the press
place(air(0.2, 900, 2000, 0.6), c + 29, dB(-32), -0.5)
place(glass(NOTE["A5"]), c + 42, dB(-22), -0.5)  # sent
place(paper(), c + 54, dB(-25), 0.3)
place(air(0.45, 800, 2600, 0.6), c + 54, dB(-29), 0.3)  # the address flies out
place(paper(), c + 62, dB(-31), 0.45)
place(paper(), c + 68, dB(-33), 0.55)
for k in range(c + 64, c + 100, 3):  # the next addresses, still being made
    place(tick(), k, dB(-40), 0.5)
place(mallet(NOTE["B5"], 0.8), c + 96, dB(-25), 0.4)  # the note appears
place(air(0.6, 600, 2400, 0.55), c + 104, dB(-28))
place(tick(), c + 134, dB(-28), -0.2)
place(mallet(NOTE["E5"], 0.9, 0.7), c + 134, dB(-27), -0.2)
place(air(0.65, 2600, 900, 0.5), c + 140, dB(-28), 0.2)  # the note flies to Monad
place(thump(), c + 159, dB(-17))  # and lands
place(shimmer(("A5", "D6", "F#6")), c + 160, dB(-29))
place(tick(), c + 162, dB(-30))
place(tick(), c + 174, dB(-30))
place(air(0.55, 500, 2200, 0.6), c + 202, dB(-28))
place(air(0.75, 2400, 800, 0.45), c + 210, dB(-28), -0.4)  # into Sam's phone
place(shimmer(("D6", "F#6", "A6", "D7")), c + 233, dB(-17), -0.4)  # only Sam can open it
place(air(0.6, 600, 2400, 0.6), CUT["off"] - 10, dB(-28))

# 03 No signal
c = CUT["off"]
for k, pan in ((3, -0.4), (6, 0.4), (9, 0.4)):
    place(paper(), c + k, dB(-31), pan)
place(digital(1850, 0.04), c + 52, dB(-30), -0.3)  # the code appears
place(paper(), c + 71, dB(-27), -0.2)
place(air(0.75, 700, 2400, 0.5), c + 71, dB(-28))  # the code travels
place(mallet(NOTE["F#5"]), c + 92, dB(-23), 0.5)
for i, k in enumerate((129, 132, 135)):  # signal bars come back
    place(digital(1400 + i * 300, 0.03), c + k, dB(-31), -0.4)
place(chord(("A5", "D6"), 1.8, 0.09), c + 140, dB(-19), 0.4)  # settled
place(air(0.6, 600, 2400, 0.6), CUT["gma"] - 10, dB(-28))

# 04 No internet: Grandma
c = CUT["gma"]
place(paper(), c + 12, dB(-30), -0.6)
place(tick(), c + 16, dB(-31), -0.4)
place(tick(), c + 22, dB(-31), 0.4)
place(air(2.4, 500, 1600, 0.5), c + 33, dB(-21))  # the flight
place(mallet(NOTE["D6"]), c + 103, dB(-22), 0.4)  # lands in her village
place(puff(), c + 103, dB(-30), 0.4)
place(air(0.5, 300, 1400, 0.7), c + 133, dB(-26))  # her phone rises
place(mallet(NOTE["A5"]), c + 153, dB(-23), 0.1)  # Kovi on her phone
place(puff(), c + 153, dB(-29), 0.1)
place(air(0.38, 2600, 600, 0.3), c + 161, dB(-26))  # the dive
place(digital(2100, 0.03), c + 171, dB(-27))
place(buzz(), c + 172, dB(-20))  # her phone buzzes
place(text_tone(), c + 175, dB(-24))
for k in range(c + 178, c + 206, 3):  # the text appearing on the LCD
    place(digital(2400, 0.012), k, dB(-42))
place(air(0.6, 1600, 600, 0.4), c + 209, dB(-30))
for i, key in enumerate("*384*53916#"):  # every key, its own tone
    place(dtmf(key), c + 238 + i * 3, dB(-24))
    place(tick(), c + 238 + i * 3, dB(-38))
place(digital(1600, 0.06), c + 272, dB(-30))
for i in range(6):  # the menu prints
    place(digital(1850 + i * 40, 0.015), c + 280 + i * 3, dB(-36))
place(dtmf("5"), c + 300, dB(-22))
place(tick(), c + 300, dB(-32))
place(air(0.6, 600, 2000, 0.5), c + 314, dB(-30))
place(digital(1850, 0.05), c + 326, dB(-30))
place(paper(), c + 346, dB(-30), 0.1)
place(shimmer(("A5", "D6", "F#6", "A6")), c + 355, dB(-19), 0.1)  # dollars turn into naira
place(clink(), c + 369, dB(-22), 0.1)
place(tick(), c + 366, dB(-32), -0.5)
place(air(0.6, 600, 2400, 0.6), CUT["all"] - 10, dB(-28))

# 05 Everything else: five tiles on five rising notes
c = CUT["all"]
for k, note, pan in ((9, "E5", -0.6), (26, "F#5", 0.0), (44, "A5", 0.6), (61, "B5", 0.0), (79, "D6", 0.6)):
    place(mallet(NOTE[note], 0.9, 0.8), c + k, dB(-22), pan)
    place(paper(), c + k, dB(-33), pan)
place(air(0.7, 600, 2400, 0.6), CUT["end"] - 12, dB(-27))

# End: the line again; Kovi hops down on the last chord; the logo rings
c = CUT["end"]
place(pad(6.2), c + 4, dB(-30))
place(tick(), c + 40, dB(-32), 0.55)
place(air(0.25, 700, 2200, 0.7), c + 53, dB(-31), 0.3)
place(mallet(NOTE["D5"], 1.6, 0.6), c + 71, dB(-21))
place(puff(), c + 71, dB(-29))
place(chord(("D5", "F#5", "A5", "D6"), 3.4), c + 74, dB(-19))
place(tick(), c + 82, dB(-32))

# ── write ──────────────────────────────────────────────────────────────────────────────────────

stereo = np.stack([L, R], axis=1)
peak = np.max(np.abs(stereo))
if peak > 0.89:  # keep a little headroom; the mix sets the level
    stereo *= 0.89 / peak
OUT.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(OUT), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes())
print(OUT, f"peak {20 * np.log10(peak + 1e-9):.1f} dBFS")
