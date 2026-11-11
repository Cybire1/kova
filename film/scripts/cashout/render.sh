#!/bin/bash
# Render "Cash out" (Kova's cash-out to 50+ countries):  film/scripts/cashout/render.sh
#   → film/out/kova-cashout.mp4 (1920x1080 30 fps, H.264 High, yuv420p tv range, AAC 192k)
# Needs public/cashout/run.mp4: the app's autopilot run (apps/mobile cash-out-world.tsx, film=1),
# recorded on the simulator and made a constant 30 fps. Port 3072: 3000 and 3100 are other projects.
set -e
cd "$(dirname "$0")/../.."
T=out/.cashout
OUT=out/kova-cashout.mp4
mkdir -p $T
python3 scripts/cashout/score.py
npx remotion render src/cashout/index.tsx CashOut "$T/video.mp4" --muted --image-format=jpeg --jpeg-quality=96 --crf=10 --color-space=bt709 --concurrency=4 --port=3072 --log=error
ffmpeg -v error -y -i $T/video.mp4 -i public/cashout/mix.wav -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -crf 16 -preset slow -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "${T:?}"
echo "$OUT: $(ffmpeg -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}') LUFS"
