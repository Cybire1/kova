"""Bake a conversion LUT and a look LUT into one .cube, with the look at a chosen strength.
python3 combine.py <conversion.cube> <look.cube> <strength 0-1> <out.cube> "<title>"
out(x) = conv(x) + strength * (look(conv(x)) - conv(x)), sampled on the conversion's own grid."""
import sys, numpy as np
from scipy.interpolate import RegularGridInterpolator

def read(p):
    size, rows, dmin, dmax = None, [], [0, 0, 0], [1, 1, 1]
    for l in open(p, errors='ignore'):
        s = l.strip()
        if s.startswith('LUT_3D_SIZE'): size = int(s.split()[1])
        elif s.startswith('DOMAIN_MIN'): dmin = [float(v) for v in s.split()[1:]]
        elif s.startswith('DOMAIN_MAX'): dmax = [float(v) for v in s.split()[1:]]
        elif s and (s[0].isdigit() or s[0] in '-.'): rows.append([float(v) for v in s.split()[:3]])
    a = np.array(rows).reshape(size, size, size, 3)  # [b][g][r] since r runs fastest
    return size, a, np.array(dmin), np.array(dmax)

conv_p, look_p, strength, out_p, title = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], sys.argv[5]
n, conv, _, _ = read(conv_p)
m, look, lmin, lmax = read(look_p)
g = np.linspace(0, 1, m)
interp = RegularGridInterpolator((g, g, g), look, bounds_error=False, fill_value=None)  # axes b, g, r
c = np.clip(conv.reshape(-1, 3), 0, 1)
looked = interp(c[:, ::-1])  # query as (b, g, r)
out = np.clip(c + strength * (looked - c), 0, 1)
with open(out_p, 'w') as f:
    f.write(f'TITLE "{title}"\n# Apple Log 2 to Rec.709 (Bransford Media, ACES 2.0 SDR) then a look at {int(strength*100)}%.\n')
    f.write(f'LUT_3D_SIZE {n}\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n')
    for r in out: f.write(f'{r[0]:.6f} {r[1]:.6f} {r[2]:.6f}\n')
print(out_p)
