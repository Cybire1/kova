"""Each phone as its own steady video, at 1.5x its unzoomed screen size (the zoomed recording's
own detail): python3 extract.py <src.mp4> <reg.json> <out_dir>
Parts of a phone pushed off-screen by the zoom keep their last visible pixels."""
import json, subprocess, sys
import cv2, numpy as np
src, reg_p, out = sys.argv[1:4]
reg = json.load(open(reg_p))
K = 1.5
PHONES = {'app': (313, 148, 655, 862), 'sim': (1009, 286, 1300, 889)}
cap = cv2.VideoCapture(src)
cap.set(cv2.CAP_PROP_POS_FRAMES, reg[0]['f'])
procs, canvas = {}, {}
for name, (x0, y0, x1, y1) in PHONES.items():
    W, H = round((x1 - x0) * K) // 2 * 2, round((y1 - y0) * K) // 2 * 2
    canvas[name] = None
    procs[name] = (subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', '30', '-i', '-',
                                     '-c:v', 'libx264', '-preset', 'slow', '-crf', '10', '-pix_fmt', 'yuv420p', f'{out}/{name}.mp4'], stdin=subprocess.PIPE), W, H)
for r in reg:
    ok, img = cap.read()
    if not ok: break
    s, tx, ty = r['s'], r['tx'], r['ty']
    for name, (x0, y0, x1, y1) in PHONES.items():
        p, W, H = procs[name]
        A = np.float32([[K / s, 0, -K * tx / s - K * x0], [0, K / s, -K * ty / s - K * y0]])
        warped = cv2.warpAffine(img, A, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)
        valid = cv2.warpAffine(np.full(img.shape[:2], 255, np.uint8), A, (W, H), flags=cv2.INTER_NEAREST, borderValue=0)
        valid = cv2.erode(valid, np.ones((3, 3), np.uint8)) > 0  # drop the resampled edge row
        if canvas[name] is None: canvas[name] = warped.copy()
        canvas[name][valid] = warped[valid]
        p.stdin.write(canvas[name].tobytes())
for p, _, _ in procs.values():
    p.stdin.close(); p.wait()
print('done', len(reg), 'frames')
