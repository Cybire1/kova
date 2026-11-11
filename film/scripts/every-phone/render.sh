#!/bin/bash
# Render "Dollars for every phone" (Kova's mainnet launch):  film/scripts/every-phone/render.sh
#   → film/out/kova-every-phone.mp4 (1920x1080 30 fps, H.264, AAC 192k)
# The sound is built and mastered once (mix.sh: score + the film's own sound design, -14 LUFS) and
# muxed as is; the picture renders silent.
set -e
cd "$(dirname "$0")/../.."
T=out/.every-phone
OUT=out/kova-every-phone.mp4
mkdir -p $T
bash scripts/every-phone/mix.sh
npx remotion render src/every-phone/index.tsx EveryPhone "$T/video.mp4" --muted --image-format=jpeg --jpeg-quality=96 --crf=12 --color-space=bt709 --concurrency=4 --log=error
ffmpeg -v error -y -i $T/video.mp4 -i public/every-phone/mix.wav -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -crf 16 -preset slow -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(ffmpeg -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}') LUFS"
