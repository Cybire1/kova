"""Cut kovaa.mp4 into the two-sends footage: the segments in order (some sped up, two held), with the
Mac around the simulators painted out in the wallpaper's own peach (the striped margins, the desktop
icons, the menu bar and the Dock), placed through the camera track so they follow every zoom.

Writes film/public/two-sends/edit.mp4 (H.264, BT.709) and film/src/two-sends/edit.json: for every
output frame, its source frame and the camera (s, tx, ty), plus the segment list."""
import json, subprocess, sys
import numpy as np

SRC = '/Users/cyber/kova/film/kovaa.mp4'
CAM = '/Users/cyber/kova/film/scripts/two-sends/cam.json'
OUT_MP4 = '/Users/cyber/kova/film/public/two-sends/edit.mp4'
OUT_JSON = '/Users/cyber/kova/film/src/two-sends/edit.json'
W, H = 1920, 1080

# (name, kind, a, b_or_n, rate): seg = source frames [a, b) every `rate`; hold = frame a for n frames.
EDIT = [
    ('hook', 'seg', 156, 282, 1),
    ('review1', 'seg', 642, 762, 1),
    ('sending1', 'seg', 762, 924, 4),
    ('sent1', 'seg', 924, 1062, 1),
    ('card1', 'seg', 1140, 1188, 1),
    ('card1-hold', 'hold', 1188, 60, 0),
    ('card1-tap', 'seg', 1188, 1204, 1),
    ('scan1', 'seg', 1299, 1350, 1),
    ('scan1-hold', 'hold', 1349, 36, 0),
    ('scan1-tip', 'seg', 1350, 1377, 1),
    ('addr1', 'seg', 1380, 1438, 1),
    ('addr1-hold', 'hold', 1437, 36, 0),
    ('start2', 'seg', 1602, 1689, 2),
    ('review2', 'seg', 2016, 2172, 2),
    ('sending2', 'seg', 2172, 2352, 4),
    ('arrive2', 'seg', 2352, 2412, 1),
    ('card2', 'seg', 2466, 2505, 1),
    ('card2-hold', 'hold', 2505, 72, 0),
    ('card2-tap', 'seg', 2505, 2513, 1),
    ('announce2', 'seg', 2556, 2679, 1),
]

plan = []  # (src_frame, segment index)
segs = []
for k, (name, kind, a, b, rate) in enumerate(EDIT):
    start = len(plan)
    if kind == 'seg':
        for f in range(a, b, rate):
            plan.append((f, k))
    else:
        plan += [(a, k)] * b
    segs.append(dict(name=name, kind=kind, from_=start, frames=len(plan) - start, src=a, rate=rate))
assert all(plan[i][0] <= plan[i + 1][0] for i in range(len(plan) - 1)), 'edit must run forward'

cam = json.load(open(CAM))
P = np.array([243, 214, 195], np.float32)   # the wallpaper
PT = np.array([246, 217, 198], np.float32)  # the wallpaper just under the menu bar


def paint(img, s, tx, ty):
    xl = int(round(s * 127 + tx))
    xr = int(round(s * 1725 + tx))
    # Menu bar: solid down to its edge, then a short feather into the wallpaper.
    yt, ft = s * 34 + ty, 10 * s
    if yt + ft > 0:
        y1 = min(H, int(np.ceil(yt + ft)) + 1)
        ys = np.arange(y1, dtype=np.float32)
        a = np.clip((yt + ft - ys) / ft, 0, 1)[:, None, None]
        img[:y1] = (img[:y1] * (1 - a) + PT * a + 0.5).astype(np.uint8)
    # Dock: a short feather above it, then solid.
    yd, fd = s * 1022 + ty, 12 * s
    if yd - fd < H:
        y0 = max(0, int(np.floor(yd - fd)))
        ys = np.arange(y0, H, dtype=np.float32)
        a = np.clip((ys - (yd - fd)) / fd, 0, 1)[:, None, None]
        img[y0:] = (img[y0:] * (1 - a) + P * a + 0.5).astype(np.uint8)
    # The Mac's left and right margins win over both, in the wallpaper's own colour at each height
    # (it lightens a little towards the menu bar).
    if xl > 0 or xr < W:
        yr = (np.arange(H, dtype=np.float32) - ty) / s
        a = np.clip((72 - yr) / 32, 0, 1)[:, None]
        col = (P * (1 - a) + PT * a + 0.5).astype(np.uint8)[:, None, :]
        if xl > 0:
            img[:, :min(xl, W)] = col
        if xr < W:
            img[:, max(xr, 0):] = col


last_src = plan[-1][0]
dec = subprocess.Popen(
    ['ffmpeg', '-v', 'error', '-i', SRC, '-frames:v', str(last_src + 1), '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    stdout=subprocess.PIPE)
enc = subprocess.Popen(
    ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', '30', '-i', '-',
     '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12',
     '-g', '30', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', OUT_MP4],
    stdin=subprocess.PIPE)

N = W * H * 3
frames_out = []
cur = -1
buf = None
for (src, k) in plan:
    while cur < src:
        raw = dec.stdout.read(N)
        if len(raw) < N:
            sys.exit(f'source ended at {cur}')
        buf = raw
        cur += 1
    c = cam[src]
    img = np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy()
    paint(img, c['s'], c['tx'], c['ty'])
    enc.stdin.write(img.tobytes())
    frames_out.append([src, round(c['s'], 5), round(c['tx'], 2), round(c['ty'], 2)])
enc.stdin.close()
enc.wait()
dec.stdout.close()
dec.wait()
json.dump(dict(fps=30, frames=frames_out, segments=[{**{('from' if kk == 'from_' else kk): v for kk, v in sg.items()}} for sg in segs]), open(OUT_JSON, 'w'))
print('frames', len(frames_out), 'seconds', round(len(frames_out) / 30, 2))
for sg in segs:
    print(sg)
