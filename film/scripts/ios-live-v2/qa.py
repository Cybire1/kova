"""Validate both real exports and build visual inspection sheets."""
from pathlib import Path
import io
import json
import math
import re
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.io import wavfile
from scipy.signal import find_peaks

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/ios-live-v2'
VIDEO = ROOT / 'out/kova-ios-live-v2.mp4'
MASTER = ROOT / 'out/kova-ios-live-v2-4k.mp4'
font = ImageFont.truetype(str(ROOT / 'public/fonts/Manrope_600SemiBold.ttf'), 18)


def run(args):
    return subprocess.run(args, text=True, capture_output=True, check=True)


def probe(path, size):
    data = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)]).stdout)
    v = next(s for s in data['streams'] if s['codec_type'] == 'video')
    a = next(s for s in data['streams'] if s['codec_type'] == 'audio')
    assert (v['width'], v['height']) == size
    assert v['codec_name'] == 'h264' and v['pix_fmt'] == 'yuv420p'
    assert v['r_frame_rate'] == '30/1' and int(v['nb_frames']) == 270
    assert abs(float(data['format']['duration']) - 9) < 0.05
    assert a['codec_name'] == 'aac' and a['sample_rate'] == '48000' and a['channels'] == 2
    return {'path': str(path), 'bytes': path.stat().st_size, 'duration': data['format']['duration'], 'video': {k: v.get(k) for k in ['width', 'height', 'codec_name', 'profile', 'pix_fmt', 'nb_frames', 'r_frame_rate', 'color_space']}}


exports = [probe(VIDEO, (1920, 1080)), probe(MASTER, (3840, 2160))]
measure = run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(VIDEO), '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'])
loudness = json.loads(re.findall(r'\{[^{}]+\}', measure.stderr)[-1])
blackcheck = run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(VIDEO), '-vf', 'blackdetect=d=0.03:pix_th=0.05', '-an', '-f', 'null', '-'])
blacks = re.findall(r'black_start:[^\n]+', blackcheck.stderr)
assert not blacks, blacks


def frame(n, master=False):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(n/30), '-i', str(MASTER if master else VIDEO), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'])
    return Image.open(io.BytesIO(raw)).convert('RGB')


def sheet(numbers, name, cols=6):
    w,h,caption = 320,180,28
    canvas = Image.new('RGB', (w*cols, (h+caption)*math.ceil(len(numbers)/cols)), '#e7e5e0')
    draw = ImageDraw.Draw(canvas)
    for i,n in enumerate(numbers):
        im=frame(n).resize((w,h), Image.Resampling.LANCZOS)
        x,y=(i%cols)*w,(i//cols)*(h+caption)
        canvas.paste(im,(x,y+caption))
        draw.text((x+5,y+3),f'f{n} / {n/30:.2f}s',font=font,fill='#0b1a1d')
    canvas.save(OUT/name)


sheet(list(range(0,270,10)), 'contact-sheet.jpg')
cuts=[43,57,80,91,102,113,120,132,145,152]
sheet(sorted(set(f for c in cuts for f in [c-2,c,c+2])), 'transitions.jpg')
end=frame(269, True)
end.save(OUT/'ending-4k.png')
frame(15).save(OUT/'opening.png')

# Compare a straight, unoccluded piece of the real master display against the source at
# precisely the same scale. Exclude the camera cutout and rounded corners.
frameScale=870/2708*2
left=(960-1311*870/2708/2)*2+54*frameScale
top=(540-870/2)*2+44*frameScale
imageScale=1204/1179*frameScale
imageH=2556*1204/1179
imageTop=top+(2620-imageH)/2*frameScale
box=(100,300,1079,1450)
dest=(round(left+box[0]*imageScale),round(imageTop+box[1]*imageScale),round(left+box[2]*imageScale),round(imageTop+box[3]*imageScale))
crop=end.crop(dest)
source=Image.open(ROOT/'public/private/sam/01-home-before.png').convert('RGB').crop(box).resize(crop.size,Image.Resampling.LANCZOS)
from scipy.ndimage import laplace
def sharp(im): return float(np.var(laplace(np.asarray(im.convert('L'),dtype=float))))

# Inspect foley as decoded audio, independent of the video timestamps.
sr,sfx=wavfile.read(ROOT/'public/ios-live-v2/sfx.wav')
energy=(sfx.astype(float)**2).mean(axis=1)
window=256
envelope=np.array([energy[i:i+window].mean() for i in range(0,len(energy),window)])
events=json.loads((ROOT/'public/ios-live-v2/audio-events.json').read_text())['events']
detected,_=find_peaks(envelope, height=envelope.max()*0.01, prominence=envelope.max()*0.007, distance=max(1,int(0.06*sr/window)))
detected_times=detected*window/sr
peaks=[]
for event in events:
    expected=event['at']
    actual=float(detected_times[np.argmin(abs(detected_times-expected))])
    peaks.append({'frame':event['frame'],'nearest_energy_peak':round(actual,4),'offset_frames':round((actual-expected)*30,2)})

result={'exports':exports,'loudness':loudness,'black_intervals':blacks,'source_pixels_per_master_pixel':round(1/imageScale,3),
    'screen_sharpness':{'source_matched':sharp(source),'master_capture':sharp(crop)},'foley_peak_offsets':peaks,
    'contact_sheet':str(OUT/'contact-sheet.jpg'),'transitions':str(OUT/'transitions.jpg')}
(OUT/'qa.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
