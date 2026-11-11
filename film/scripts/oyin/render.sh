#!/bin/bash
# Render "This link is a restaurant." (src/oyin):  film/scripts/oyin/render.sh
#   → film/out/kova-oyin-kitchen.mp4 (1920x1080 30 fps, H.264 High, yuv420p tv range, AAC 48 kHz, +faststart)
# Sound is built and mastered once (sound.py: voice, score, effects → -14 LUFS) and muxed as is; the
# picture renders silent, as PNG frames for sharp type. Port 3071 (3000 is another project's).
# Needs the voice (scripts/oyin/voiceover.mjs) and the recording's proxy (public/oyin/rec.mp4).
set -e
cd "$(dirname "$0")/../.."
T=out/.oyin
OUT=out/kova-oyin-kitchen.mp4
mkdir -p $T
python3 scripts/oyin/sound.py
npx remotion render src/oyin/index.tsx Oyin "$T/video.mp4" --muted --image-format=png --crf=10 --color-space=bt709 --concurrency=6 --port=3071 --log=error
ffmpeg -v error -y -i $T/video.mp4 -i public/oyin/mix.wav -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -crf 16 -preset slow -c:a aac -b:a 256k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(ffmpeg -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|Peak):" | tr -s ' ' | tr '\n' ' ')"
