"""Build the 16:9 A-roll from the 4K tone-mapped master: python3 aroll16.py <a-sdr.mov> <edl.json> <out.mp4>
W pieces use the whole 4K frame (2x downsample); T pieces a 2880x1620 window on his face (1.5x).
Both stay above 1080p before scaling, so nothing is upscaled."""
import json, subprocess, sys, tempfile, os
src, edl_path, out = sys.argv[1:4]
edl = json.load(open(edl_path))
tmp = tempfile.mkdtemp()
lst = []
for k, s in enumerate(edl):
    if s['zoom'] == 'W':
        cw, ch, left, top = 3840, 2160, 0, 0
    else:
        cw, ch = 2880, 1620
        left = min(max(round(s['cx'] * 3840 - cw / 2), 0), 3840 - cw)
        top = s.get('top16', min(max(round(s['cy'] * 2160 - 0.46 * ch), 0), 2160 - ch))
    s['crop16'] = [cw, ch, left, top]
    frames = round(s['dur'] * 30)
    vf = f"fps=30,crop={cw}:{ch}:{left}:{top},scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p"
    p = f'{tmp}/p{k:02d}.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f"{s['in']:.4f}", '-i', src, '-frames:v', str(frames), '-vf', vf, '-an',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '8', '-pix_fmt', 'yuv420p', '-r', '30',
                    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', p], check=True)
    lst.append(f"file '{p}'")
open(f'{tmp}/list.txt', 'w').write('\n'.join(lst) + '\n')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{tmp}/list.txt', '-c', 'copy', out], check=True)
json.dump(edl, open(edl_path, 'w'), indent=1)
print(out, sum(round(s['dur'] * 30) for s in edl), 'frames')
