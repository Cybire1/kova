#!/bin/bash
# All commands run from film/. No existing composition or asset is overwritten.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p out/ios-live
python3 scripts/ios-live/mix.py
./node_modules/.bin/remotion render src/ios-live/index.tsx IosLive out/ios-live/picture.mp4 \
  --muted --image-format=png --crf=10 --pixel-format=yuv420p --color-space=bt709 \
  --gl=angle --concurrency=3 --log=error
ffmpeg -v error -y -i out/ios-live/picture.mp4 -i public/ios-live/score.wav \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 320k -ar 48000 \
  -movflags +faststart -t 12 out/kova-ios-live.mp4
echo 'out/kova-ios-live.mp4'
