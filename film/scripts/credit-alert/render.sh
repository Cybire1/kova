#!/bin/bash
# Render "Credit alert" (Kova's cash-out to naira):  film/scripts/credit-alert/render.sh
#   → film/out/kova-credit-alert.mp4 (1920x1080 30 fps, H.264, AAC 192k)
# The sound is built and mastered once (sound.py: voice, score and effects, -14 LUFS) and muxed as
# is; the picture renders silent. Needs public/credit-alert/take-{a,b}.mp4 (record.cjs) and the
# voice (scripts/voiceover-naira.mjs).
set -e
cd "$(dirname "$0")/../.."
T=out/.credit-alert
OUT=out/kova-credit-alert.mp4
mkdir -p $T
python3 scripts/credit-alert/sound.py
npx remotion render src/credit-alert/index.tsx CreditAlert "$T/video.mp4" --muted --image-format=jpeg --jpeg-quality=96 --crf=12 --color-space=bt709 --concurrency=6 --log=error
ffmpeg -v error -y -i $T/video.mp4 -i public/credit-alert/mix.wav -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -crf 16 -preset slow -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(ffmpeg -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}') LUFS"
