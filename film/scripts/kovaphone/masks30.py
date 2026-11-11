"""Frame-accurate masks for the app track: python3 masks30.py <ocr_app30.tsv> <masks.json>
Every line whose text contains the recipient's number (or 7+ digits in a row) is covered from the
first digit to its end, on its own frame and the 3 frames either side. Replaces masks.json's "app"
with {"frames": {trackFrame: [[x,y,w,h], ...]}}; the PIN mask is kept."""
import collections, json, os, re, sys
by = collections.defaultdict(list)
# KOVA_MASK_LINE: fragments of the recipient's number, kept out of the repo.
pat = re.compile(os.environ.get('KOVA_MASK_LINE', r'(?!)') + r'|\d{7,}')
for l in open(sys.argv[1]):
    f, box, t = l.rstrip('\n').split('\t', 2)
    t = t.strip()
    if not pat.search(t.replace(' ', '')): continue
    x, y, w, h = map(float, box.split(','))
    m = re.search(r'[+:]?\s?2\s?3\s?4|\d{4,}', t)
    frac = m.start() / len(t) if m else 0
    by[int(f[2:7])].append([round(x + w * frac - 0.015, 4), round(y - 0.008, 4), round(w * (1 - frac) + 0.035, 4), round(h + 0.016, 4)])
frames = collections.defaultdict(list)
for fr, boxes in by.items():
    for d in range(-3, 4):
        frames[fr + d].extend(boxes)
out = json.load(open(sys.argv[2]))
out['app'] = {'frames': {str(k): v for k, v in sorted(frames.items())}}
json.dump(out, open(sys.argv[2], 'w'))
print(len(by), 'frames with the number;', len(frames), 'frames masked')
