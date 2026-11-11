"""Finds the frames where the cash-out recording changes screen (frame differencing), so the film's
cuts and flips land on the real events. Usage: python3 scripts/cashout/events.py public/cashout/run.mp4"""
import subprocess
import sys

import numpy as np

src = sys.argv[1]
W, H = 118, 256
raw = subprocess.run(
    ['ffmpeg', '-v', 'error', '-i', src, '-vf', f'scale={W}:{H},format=gray', '-f', 'rawvideo', '-'],
    capture_output=True, check=True,
).stdout
frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
diff = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
for i, d in enumerate(diff):
    if d > float(sys.argv[2] if len(sys.argv) > 2 else 1.2):
        print(f'{(i + 1) / 30:6.2f}s  frame {i + 1:5d}  change {d:5.1f}')
