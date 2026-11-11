"""Re-fill weak zoom fits: python3 repair.py <reg.json> [min_matches=30]
A fit from fewer than `min_matches` inliers is treated as unknown and re-interpolated from the good
frames around it (the series is already smoothed, so this only replaces bad stretches)."""
import json, sys
import numpy as np
p = sys.argv[1]; floor = int(sys.argv[2]) if len(sys.argv) > 2 else 30
r = json.load(open(p))
good = [i for i, q in enumerate(r) if q.get('n', 0) >= floor]
bad = len(r) - len(good)
for key in ('s', 'tx', 'ty'):
    vals = np.interp(np.arange(len(r)), good, [r[i][key] for i in good])
    for i, q in enumerate(r):
        if q.get('n', 0) < floor: q[key] = float(vals[i]); q['repaired'] = True
json.dump(r, open(p, 'w'))
print(bad, 'weak frames re-filled out of', len(r))
