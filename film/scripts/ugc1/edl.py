"""The cut for "ugc 1" (2:43 talk -> ~59 s): python3 edl.py <whisper.json> <faces.txt> <out edl.json>
Each piece is a span of his own words (source seconds). Cut points are padded into the silence
around the words, never into a neighbouring word. Zoom alternates wide/tight per piece so jump cuts
read as camera changes. The tight crop is centred on his face (Vision, 5 fps)."""
import json, sys
import numpy as np
words = [w for s in json.load(open(sys.argv[1]))['segments'] for w in s['words']]
faces = [tuple(map(float, l.split()[1:5])) for l in open(sys.argv[2])]
P = [  # (first word start, last word end, beat label)
    (22.66, 24.80, 'hook'),          # if you can imagine it, you can most likely build it.
    (4.40, 6.64, 'topic'),           # how you can build cool stuffs with AI.
    (9.36, 14.40, 'limits'),         # what about limits which you've placed on the advancement of AI? just cut it.
    (70.72, 74.56, 'cant'),          # if you see something and say, hey, I can't do this stuff. what you know to do is
    (75.54, 76.56, 'x10'),           # times by 10.
    (30.02, 32.56, 'refs'),          # the second thing you need to know is have a lot of references.
    (37.28, 37.94, 'shot'),          # get a screenshot,
    (38.74, 41.48, 'agents'),        # get a video of it, process it to the AI or to the agents.
    (43.36, 50.16, 'ffmpeg'),        # even if it's a video, there's something called FFmpeg. what it does is it breaks down a video into lots of pictures
    (51.62, 53.78, 'moving'),        # videos itself are just moving pictures.
    (58.02, 62.42, 'agentvid'),      # you reverse engineer that process, you can have an agent go through your videos.
    (84.80, 86.32, 'book'),          # there's a book which I really like,
    (86.92, 88.42, 'title'),         # steal like an artist by Austin Kleon.
    (89.88, 94.60, 'join'),          # to create something new, you just need to join a lot of other things and you have something new.
    (94.98, 96.32, 'sun'),           # there's basically nothing new under the sun.
    (116.64, 119.92, 'series'),      # teaching you how to build stuff with AI from mobile apps to websites
    (129.90, 131.78, 'market'),      # most devs don't teach you is how to market,
    (138.82, 140.22, 'users'),       # when you build a product, you want to get users
    (146.30, 149.06, 'first'),       # your first 10 users, your first 100 users,
    (150.66, 151.60, 'me'),          # I'll be your first user.
    (152.14, 154.04, 'test'),        # I could test your product for you, just send me a text
    (154.96, 156.10, 'follow'),      # just follow this channel for more
]
starts = np.array([w['start'] for w in words]); ends = np.array([w['end'] for w in words])
def pad(a, b):
    i = int(np.argmin(np.abs(starts - a))); j = int(np.argmin(np.abs(ends - b)))
    prev_end = ends[i - 1] if i > 0 else 0
    next_start = starts[j + 1] if j + 1 < len(words) else b + 1
    return round(a - min(0.10, (a - prev_end) * 0.5), 3), round(b + min(0.16, (next_start - b) * 0.6), 3)
fps = 25
edl, at = [], 0.0
for k, (a, b, label) in enumerate(P):
    s, e = pad(a, b)
    fs, fe = round(s * fps), round(e * fps)          # whole frames
    dur = (fe - fs) / fps
    mid = int(((s + e) / 2) * 5)
    cx, cy, fw, fh = np.mean(faces[max(0, mid - 3):mid + 4], axis=0)
    zoom = 'W' if k % 2 == 0 else 'T'
    edl.append(dict(id=label, src_in=fs / fps, src_out=fe / fps, at=round(at, 4), dur=round(dur, 4), zoom=zoom, cx=round(cx, 4), cy=round(cy, 4), fh=round(fh, 4)))
    at += dur
json.dump(edl, open(sys.argv[3], 'w'), indent=1)
print(f'{len(edl)} pieces, {at:.2f} s')
for p in edl: print(f"  {p['id']:9s} {p['src_in']:7.2f}-{p['src_out']:7.2f}  at {p['at']:6.2f}  {p['dur']:5.2f}s {p['zoom']}")
