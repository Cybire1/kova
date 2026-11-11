#!/bin/bash
# Render "stealth" (how private payments work, from the library's live runs):  film/scripts/stealth/render.sh
#   → film/out/stealth-explainer.mp4 (white); `render.sh Stealth out/stealth.mp4` for the dark cut.
#    (1920x1080 30 fps, H.264 High, yuv420p tv range, AAC 192k)
# Port 3073: 3000, 3072 and 3100 are other projects.
set -e
cd "$(dirname "$0")/../.."
COMP=${1:-StealthLight}
OUT=${2:-out/stealth-explainer.mp4}
T=out/.stealth
mkdir -p $T
python3 scripts/stealth/score.py
npx remotion render src/stealth/index.tsx "$COMP" "$T/video.mp4" --muted --image-format=jpeg --jpeg-quality=96 --crf=10 --color-space=bt709 --concurrency=4 --port=3073 --log=error
ffmpeg -v error -y -i $T/video.mp4 -i public/stealth/mix.wav -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -crf 16 -preset slow -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(ffmpeg -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}') LUFS"
