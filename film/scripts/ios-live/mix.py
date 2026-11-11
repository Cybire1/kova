"""Original project music + existing foley, aligned to actual visual hit frames."""
from pathlib import Path
import json
import re
import subprocess

import numpy as np
from scipy.signal import butter, sosfiltfilt
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public'
OUT = PUBLIC / 'ios-live'
OUT.mkdir(parents=True, exist_ok=True)
SR = 48000
DURATION = 12
N = SR * DURATION


def audio(path):
    result = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'
    ])
    return np.frombuffer(result, dtype=np.float32).reshape(-1, 2).copy()


def write(path, signal):
    wavfile.write(str(path), SR, signal.astype(np.float32))


music = audio(PUBLIC / 'wall/music/a.mp3')[:N]
if len(music) < N:
    music = np.pad(music, ((0, N - len(music)), (0, 0)))
t = np.arange(N) / SR
# A closed filter opens into the LIVE hit at frame 62, then breathes before the return to paper.
low = sosfiltfilt(butter(3, 650, 'lowpass', fs=SR, output='sos'), music, axis=0)
opening = np.interp(t, [0, 1.50, 2.067, 4.60, 4.90, 5.067, 12], [0.25, 0.5, 1, 1, 0.56, 1, 1])
music = low * (1 - opening[:, None]) + music * opening[:, None]
music *= np.interp(t, [0, 0.01, 10.9, 12], [0.85, 1, 1, 0])[:, None]
music *= 0.73
sfx = np.zeros((N, 2), dtype=np.float64)
events = []


def cue(file, frame, db, peak=True):
    data = audio(PUBLIC / file)
    amplitude = float(np.max(np.abs(data)))
    if amplitude < 1e-8:
        return
    data *= 10 ** (db / 20) / amplitude
    # Peak-align foley to the cut, rather than aligning the file's leading silence.
    energy = np.mean(data * data, axis=1)
    step = 256
    blocks = np.array([energy[i:i+step].mean() for i in range(0, len(energy), step)])
    hit = int(np.argmax(blocks)) * step if peak else 0
    start = round(frame / 30 * SR) - hit
    trim = max(0, -start)
    start = max(0, start)
    data = data[trim:trim + max(0, N - start)]
    sfx[start:start + len(data)] += data
    events.append({'file': file, 'frame': frame, 'seconds': round(frame / 30, 4), 'peak_dbfs': db})


for frame in [2, 17, 32]:
    cue('spot/sfx/tick.mp3', frame, -29)
cue('audio/sfx/whoosh-real.wav', 61, -20)
cue('spot/sfx/thud.mp3', 62, -18)
for frame in [62, 65, 68, 71]:
    cue('spot/sfx/type.mp3', frame, -27)
cue('audio/sfx/pullout.mp3', 83, -26)
cue('audio/sfx/whoosh-real.wav', 153, -23)
cue('link/sfx/land.mp3', 177, -24)
cue('spot/sfx/tick.mp3', 184, -30)
cue('spot/sfx/tick.mp3', 197, -30)
cue('link/sfx/tap.mp3', 242, -23)

scratch = ROOT / 'out/ios-live'
scratch.mkdir(parents=True, exist_ok=True)
raw = scratch / 'mix-raw.wav'
write(raw, music + sfx)
write(OUT / 'sfx.wav', sfx)
# Two-pass mastering preserves the arc; the true-peak target leaves AAC headroom.
first = subprocess.run([
    'ffmpeg', '-hide_banner', '-nostats', '-i', str(raw),
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9:print_format=json', '-f', 'null', '-'
], capture_output=True, text=True, check=True)
stats = json.loads(re.findall(r'\{[^{}]+\}', first.stderr)[-1])
settings = ':'.join([
    'loudnorm=I=-14:TP=-1.5:LRA=9',
    f"measured_I={stats['input_i']}", f"measured_TP={stats['input_tp']}",
    f"measured_LRA={stats['input_lra']}", f"measured_thresh={stats['input_thresh']}",
    f"offset={stats['target_offset']}", 'linear=true', 'print_format=summary',
])
subprocess.run([
    'ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-af', settings,
    '-ar', str(SR), '-c:a', 'pcm_s24le', str(OUT / 'score.wav')
], check=True)
(OUT / 'audio-events.json').write_text(json.dumps({'source': 'wall/music/a.mp3', 'events': events, 'master_input': stats}, indent=2))
print('Wrote ios-live/score.wav and sfx.wav; mastered for -14 LUFS / -1.5 dBTP')
