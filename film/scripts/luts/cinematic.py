"""A cinematic look LUT for Rec.709 footage (use AFTER the Apple Log 2 -> Rec.709 conversion).
python3 cinematic.py <out.cube> [strength]
Built for warm interiors with deep skin tones: cool the room a touch, roll the highlights off softly
(white walls stop shouting), a filmic S-curve with a slightly lifted black, teal in the shadows and
warmth in the highlights, skin hues protected, loud magenta/pink pulled back, overall saturation a
little lower so skin is the richest colour in frame."""
import sys, numpy as np, colorsys

out_p = sys.argv[1]
strength = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
N = 33
g = np.linspace(0, 1, N)
b, gg, r = np.meshgrid(g, g, g, indexing='ij')  # r runs fastest in .cube order
rgb = np.stack([r, gg, b], -1).reshape(-1, 3)

def luma(x): return x @ np.array([0.2126, 0.7152, 0.0722])

x = rgb.copy()
# 1. white balance: a touch cooler
x = x * np.array([0.965, 1.0, 1.04]) * 0.9  # cooler, and lower key: cinema sits darker than TV
# 2. highlight roll-off above 0.72 (soft shoulder), so bright walls hold detail
def shoulder(v, k=0.62):
    over = np.clip(v - k, 0, None)
    return np.where(v > k, k + (1 - k) * (1 - np.exp(-over / (1 - k) * 1.35)) / (1 - np.exp(-1.35)) * 0.97, v)
x = shoulder(x)
# 3. filmic S-curve around a 0.42 pivot, black lifted to 0.025 (a gentle matte)
p = 0.42
def scurve(v, c=1.42):
    lo = p * (v / p) ** c
    hi = 1 - (1 - p) * ((1 - v) / (1 - p)) ** c
    return np.where(v < p, lo, hi)
x = scurve(np.clip(x, 0, 1))
x = 0.025 + x * (1 - 0.025)
# 4. split tone: teal shadows, warm highlights, weighted by luminance
L = luma(x)[:, None]
sh = (1 - L) ** 2.2
hi = L ** 2.5
x = x + sh * np.array([-0.06, 0.012, 0.05]) + hi * np.array([0.05, 0.018, -0.05])
# 5. saturation: global 0.88, skin hues kept, magenta/pink pulled back
x = np.clip(x, 0, 1)
hsv = np.array([colorsys.rgb_to_hsv(*c) for c in x])
h, s, v = hsv[:, 0] * 360, hsv[:, 1], hsv[:, 2]
def bump(h, c, w): return np.exp(-(((h - c + 180) % 360 - 180) / w) ** 2)
sat = 0.82 + 0.2 * bump(h, 28, 22)           # skin (orange-red) stays full, a touch richer
sat *= np.where(s < 0.3, 0.55 + 1.5 * s, 1.0)  # low-saturation surfaces (walls) go quieter
sat *= 1 - 0.45 * bump(h, 325, 30)           # pink / magenta down
sat *= 1 - 0.15 * bump(h, 200, 30)           # cyan-blue down a little
s = np.clip(s * sat, 0, 1)
x = np.array([colorsys.hsv_to_rgb(a / 360, b_, c) for a, b_, c in zip(h, s, v)])
x = np.clip(x, 0, 1)
out = rgb + strength * (x - rgb)
with open(out_p, 'w') as f:
    f.write(f'TITLE "Kova Cinematic {int(strength*100)}%"\n# Rec.709 in, Rec.709 out. Use after the Apple Log 2 -> Rec.709 conversion.\n')
    f.write(f'LUT_3D_SIZE {N}\n')
    for c in out: f.write(f'{c[0]:.6f} {c[1]:.6f} {c[2]:.6f}\n')
print(out_p)
