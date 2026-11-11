"""Contact sheet of a render at given times: python3 scripts/day/sheet.py <video> <out.jpg> <cols> t1 t2 ..."""
import subprocess, sys
from PIL import Image, ImageDraw
video, out, cols, *ts = sys.argv[1:]
cols = int(cols)
W, H = 640, 360
ims = []
for t in ts:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', t, '-i', video, '-frames:v', '1', '-vf', f'scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    im = Image.frombytes('RGB', (W, H), raw)
    d = ImageDraw.Draw(im); d.rectangle((0, 0, 44, 16), fill='black'); d.text((3, 2), t, fill='yellow')
    ims.append(im)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, H * rows), 'white')
for i, im in enumerate(ims): sheet.paste(im, ((i % cols) * W, (i // cols) * H))
sheet.save(out, quality=88)
