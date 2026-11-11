"""The sound of "All of it" (src/day/Film.tsx): a synthesised score and the receipt printer, from the
picture's own timeline (src/day/cues.json). Nothing licensed, no voice.

120 bpm in C major, a chord a bar (2 s): C, Am, F, G. The hook starts on frame one; the groove lifts
at 18 and peaks at 30; the basic phone (40) breathes at half time; a riser and a snare roll climb to
the hit at 46, where the total prints; the full band plays the pull back; one chord rings out under
the end card. The printer chatters one tick a printed character, as the picture prints them.

Mastered with ffmpeg's loudnorm (two pass, linear), then an oversampled limiter: about -14.8 LUFS
integrated and under -1 dBTP after AAC encoding.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from synth import SR, add, band, bass, bell, boing, high, kalimba, low, noise, pad, shaker, snap, thump, ts, whoosh  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CUES = json.loads((ROOT / 'src/day/cues.json').read_text())
RAW = ROOT / 'out/day/mix-raw.wav'
OUT = ROOT / 'public/day/mix.wav'
RAW.parent.mkdir(parents=True, exist_ok=True)

DUR = CUES['duration']
N = int(DUR * SR)
BEAT = 60 / CUES['bpm']
BAR = BEAT * 4
SEC = CUES['sections']
FPS = 30

music = np.zeros((2, N))
fx = np.zeros((2, N))
rng = np.random.default_rng(11)

CHORDS = [(60, 64, 67), (57, 60, 64), (53, 57, 60), (55, 59, 62)]  # C Am F G
ROOTS = [36, 33, 29, 31]


# ── Drums ────────────────────────────────────────────────────────────────────────────────────────

def kick(vel=1.0):
    t = ts(0.42)
    f = 52 + 110 * np.exp(-t / 0.035)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    click = band(noise(0.42, 3), 1500, 6000) * np.exp(-t / 0.004) * 0.5
    return np.tanh((body + click) * 1.6) * vel * 0.55


def clap(seed, vel=1.0):
    out = np.zeros(int(0.3 * SR))
    for k, d in enumerate((0.0, 0.009, 0.018)):
        n = band(noise(0.25, seed + k), 900, 5200) * np.exp(-ts(0.25) / (0.012 if k < 2 else 0.07))
        i = int(d * SR)
        out[i:i + len(n)] += n
    return out * vel * 0.32


def hat(seed, open_=False, vel=1.0):
    d = 0.22 if open_ else 0.05
    t = ts(d)
    return high(noise(d, seed), 7000) * np.exp(-t / (0.07 if open_ else 0.012)) * vel * 0.12


def crash(vel=1.0):
    t = ts(2.4)
    return high(noise(2.4, 77), 4200) * np.exp(-t / 0.75) * vel * 0.16


def pluck(m, vel=1.0):
    """A bright synth pluck: a saw through a closing filter."""
    f, t = 440 * 2 ** ((m - 69) / 12), ts(0.5)
    saw = 2 * ((f * t) % 1) - 1
    saw += 0.5 * (2 * ((f * 1.005 * t) % 1) - 1)
    env = np.exp(-t / 0.13)
    s = low(saw * env, 2600) * np.minimum(1, t / 0.003)
    return s * vel * 0.12


def section(t):
    for name in ('end', 'hit', 'riser', 'breath', 'peak', 'lift', 'groove', 'hook'):
        if t >= SEC[name]:
            return name
    return 'hook'


# ── Music ─────────────────────────────────────────────────────────────────────────────────────────

MELODY = [72, 76, 79, 76, 74, 72, 74, 76]  # the hook line, one note a beat over two bars
bar = 0
t = 0.0
while t < SEC['end']:
    s = section(t)
    chord, root = CHORDS[bar % 4], ROOTS[bar % 4]
    pad_vel = {'hook': 0.32, 'groove': 0.34, 'lift': 0.42, 'peak': 0.5, 'breath': 0.46, 'riser': 0.55, 'hit': 0.6}[s]
    add(music, pad(chord, BAR + 0.3, vel=pad_vel), t)
    for b in range(4):
        at = t + b * BEAT
        st = section(at)
        drums = st in ('hook', 'groove', 'lift', 'peak', 'hit')
        if drums:
            add(music, kick(0.95 if b == 0 else 0.8), at)
        elif st == 'breath' and b == 0:
            add(music, kick(0.7), at)
        if st in ('groove', 'lift', 'peak', 'hit') and b in (1, 3):
            add(music, clap(int(at * 100), 0.9 if st in ('peak', 'hit') else 0.75), at, pan=0.05)
        if drums:
            for e in range(2):
                add(music, hat(int(at * 1000) + e, open_=(e == 1 and st != 'hook'), vel=0.8 if e else 0.6), at + e * BEAT / 2, pan=-0.3)
        if st in ('lift', 'peak', 'hit'):
            for q in range(4):
                add(music, shaker(int(at * 977) + q, vel=0.5 if q % 2 else 0.32), at + q * BEAT / 4, pan=0.35)
        # Bass: eighth notes, root and octave, pumping; half time in the breath.
        if st in ('groove', 'lift', 'peak', 'hit'):
            for e in range(2):
                add(music, bass(root + (12 if e else 0), vel=0.75 if e == 0 else 0.5), at + e * BEAT / 2)
        elif st in ('hook',):
            add(music, bass(root, vel=0.6), at)
        elif st == 'breath' and b in (0, 2):
            add(music, bass(root, vel=0.5), at)
        # The pluck arpeggio, eighths, brighter as it lifts.
        if st in ('hook', 'groove', 'lift', 'peak', 'hit'):
            for e in range(2):
                note = chord[(b * 2 + e) % 3] + (12 if st in ('peak', 'hit') else 0)
                add(music, pluck(note, vel=0.85 if e == 0 else 0.6), at + e * BEAT / 2, pan=0.28 if e else -0.28)
        elif st == 'breath' and b in (0, 2):
            add(music, kalimba(chord[b // 2] + 12, vel=0.45), at, pan=0.2)
        # The hook line, over the peak and the payoff.
        if st in ('peak', 'hit'):
            add(music, kalimba(MELODY[(bar % 2) * 4 + b], vel=0.55), at, pan=-0.15)
    t += BAR
    bar += 1

# The riser into the hit: the drums are gone; a sweep, a snare roll that doubles, the pad swells.
R0, HIT = SEC['riser'], SEC['hit']
add(fx, whoosh(HIT - R0, 180, 6000, 5, peak=0.97, vel=0.55), R0)
for i, (a, b, step) in enumerate([(R0, R0 + 1.0, BEAT / 2), (R0 + 1.0, R0 + 1.5, BEAT / 4), (R0 + 1.5, HIT - 0.02, BEAT / 8)]):
    k = a
    while k < b:
        add(music, snap(int(k * 1000), vel=0.35 + 0.5 * (k - R0) / (HIT - R0)), k, pan=0.1)
        k += step
# The hit: a thump, a crash, a bell on C and the chord wide; the total prints here.
add(music, kick(1.0), HIT)
add(fx, thump(vel=0.9), HIT)
add(fx, crash(1.0), HIT, pan=0.2)
add(fx, bell(523.25, seconds=2.6, vel=0.5), HIT, pan=-0.1)
add(fx, bell(783.99, seconds=2.2, vel=0.3), HIT + 0.02, pan=0.2)

# The end: one chord rings out, a bell as Kovi arrives.
END = SEC['end']
add(music, kick(0.9), END)
add(fx, crash(0.7), END, pan=-0.2)
add(music, pad((48, 60, 64, 67, 72), DUR - END, vel=0.7), END)
add(music, pluck(72, 1.0), END)
add(music, pluck(79, 0.8), END + 0.01)
add(fx, bell(1046.5, seconds=2.6, vel=0.32), END + 0.6)
add(fx, boing(), CUES['end']['kovi'] + 0.45, pan=0.25)
add(fx, whoosh(0.5, 2600, 400, 21, peak=0.4, vel=0.25), END - 0.2)

# ── The printer ───────────────────────────────────────────────────────────────────────────────────

def tick(seed, vel=1.0):
    n = band(noise(0.014, seed), 1700, 5200) * np.exp(-ts(0.014) / 0.0028)
    k = np.sin(2 * np.pi * 380 * ts(0.014)) * np.exp(-ts(0.014) / 0.003) * 0.3
    return (n + k) * vel * 0.3


def feed(seconds=0.26):
    """The paper advancing: a short soft motor whirr."""
    t = ts(seconds)
    motor = np.sin(2 * np.pi * 140 * t + 2 * np.sin(2 * np.pi * 31 * t)) * 0.4 + band(noise(seconds, 9), 300, 1600)
    return motor * np.sin(np.pi * t / seconds) * 0.05


def chatter(at, chars, pan, vel=0.7):
    for i in range(chars):
        add(fx, tick(int(at * 1000) + i, vel * rng.uniform(0.7, 1.0)), at + i / FPS + rng.uniform(-0.003, 0.003), pan=pan)


def pan_of(t):
    """Follows the printer across the frame: left of centre is left."""
    shot = next((s for s in CUES['shots'] if s['at'] <= t < s['to']), CUES['shots'][-1])['id']
    x = {'pay': 1390, 'send': 470, 'private': 450, 'offline': 330, 'link': 1530, 'stocks': 1560, 'card': 450, 'shop': 1390,
         'payroll': 470, 'kovacard': 1530, 'cashout': 330, 'basic': 1560}.get(shot, 960)
    return (x - 960) / 960 * 0.6


for line in CUES['lines']:
    at = line['at']
    label = f"{line['n']}  {line['label']}"
    p = pan_of(at)
    add(fx, feed(), at, pan=p)
    chatter(at, len(label) + len(line['amount']), p)
TA = CUES['total']['at']
add(fx, feed(0.3), TA)
chatter(TA, len('NETWORK FEES'), 0.0, vel=0.8)
chatter(TA + 0.3, len('APPS YOU NEEDED') + 1, 0.0, vel=0.6)
# The tear: paper ripping, fast and dry.
rip_t = ts(0.32)
rip = band(noise(0.32, 41), 1800, 7500) * np.exp(-rip_t / 0.11) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 63 * rip_t)))
add(fx, rip * 0.35, CUES['total']['tear'])

# ── What the phones do ────────────────────────────────────────────────────────────────────────────

def click(seed, vel=1.0):
    n = band(noise(0.02, seed), 2000, 8000) * np.exp(-ts(0.02) / 0.002)
    return n * vel * 0.22


# A soft air move every time the printer glides to its next place, a click on each phone cut.
for shot in [s for s in CUES['shots'] if s['id'] not in ('pay', 'total', 'end')]:
    add(fx, whoosh(0.5, 400, 2400, int(shot['at'] * 10), peak=0.45, vel=0.2), shot['at'] - 0.12, pan=0.0)
for at in (1.93, 2.93, 3.93, 7.0, 7.93, 11.93, 12.2, 15.43, 16.5, 19.43, 22.0, 22.5, 23.0, 28.43, 35.0, 36.0, 37.0):
    add(fx, click(int(at * 100), 0.9), at, pan=0.2)
# The basic phone: the text arrives with a buzz, then the code is dialled (one tone a key).
SMS, DIAL = CUES['basic']['sms'], CUES['basic']['dial']
bz = ts(0.35)
add(fx, np.sign(np.sin(2 * np.pi * 172 * bz)) * low(np.ones_like(bz), 400) * np.exp(-bz / 0.2) * 0.05, SMS)
DTMF = {'*': (941, 1209), '3': (697, 1477), '8': (852, 1336), '4': (770, 1209), '5': (770, 1336), '9': (852, 1477), '1': (697, 1209), '6': (770, 1477), '#': (941, 1477)}
for i, k in enumerate('*384*53916#'):
    a, b = DTMF[k]
    tt = ts(0.06)
    tone = (np.sin(2 * np.pi * a * tt) + np.sin(2 * np.pi * b * tt)) * np.minimum(1, (0.06 - tt) / 0.01)
    add(fx, tone * 0.05, DIAL + i * 0.07, pan=0.0)

# ── Room tone: so no cut lands in silence ─────────────────────────────────────────────────────────

room = low(noise(DUR, 99), 800) * 0.02
fx[0] += room
fx[1] += np.roll(room, 1900)

# ── Mix and master ────────────────────────────────────────────────────────────────────────────────

music = low(high(music, 30), 16000)
# The shape: the band builds section by section to the peak and the payoff (smoothed 0.25 s).
GAIN = {'hook': 0.55, 'groove': 0.7, 'lift': 0.84, 'peak': 1.0, 'breath': 0.8, 'riser': 0.9, 'hit': 1.0, 'end': 0.95}
curve = np.array([GAIN[section(i / 100)] for i in range(int(DUR * 100) + 1)])
k = np.ones(25) / 25
curve = np.convolve(np.pad(curve, 12, mode='edge'), k, mode='valid')[: len(curve)]
music *= np.interp(np.arange(N) / SR, np.arange(len(curve)) / 100, curve)
# The music dips a little under the printer, so every line is heard.
ticks = np.abs(high(fx.mean(axis=0), 1500))
env = np.zeros(N)
y = 0.0
att, rel = np.exp(-1 / (0.003 * SR)), np.exp(-1 / (0.12 * SR))
for i in range(0, N, 64):
    v = ticks[i:i + 64].max(initial=0.0)
    y = att * y + (1 - att) * v if v > y else rel * y + (1 - rel) * v
    env[i:i + 64] = y
duck = 1 - np.clip(env / 0.08, 0, 1) * 0.3
mix = music * duck * 0.9 + fx
mix[:, -int(0.8 * SR):] *= np.linspace(1, 0, int(0.8 * SR)) ** 2
peak = np.abs(mix).max()
wavfile.write(RAW, SR, (mix / peak * 0.7).T.astype(np.float32))

# Two-pass loudnorm to -14 LUFS, -1 dBTP.
first = subprocess.run(['ffmpeg', '-v', 'info', '-i', str(RAW), '-af', 'loudnorm=I=-14:TP=-2.2:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
m = json.loads(first[first.rindex('{'):first.rindex('}') + 1])
af = (f"loudnorm=I=-14:TP=-2.2:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
      f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
# Then a limiter at 4x oversampling, so the peaks stay under -1 dBTP once X's AAC has them.
af += ',aresample=192000,alimiter=limit=0.47:attack=1:release=40:level=false,aresample=48000'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(RAW), '-af', af, '-ar', str(SR), '-c:a', 'pcm_s24le', str(OUT)], check=True)
check = subprocess.run(['ffmpeg', '-nostats', '-i', str(OUT), '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
summary = [ln.strip() for ln in check.splitlines() if ln.strip().startswith(('I:', 'Peak:'))]
print('mix.wav', ' '.join(summary[-2:]))
