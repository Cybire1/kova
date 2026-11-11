"""Where each recording changes: the mean frame difference over time, and the moments it spikes.
   python3 scripts/day/changes.py public/day/<clip>.mp4"""
import subprocess, sys
import numpy as np
path = sys.argv[1]
w, h = 118, 256
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={w}:{h},format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
f = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)
d = np.abs(np.diff(f, axis=0)).mean(axis=(1, 2))
out, last = [], -99
for i, v in enumerate(d):
    if v > 1.2 and i - last > 4:
        out.append(f'{(i + 1) / 30:.2f}s({v:.0f})')
        last = i
print(path.split('/')[-1], f'{len(f) / 30:.1f}s:', ' '.join(out))
