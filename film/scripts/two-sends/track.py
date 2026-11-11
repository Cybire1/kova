"""Camera tracking for kovaa.mp4 with a 3-parameter model (zoom s and pan tx, ty; the recorder never
rotates): x_frame = s * x_ref + t. Direct (Lucas-Kanade) alignment of each frame to the unzoomed
reference at 31.0 s, using only pixels that never change (desktop, bezels, Dock), never the screens.
Usage: track.py SRC REF_PNG START END S0 TX0 TY0 OUT.json
  REF_PNG is the unzoomed frame at 31.0 s:  ffmpeg -ss 31 -i film/kovaa.mp4 -frames:v 1 ref.png
  Start each run on a frame where the camera is at rest (s=1, t=0), e.g. 0, 570, 930, 1245, 1620,
  1980, 2250, run the chunks in parallel, and merge them by frame into cam.json."""
import cv2, numpy as np, json, sys

src, ref_png, start, end, s0, tx0, ty0, out = sys.argv[1:9]
start, end = int(start), int(end)
p0 = (float(s0), float(tx0), float(ty0))

ref = cv2.imread(ref_png, cv2.IMREAD_GRAYSCALE).astype(np.float32)
mask = np.full(ref.shape, 255, np.uint8)
for x0, y0, x1, y1 in [(354, 122, 744, 956), (1014, 130, 1413, 963), (329, 48, 766, 112), (994, 56, 1432, 120), (1150, 0, 1920, 34)]:
    mask[y0:y1, x0:x1] = 0

LEVELS = [(0.125, 30), (0.25, 25), (0.5, 20)]
lv = {}
for f, _ in LEVELS:
    R = cv2.GaussianBlur(cv2.resize(ref, None, fx=f, fy=f, interpolation=cv2.INTER_AREA), (0, 0), 1.0)
    M = cv2.resize(mask, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) > 250
    gx = cv2.Sobel(R, cv2.CV_32F, 1, 0, ksize=3) / 8
    gy = cv2.Sobel(R, cv2.CV_32F, 0, 1, ksize=3) / 8
    # Only pixels with some texture carry information.
    M &= (np.abs(gx) + np.abs(gy)) > 0.4
    ys, xs = np.nonzero(M)
    lv[f] = (R, xs.astype(np.float32), ys.astype(np.float32), R[ys, xs])


def sample(img, X, Y):
    n = X.size
    w = 1024
    rows = (n + w - 1) // w
    mx = np.zeros(rows * w, np.float32); my = np.zeros(rows * w, np.float32)
    mx[:n] = X; my[:n] = Y
    return cv2.remap(img, mx.reshape(rows, w), my.reshape(rows, w), cv2.INTER_LINEAR).ravel()[:n]


def align(F, p):
    s, tx, ty = p
    for f, iters in LEVELS:
        R, xs, ys, Rv = lv[f]
        Ff = cv2.GaussianBlur(cv2.resize(F, None, fx=f, fy=f, interpolation=cv2.INTER_AREA), (0, 0), 1.0)
        gx = cv2.Sobel(Ff, cv2.CV_32F, 1, 0, ksize=3) / 8
        gy = cv2.Sobel(Ff, cv2.CV_32F, 0, 1, ksize=3) / 8
        h, w = Ff.shape
        for _ in range(iters):
            X = s * xs + tx * f
            Y = s * ys + ty * f
            ok = (X >= 1) & (X <= w - 2) & (Y >= 1) & (Y <= h - 2)
            if ok.sum() < 200:
                return (s, tx, ty), 1e9, 0
            Xo, Yo = X[ok].astype(np.float32), Y[ok].astype(np.float32)
            Fv = sample(Ff, Xo, Yo)
            Gx = sample(gx, Xo, Yo)
            Gy = sample(gy, Xo, Yo)
            r = Fv - Rv[ok]
            J = np.stack([Gx * xs[ok] + Gy * ys[ok], Gx * f, Gy * f], 1)
            # Huber weights: the cursor and anything else that moved count for little.
            a = np.abs(r)
            k = 12.0
            wgt = np.where(a <= k, 1.0, k / np.maximum(a, 1e-6)).astype(np.float32)
            JW = J * wgt[:, None]
            H = JW.T @ J + np.diag([1e-3, 1e-6, 1e-6])
            g = JW.T @ r
            d = -np.linalg.solve(H, g)
            s, tx, ty = s + d[0], tx + d[1], ty + d[2]
            if abs(d[0]) < 1e-5 and abs(d[1]) < 0.02 and abs(d[2]) < 0.02:
                break
    err = float(np.median(np.abs(r)))
    return (s, tx, ty), err, int(ok.sum())


cap = cv2.VideoCapture(src)
i = -1
res = []
hist = [p0, p0]
while True:
    ok, fr = cap.read()
    i += 1
    if not ok or i > end:
        break
    if i < start:
        continue
    F = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    a, b = hist[-2], hist[-1]
    pred = tuple(b[j] + 0.8 * (b[j] - a[j]) for j in range(3)) if i > start else b
    p, err, n = align(F, pred)
    # If the prediction overshot (a move just stopped), try from the last pose too.
    if err > 3.0:
        p2, err2, n2 = align(F, b)
        if err2 < err:
            p, err, n = p2, err2, n2
    res.append(dict(i=i, s=round(float(p[0]), 5), tx=round(float(p[1]), 2), ty=round(float(p[2]), 2), err=round(err, 3), n=n))
    hist.append(p)
    if i % 90 == 0:
        print(res[-1], file=sys.stderr, flush=True)
json.dump(res, open(out, 'w'))
print('done', start, end, file=sys.stderr)
