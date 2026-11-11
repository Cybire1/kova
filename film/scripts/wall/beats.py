"""Where the music actually hits: python3 scripts/wall/beats.py public/wall/music/a.mp3 ...
Prints tempo, beat times, the RMS envelope per 0.25 s and the biggest energy jumps (drops)."""
import sys, numpy as np, librosa
for path in sys.argv[1:]:
    y, sr = librosa.load(path, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units='time')
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    tr = librosa.times_like(rms, sr=sr, hop_length=512)
    db = 20 * np.log10(rms + 1e-6)
    q = [round(float(np.mean(db[(tr >= s) & (tr < s + 0.25)])), 0) for s in np.arange(0, len(y) / sr, 0.25)]
    on = librosa.onset.onset_strength(y=y, sr=sr)
    to = librosa.times_like(on, sr=sr)
    # energy jump: mean dB of next 0.5 s minus previous 0.5 s
    jumps = []
    for s in np.arange(0.5, len(y) / sr - 0.5, 0.05):
        a = np.mean(db[(tr >= s - 0.5) & (tr < s)]); b = np.mean(db[(tr >= s) & (tr < s + 0.5)])
        jumps.append((b - a, s))
    jumps.sort(reverse=True)
    peaks = librosa.util.peak_pick(on, pre_max=5, post_max=5, pre_avg=10, post_avg=10, delta=0.6, wait=8)
    print(f'== {path}  tempo {float(np.atleast_1d(tempo)[0]):.1f}')
    print('beats', ' '.join(f'{b:.2f}' for b in beats))
    print('rms/0.25s', ' '.join(f'{v:.0f}' for v in q))
    print('jumps', ' '.join(f'{s:.2f}(+{d:.0f})' for d, s in jumps[:6]))
    print('strong onsets', ' '.join(f'{to[p]:.2f}' for p in peaks if on[p] > np.percentile(on, 90)))
