#!/bin/bash
# Render "Deposits" (Kova takes deposits from 53 networks):  film/scripts/deposits/render.sh
#   → film/out/kova-deposits.mp4 (1920x1080 30 fps, H.264, AAC 192k)
# The sound is built and mastered once (sound.py: voice, score and effects, -14 LUFS) and muxed as
# is; the picture renders silent. Needs public/deposits/rec-deposit-cfr.mp4 and rec-arrival-h264.mp4 (the
# holder's recordings at a constant 60 fps), networks.json and the voice
# (scripts/deposits/voiceover.mjs). Port 3071: 3000 belongs to another project.
set -e
cd "$(dirname "$0")/../.."
T=out/.deposits
OUT=out/kova-deposits.mp4
mkdir -p $T
python3 scripts/deposits/sound.py
npx remotion render src/deposits/index.tsx Deposits "$T/video.mp4" --muted --image-format=jpeg --jpeg-quality=96 --crf=12 --color-space=bt709 --concurrency=4 --port=3071 --log=error
ffmpeg -v error -y -i $T/video.mp4 -i public/deposits/mix.wav -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -crf 16 -preset slow -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(ffmpeg -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}') LUFS"
