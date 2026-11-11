"""Where to cover private details on each phone track: the recipient's phone number (only its
digits) and the PIN field. python3 masks.py <ocr_app.tsv> <ocr_sim.tsv> <out.json>
Boxes are fractions of the track frame; intervals in track seconds, padded 0.2 s each side."""
import json, os, re, sys
out = {'app': [], 'sim': []}
# The recipient's number stays out of the repo: KOVA_MASK_LINE matches an OCR line that shows it,
# KOVA_MASK_START where on that line the digits begin.
LINE = re.compile(os.environ['KOVA_MASK_LINE'])
START = re.compile(os.environ['KOVA_MASK_START'])
rows = []
for l in open(sys.argv[1]):
    f, box, t = l.rstrip('\n').split('\t', 2)
    t = t.strip()
    if not LINE.search(t): continue
    x, y, w, h = map(float, box.split(','))
    m = START.search(t) or re.search(r'\d{6,}', t)
    frac = (m.start() / len(t)) if m else 0
    rows.append(((int(f[2:6]) - 1) / 10, (round(x + w * frac - 0.012, 3), round(y - 0.006, 3), round(w * (1 - frac) + 0.03, 3), round(h + 0.012, 3))))
rows.sort()
for t, b in rows:
    last = next((r for r in reversed(out['app']) if abs(r['box'][0] - b[0]) < 0.03 and abs(r['box'][1] - b[1]) < 0.02), None)
    if last and t - last['to'] <= 0.35:
        last['to'] = t
        last['box'] = [min(last['box'][0], b[0]), min(last['box'][1], b[1]),
                       max(last['box'][0] + last['box'][2], b[0] + b[2]) - min(last['box'][0], b[0]),
                       max(last['box'][1] + last['box'][3], b[1] + b[3]) - min(last['box'][1], b[1])]
    else:
        out['app'].append({'from': t, 'to': t, 'box': list(b)})
for r in out['app']:
    r['from'] = round(max(0, r['from'] - 0.2), 2); r['to'] = round(r['to'] + 0.2, 2)
    r['box'] = [round(v, 3) for v in r['box']]
# the PIN: the whole input line while its dialog is up
pin = [(int(l.split('\t')[0][2:6]) - 1) / 10 for l in open(sys.argv[2]) if 'Kova PIN' in l]
if pin:
    out['sim'].append({'from': round(min(pin) - 0.2, 2), 'to': round(max(pin) + 0.3, 2), 'box': [0.10, 0.468, 0.52, 0.062]})
json.dump(out, open(sys.argv[3], 'w'), indent=1)
print(len(out['app']), 'number masks;', len(out['sim']), 'PIN mask')
for r in out['app']: print('  app', r)
print('  sim', out['sim'])
