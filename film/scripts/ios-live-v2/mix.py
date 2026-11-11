"""Nine-second music edit: remove six beats; let the original final hit ring out."""
from pathlib import Path
import json
import re
import subprocess
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public'
OUT = PUBLIC / 'ios-live-v2'
WORK = ROOT / 'out/ios-live-v2'
WORK.mkdir(parents=True, exist_ok=True)
SR = 48000
N = SR * 9


def read(path):
    return np.frombuffer(subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(PUBLIC / path), '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'
    ]), dtype=np.float32).reshape(-1, 2).copy()


source = read('wall/music/a.mp3')
cut = int(4.8 * SR)
skip = int(3 * SR)
music = np.concatenate([source[:cut], source[cut+skip:]])[:N].astype(float)
# The two fragments share the 120 bpm grid. Hide their seam in a 20 ms crossfade.
half = int(0.01 * SR)
blend = np.linspace(0, 1, half * 2)[:, None]
music[cut-half:cut+half] = source[cut-half:cut+half] * (1-blend) + source[cut+skip-half:cut+skip+half] * blend
t = np.arange(N) / SR
low = sosfiltfilt(butter(3, 1000, 'lowpass', fs=SR, output='sos'), music, axis=0)
opening = np.interp(t, [0, 0.8, 1.56, 9], [0.55, 0.7, 1, 1])[:, None]
music = (low * (1-opening) + music * opening) * 0.73
music *= np.interp(t, [0, 0.01, 8.75, 9], [0.9, 1, 1, 0])[:, None]
sfx = np.zeros((N, 2), dtype=float)
events = []


def cue(path, frame, db):
    data = read(path)
    peak = np.max(np.abs(data))
    if peak == 0:
        return
    data *= 10 ** (db / 20) / peak
    e = np.mean(data*data, axis=1)
    step = 256
    hit = int(np.argmax([e[i:i+step].mean() for i in range(0, len(e), step)])) * step
    start = round(frame / 30 * SR) - hit
    trim = max(0, -start)
    start = max(0, start)
    data = data[trim:trim+max(0, N-start)]
    sfx[start:start+len(data)] += data
    events.append({'path': path, 'frame': frame, 'at': frame/30, 'peak_dbfs': db})


cue('spot/sfx/type.mp3', 4, -28)
cue('link/sfx/tap.mp3', 40, -25)
cue('audio/sfx/whoosh-real.wav', 62, -24)
cue('link/sfx/land.mp3', 82, -27)
cue('audio/sfx/swish.mp3', 98, -26)
cue('spot/sfx/type.mp3', 108, -29)
cue('spot/sfx/type.mp3', 120, -29)
cue('audio/sfx/pop.mp3', 152, -26)
cue('link/sfx/tap.mp3', 152, -27)

wavfile.write(str(WORK / 'mix-raw.wav'), SR, (music+sfx).astype(np.float32))
wavfile.write(str(OUT / 'sfx.wav'), SR, sfx.astype(np.float32))
first = subprocess.run([
    'ffmpeg', '-hide_banner', '-nostats', '-i', str(WORK / 'mix-raw.wav'),
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'
], text=True, capture_output=True, check=True)
stats = json.loads(re.findall(r'\{[^{}]+\}', first.stderr)[-1])
settings = ':'.join([
    'loudnorm=I=-14:TP=-1.5:LRA=11', f"measured_I={stats['input_i']}", f"measured_TP={stats['input_tp']}",
    f"measured_LRA={stats['input_lra']}", f"measured_thresh={stats['input_thresh']}", f"offset={stats['target_offset']}",
    'linear=true',
])
subprocess.run([
    'ffmpeg', '-v', 'error', '-y', '-i', str(WORK / 'mix-raw.wav'), '-af', settings,
    '-ar', str(SR), '-c:a', 'pcm_s24le', str(OUT / 'score.wav')
], check=True)
(OUT / 'audio-events.json').write_text(json.dumps({'source': 'wall/music/a.mp3', 'removed': [4.8, 7.8], 'hit': 5.06, 'events': events}, indent=2))
print('Wrote 9 s score; final source hit at 5.06 s.')
