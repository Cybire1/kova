"""A-roll and voice for "ugc 1" from the 4K original (his own grade, untouched):
python3 aroll.py <src.mp4> <edl.json> <out_dir>
W = whole 3840x2160 frame (2x downsample); T = a 2880x1620 window on his face (1.5x). Never upscaled.
Voice: the same pieces, 8 ms fades at every cut, concatenated at 48 kHz."""
import json, subprocess, sys, tempfile
src, edl_p, out = sys.argv[1:4]
edl = json.load(open(edl_p)); tmp = tempfile.mkdtemp(); vl, al = [], []
for k, s in enumerate(edl):
    if s['zoom'] == 'W': cw, ch, x, y = 3840, 2160, 0, 0
    else:
        cw, ch = 2880, 1620
        x = min(max(round(s['cx'] * 3840 - cw / 2), 0), 3840 - cw)
        y = min(max(round((s['cy'] - 0.08) * 2160 - ch / 2), 0), 2160 - ch)
    n = round(s['dur'] * 25)
    v = f'{tmp}/v{k:02d}.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f"{s['src_in']:.3f}", '-i', src, '-frames:v', str(n), '-an',
                    '-vf', f'crop={cw}:{ch}:{x}:{y},scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '8', '-r', '25', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', v], check=True)
    a = f'{tmp}/a{k:02d}.wav'
    d = n / 25
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f"{s['src_in']:.3f}", '-t', f'{d:.4f}', '-i', src, '-vn', '-ac', '2', '-ar', '48000',
                    '-af', f'afade=t=in:d=0.008,afade=t=out:st={d - 0.008:.4f}:d=0.008', a], check=True)
    vl.append(f"file '{v}'"); al.append(f"file '{a}'")
open(f'{tmp}/v.txt', 'w').write('\n'.join(vl) + '\n'); open(f'{tmp}/a.txt', 'w').write('\n'.join(al) + '\n')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{tmp}/v.txt', '-c', 'copy', f'{out}/aroll.mp4'], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{tmp}/a.txt', '-af', 'highpass=f=70,lowpass=f=15000', f'{out}/voice.wav'], check=True)
print('done', sum(round(s['dur'] * 25) for s in edl), 'frames')
