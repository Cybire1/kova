"""A labelled strip of frames: python3 scripts/day/strip.py <clip> <out.png> t1 t2 ..."""
import subprocess, sys
from PIL import Image, ImageDraw
clip, out, *ts = sys.argv[1:]
ims = []
for t in ts:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', t, '-i', clip, '-frames:v', '1', '-vf', 'scale=236:512', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    im = Image.frombytes('RGB', (236, 512), raw)
    d = ImageDraw.Draw(im); d.rectangle((0, 490, 70, 512), fill='black'); d.text((4, 494), t, fill='yellow')
    ims.append(im)
sheet = Image.new('RGB', (236 * len(ims), 512), 'white')
for i, im in enumerate(ims): sheet.paste(im, (236 * i, 0))
sheet.save(out)
