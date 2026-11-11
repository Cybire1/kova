#!/bin/bash
# Render "Kova on the wall":  film/scripts/wall/render.sh
#   1. the screen (3000x1000) as an image sequence the wall plays, 2. the sound (music + design),
#   3. the stage (1920x1080) with the score, mastered to -14 LUFS, peak about -1.5 dBTP
#   → film/out/kova-on-the-wall.mp4
set -e
cd "$(dirname "$0")/../.."
T=out/.wall
OUT=out/kova-on-the-wall.mp4
mkdir -p $T
rm -rf public/wall/frames
npx remotion render src/wall/index.tsx WallScreen public/wall/frames --sequence --image-format=jpeg --jpeg-quality=94 --concurrency=6 --log=error
python3 scripts/wall/mix.py
npx remotion render src/wall/index.tsx WallStage "$T/video.mp4" --muted --image-format=png --crf=12 --color-space=bt709 --gl=angle --concurrency=3 --log=error
npx remotion render src/wall/index.tsx WallStage "$T/audio.wav" --codec=wav --log=error
lufs() { ffmpeg -nostats -i "$1" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}'; }
master() { ffmpeg -v error -y -i "$1" -af "volume=$(python3 -c "print(round(-14 - float('$(lufs "$1")'), 2))")dB,alimiter=limit=0.76:level=false:attack=3:release=60" -ar 48000 -c:a pcm_s16le "$2"; }
master $T/audio.wav $T/m1.wav
master $T/m1.wav $T/m2.wav
ffmpeg -v error -y -i $T/video.mp4 -i $T/m2.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf $T
echo "$OUT: $(lufs "$OUT") LUFS"
