#!/bin/bash
# Render "Kova: dollars for every phone":  film/scripts/kova-launch/render.sh
#   → film/out/kova-launch.mp4 (1920x1080 30 fps, H.264 BT.709, AAC 192k, -14 LUFS)
set -e
cd "$(dirname "$0")/../.."
T=out/.kova-launch
OUT=out/kova-launch.mp4
mkdir -p $T
# The score: kovaphone/music-b.mp3 (120 BPM), bars 8-12 repeated once on bar lines, to 52 s.
ffmpeg -v error -y -i public/kovaphone/music-b.mp3 -filter_complex "[0:a]atrim=0:26.12,asetpts=PTS-STARTPTS[a];[0:a]atrim=16.12:26.12,asetpts=PTS-STARTPTS[b];[0:a]atrim=26.12,asetpts=PTS-STARTPTS[c];[a][b]acrossfade=d=0.03:c1=tri:c2=tri[ab];[ab][c]acrossfade=d=0.03:c1=tri:c2=tri,atrim=0:52,afade=t=out:st=50.6:d=1.4[o]" -map "[o]" -ar 48000 public/kova-launch/music.mp3
npx remotion render src/kova-launch/index.tsx KovaLaunch "$T/video.mp4" --muted --image-format=jpeg --jpeg-quality=96 --crf=12 --color-space=bt709 --concurrency=4 --log=error
npx remotion render src/kova-launch/index.tsx KovaLaunch "$T/audio.wav" --codec=wav --log=error
lufs() { ffmpeg -nostats -i "$1" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}'; }
master() { ffmpeg -v error -y -i "$1" -af "volume=$(python3 -c "print(round(-14 - float('$(lufs "$1")'), 2))")dB,alimiter=limit=0.76:level=false:attack=3:release=60" -ar 48000 -c:a pcm_s16le "$2"; }
master $T/audio.wav $T/m1.wav
master $T/m1.wav $T/m2.wav
ffmpeg -v error -y -i $T/video.mp4 -i $T/m2.wav -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -crf 16 -preset slow -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(lufs "$OUT") LUFS"
