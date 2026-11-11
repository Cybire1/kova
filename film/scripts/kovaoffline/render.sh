#!/bin/bash
# Render "Dollars for every phone", two payments (KovaOfflineFilm):  film/scripts/kovaoffline/render.sh
#   → film/out/kova-dollars-for-every-phone-2.mp4 (1920x1080 30 fps, H.264 BT.709, AAC 192k, -14 LUFS)
set -e
cd "$(dirname "$0")/../.."
T=out/.kovaoffline
OUT=out/kova-dollars-for-every-phone-2.mp4
mkdir -p $T
npx remotion render src/kovaoffline/index.tsx KovaOfflineFilm "$T/video.mp4" --muted --image-format=png --crf=10 --color-space=bt709 --concurrency=4 --log=error
npx remotion render src/kovaoffline/index.tsx KovaOfflineFilm "$T/audio.wav" --codec=wav --log=error
lufs() { ffmpeg -nostats -i "$1" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}'; }
master() { ffmpeg -v error -y -i "$1" -af "volume=$(python3 -c "print(round(-14 - float('$(lufs "$1")'), 2))")dB,alimiter=limit=0.76:level=false:attack=3:release=60" -ar 48000 -c:a pcm_s16le "$2"; }
master $T/audio.wav $T/m1.wav
master $T/m1.wav $T/m2.wav
ffmpeg -v error -y -i $T/video.mp4 -i $T/m2.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(lufs "$OUT") LUFS"
