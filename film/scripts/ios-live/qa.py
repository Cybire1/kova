"""Inspect the actual export: codec, loudness, black frames, and visual review sheets."""
from pathlib import Path
import json
import math
import re
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
VIDEO = ROOT / 'out/kova-ios-live.mp4'
OUT = ROOT / 'out/ios-live'
OUT.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype(str(ROOT / 'public/fonts/Manrope_600SemiBold.ttf'), 18)


def command(args):
    return subprocess.run(args, capture_output=True, text=True, check=True)


probe = json.loads(command(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(VIDEO)]).stdout)
v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
a = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
assert (v['width'], v['height'], v['codec_name'], v['pix_fmt']) == (1920, 1080, 'h264', 'yuv420p')
assert v['r_frame_rate'] == '30/1'
assert int(v['nb_frames']) == 360
assert abs(float(probe['format']['duration']) - 12) < 0.1
assert (a['codec_name'], a['sample_rate'], a['channels']) == ('aac', '48000', 2)

measure = command(['ffmpeg', '-hide_banner', '-nostats', '-i', str(VIDEO), '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9:print_format=json', '-f', 'null', '-'])
loudness = json.loads(re.findall(r'\{[^{}]+\}', measure.stderr)[-1])
blacks = command(['ffmpeg', '-hide_banner', '-nostats', '-i', str(VIDEO), '-vf', 'blackdetect=d=0.03:pix_th=0.05', '-an', '-f', 'null', '-'])
black_events = re.findall(r'black_start:[^\n]+', blacks.stderr)
assert not black_events, black_events


def frame(n):
    result = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-ss', str(n / 30), '-i', str(VIDEO),
        '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'
    ])
    import io
    return Image.open(io.BytesIO(result)).convert('RGB')


def sheet(numbers, dest, columns=6, cellw=320):
    cellh = cellw * 9 // 16
    caption = 28
    canvas = Image.new('RGB', (columns * cellw, math.ceil(len(numbers) / columns) * (cellh + caption)), '#f1efea')
    draw = ImageDraw.Draw(canvas)
    for i, n in enumerate(numbers):
        im = frame(n)
        im.thumbnail((cellw, cellh), Image.Resampling.LANCZOS)
        x, y = (i % columns) * cellw, (i // columns) * (cellh + caption)
        canvas.paste(im, (x, y + caption))
        draw.text((x + 6, y + 3), f'f{n} / {n/30:.2f}s', font=font, fill='#0b1a1d')
    canvas.save(dest)


sheet(list(range(0, 360, 10)), OUT / 'contact-sheet.jpg')
transition_frames = sorted(set(n for c in [47, 62, 78, 143, 152, 177, 184, 197, 228, 242] for n in [c-2, c, c+2]))
sheet(transition_frames, OUT / 'transitions.jpg')
frame(359).save(OUT / 'ending.png')
frame(122).save(OUT / 'live-reveal.png')
frame(0).save(OUT / 'opening.png')

# At the finish, each source pixel covers less than one output pixel. Compare a capture to
# the actual screen bounds after matching sizes: gradients and small lettering must survive.
end = frame(359)
screen = end.crop((1234, 123, 1612, 945))
source = Image.open(ROOT / 'public/private/sam/01-home-before.png').convert('RGB').resize(screen.size, Image.Resampling.LANCZOS)
def sharpness(im):
    from scipy.ndimage import laplace
    return float(np.var(laplace(np.asarray(im.convert('L'), dtype=float))))

report = {
    'export': str(VIDEO), 'duration': probe['format']['duration'], 'frames': v['nb_frames'],
    'video': {key: v.get(key) for key in ['codec_name', 'profile', 'width', 'height', 'r_frame_rate', 'pix_fmt', 'color_space']},
    'audio': {key: a.get(key) for key in ['codec_name', 'sample_rate', 'channels', 'bit_rate']},
    'loudness': loudness, 'black_frames': black_events,
    'display_source_pixels_per_output_pixel': round(1179 / 378, 2),
    'sharpness': {'source_matched': sharpness(source), 'render_crop': sharpness(screen), 'note': 'Approximate bounds: the phone has a slight yaw, so these are diagnostic values, not a pixel equality assertion.'},
    'contact_sheet': str(OUT / 'contact-sheet.jpg'),
    'transition_sheet': str(OUT / 'transitions.jpg'),
}
(OUT / 'qa.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
