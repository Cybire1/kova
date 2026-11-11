#!/bin/bash
# Render "xStocks, live in Kova":  film/scripts/xstocks/render.sh
#   → film/out/kova-xstocks.mp4 (1920x1080 30 fps, H.264 High, yuv420p, AAC 192k, -14 LUFS)
# The sound is built and mastered once (sound.py: voice, score and effects) and muxed as is; the
# picture renders silent. Needs the captures in public/xstocks (Kova's web Stocks screens, rendered from
# apps/web with one real trade) and the voice (scripts/xstocks/voiceover.mjs).
# Port 3071: 3000 belongs to another project.
set -e
cd "$(dirname "$0")/../.."
T=out/.xstocks
OUT=out/kova-xstocks.mp4
mkdir -p $T
python3 scripts/xstocks/sound.py
npx remotion render src/xstocks/index.tsx XStocks "$T/video.mp4" --muted --image-format=jpeg --jpeg-quality=96 --crf=12 --color-space=bt709 --concurrency=6 --port=3071 --log=error
ffmpeg -v error -y -i $T/video.mp4 -i public/xstocks/mix.wav -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -crf 16 -preset slow -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(ffmpeg -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|Peak):" | tr -s ' ' | tr '\n' ' ')"
