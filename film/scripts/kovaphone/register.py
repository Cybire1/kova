"""Undo the macOS screen zoom in the kovaphone recording, frame by frame.
python3 register.py <src.mp4> <ref.png> <start_s> <end_s> <out.json>
Each frame = s * screen + t (a pure zoom: scale and offset, no rotation). ORB features matched to
the unzoomed reference, a RANSAC similarity fit, rotation forced to 0; frames that fail are filled by
interpolation, then the series is lightly smoothed. Writes [{"f": frame, "s":, "tx":, "ty":, "ok":}]."""
import json, sys
import cv2, numpy as np
src, ref_p, a, b, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
ref = cv2.cvtColor(cv2.imread(ref_p), cv2.COLOR_BGR2GRAY)
orb = cv2.ORB_create(nfeatures=4000, scaleFactor=1.2, nlevels=10, fastThreshold=12)
kr, dr = orb.detectAndCompute(ref, None)
bf = cv2.BFMatcher(cv2.NORM_HAMMING)
cap = cv2.VideoCapture(src)
fps = cap.get(cv2.CAP_PROP_FPS)
cap.set(cv2.CAP_PROP_POS_FRAMES, round(a * fps))
rows = []
f = round(a * fps)
while f < round(b * fps):
    ok, img = cap.read()
    if not ok: break
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    kf, df = orb.detectAndCompute(g, None)
    res = {'f': f, 'ok': False}
    if df is not None and len(kf) > 30:
        m = bf.knnMatch(df, dr, k=2)
        good = [p[0] for p in m if len(p) == 2 and p[0].distance < 0.75 * p[1].distance]
        if len(good) >= 20:
            src_pts = np.float32([kr[x.trainIdx].pt for x in good])  # screen (reference)
            dst_pts = np.float32([kf[x.queryIdx].pt for x in good])  # frame
            M, inl = cv2.estimateAffinePartial2D(src_pts, dst_pts, method=cv2.RANSAC, ransacReprojThreshold=3.0, maxIters=4000, confidence=0.995)
            if M is not None and inl is not None and inl.sum() >= 15:
                s = float(np.hypot(M[0, 0], M[1, 0]))
                rot = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
                if abs(rot) < 1.0 and 0.9 < s < 6:
                    # refit with rotation 0: frame = s*screen + t over the inliers
                    i = inl.ravel().astype(bool)
                    S, D = src_pts[i], dst_pts[i]
                    s2 = float(((D - D.mean(0)) * (S - S.mean(0))).sum() / ((S - S.mean(0)) ** 2).sum())
                    t2 = D.mean(0) - s2 * S.mean(0)
                    res = {'f': f, 'ok': True, 's': s2, 'tx': float(t2[0]), 'ty': float(t2[1]), 'n': int(i.sum())}
    rows.append(res); f += 1
# fill failures by interpolation, then smooth with a short centred window
idx = [k for k, r in enumerate(rows) if r['ok']]
for key in ('s', 'tx', 'ty'):
    xs = np.array(idx); ys = np.array([rows[k][key] for k in idx])
    full = np.interp(np.arange(len(rows)), xs, ys)
    sm = np.convolve(np.pad(full, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    for k in range(len(rows)): rows[k][key] = float(sm[k])
json.dump(rows, open(out, 'w'))
print(len(rows), 'frames;', len(idx), 'registered directly;', len(rows) - len(idx), 'interpolated')
