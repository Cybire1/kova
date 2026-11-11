#!/bin/bash
# Render the illustrated lesson "How a stealth address works":  film/scripts/stealth/render-lesson.sh
#   → film/out/stealth-lesson.mp4 (1920x1080 30 fps, H.264 High, yuv420p tv range, AAC 192k, -16 LUFS)
set -e
cd "$(dirname "$0")/../.."
T=out/.lesson
OUT=out/stealth-lesson.mp4
mkdir -p $T
python3 scripts/stealth/lesson-score.py
npx remotion render src/stealth/index.tsx StealthExplainer "$T/video.mp4" --muted --image-format=jpeg --jpeg-quality=96 --crf=10 --color-space=bt709 --concurrency=4 --port=3073 --log=error
ffmpeg -v error -y -i $T/video.mp4 -i public/stealth/lesson.wav -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -crf 16 -preset slow -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(ffmpeg -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}') LUFS"
