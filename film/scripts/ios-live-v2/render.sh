#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p out/ios-live-v2
python3 scripts/ios-live-v2/mix.py
ffmpeg -v error -y -i public/private/sam/01-home-before.png -vf scale=774:-1:flags=lanczos -frames:v 1 public/ios-live-v2/screen-master.png
./node_modules/.bin/remotion render src/ios-live-v2/index.tsx IosLaunch out/ios-live-v2/picture-4k.mp4 \
  --scale=2 --muted --image-format=png --crf=10 --pixel-format=yuv420p --color-space=bt709 \
  --concurrency=4 --log=error
ffmpeg -v error -y -i out/ios-live-v2/picture-4k.mp4 -i public/ios-live-v2/score.wav \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 320k -ar 48000 -t 9 \
  -movflags +faststart out/kova-ios-live-v2-4k.mp4
ffmpeg -v error -y -i out/kova-ios-live-v2-4k.mp4 -vf scale=1920:1080:flags=lanczos \
  -c:v libx264 -preset slow -crf 12 -profile:v high -pix_fmt yuv420p -c:a copy \
  -movflags +faststart out/kova-ios-live-v2.mp4
