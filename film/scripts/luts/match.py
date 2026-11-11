"""A moody, muted 'city' look matched by measurement to a reference frame, for Rec.709 footage
(use AFTER the Apple Log 2 -> Rec.709 conversion).  python3 match.py <out.cube> [strength]
Targets measured on the reference: middle tone 0.31, mean saturation 0.22, neutral shadows,
mids and highs only slightly warm with a hint of magenta. Tone is matched by percentiles."""
import sys, numpy as np, colorsys
from scipy.interpolate import PchipInterpolator

out_p = sys.argv[1]
strength = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
N = 33
g = np.linspace(0, 1, N)
b, gg, r = np.meshgrid(g, g, g, indexing='ij')
rgb = np.stack([r, gg, b], -1).reshape(-1, 3)
W = np.array([0.2126, 0.7152, 0.0722])

x = rgb.copy()
# 1. white balance: take out the room's orange cast (shadows go neutral)
x = x * np.array([0.90, 0.985, 1.12])
# 2. tone: percentile match (your p2/p25/p50/p75/p98 -> the reference's), applied to luminance
src = [0.0, 0.099, 0.265, 0.482, 0.656, 0.749, 1.0]
dst = [0.0, 0.075, 0.190, 0.310, 0.445, 0.745, 0.96]
curve = PchipInterpolator(src, dst)
L = np.einsum('ij,j->i', x, W)
Ln = curve(np.clip(L, 0, 1))
x = x * (Ln / np.maximum(L, 1e-4))[:, None]
# 3. a little warmth and magenta back into mids/highs only, as in the reference
L = np.einsum('ij,j->i', np.clip(x, 0, 1), W)[:, None]
w = np.clip((L - 0.12) / 0.5, 0, 1)
x = x + w * np.array([0.022, -0.012, -0.012])
x = x + (L ** 2) * np.array([0.10, 0.02, -0.06])  # the reference's highlights stay warm, not lilac
# 4. saturation down to the reference's, skin hues held a little higher
x = np.clip(x, 0, 1)
hsv = np.array([colorsys.rgb_to_hsv(*c) for c in x])
h = hsv[:, 0] * 360
skin = np.exp(-((((h - 25) + 180) % 360 - 180) / 22) ** 2)
hsv[:, 1] = np.clip(hsv[:, 1] * (0.66 + 0.16 * skin), 0, 1)
x = np.array([colorsys.hsv_to_rgb(*c) for c in hsv])
out = np.clip(rgb + strength * (x - rgb), 0, 1)
with open(out_p, 'w') as f:
    f.write(f'TITLE "City Moody {int(strength*100)}%"\n# Rec.709 in, Rec.709 out. Use after the Apple Log 2 -> Rec.709 conversion.\n')
    f.write(f'LUT_3D_SIZE {N}\n')
    for c in out: f.write(f'{c[0]:.6f} {c[1]:.6f} {c[2]:.6f}\n')
print(out_p)
