"""One frame with a grid every 100 capture pixels: python3 scripts/day/grid.py <clip> <t> <out>"""
import subprocess, sys
from PIL import Image, ImageDraw
clip, t, out = sys.argv[1:4]
probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', clip], capture_output=True, text=True).stdout.strip().split(',')
W, H = int(probe[0]), int(probe[1])
raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', t, '-i', clip, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
im = Image.frombytes('RGB', (W, H), raw)
s = 0.4
im = im.resize((int(W * s), int(H * s)))
d = ImageDraw.Draw(im)
for y in range(0, H, 100):
    d.line((0, y * s, W * s, y * s), fill=(255, 0, 0) if y % 500 == 0 else (255, 150, 150), width=1)
    d.text((2, y * s + 1), str(y), fill='red')
for x in range(0, W, 100):
    d.line((x * s, 0, x * s, H * s), fill=(0, 0, 255) if x % 500 == 0 else (150, 150, 255), width=1)
im.save(out)
