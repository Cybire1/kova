#!/bin/bash
# Render "xStocks. Live in Kova." v4 (v3 set smaller and editorial):  film/scripts/xstocks4/render.sh
#   → film/out/kova-xstocks-v4.mp4 (1920x1080 30 fps, H.264 High, yuv420p tv range, AAC 48 kHz, +faststart)
# Sound is built and mastered once (sound.py: voice, score, effects → -14 LUFS, < -1 dBTP) and muxed
# as is; the picture renders silent, as PNG frames for sharp type. Port 3071 (3000 is another project's).
# Needs the voice (scripts/xstocks2/voiceover.mjs) and the frozen prices (scripts/xstocks2/prices.mjs).
set -e
cd "$(dirname "$0")/../.."
T=out/.xstocks4
OUT=out/kova-xstocks-v4.mp4
mkdir -p $T
python3 scripts/xstocks4/sound.py
npx remotion render src/xstocks4/index.tsx XStocks4 "$T/video.mp4" --muted --image-format=png --crf=10 --color-space=bt709 --concurrency=6 --port=3071 --log=error
ffmpeg -v error -y -i $T/video.mp4 -i public/xstocks4/mix.wav -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -crf 16 -preset slow -c:a aac -b:a 256k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(ffmpeg -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|Peak):" | tr -s ' ' | tr '\n' ' ')"
