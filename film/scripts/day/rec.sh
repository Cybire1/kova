#!/bin/bash
# Record one run of the real app on the Kova simulator, played by a dev link (apps/mobile/src/app/dev.tsx).
#   scripts/day/rec.sh <name> <HH:MM clock> <seconds> "<dev link query>"
# → public/day/raw/<name>.mp4 (the simulator's own pixels, 1179 x 2556). Metro must be on :8096.
set -e
D=CDE8188D-03D6-4189-BB00-44DED78F0E9F
cd "$(dirname "$0")/../.."
OUT=public/day/raw/$1.mp4
xcrun simctl status_bar $D override --time "$( [ "$2" = now ] && date +%H:%M || echo $2 )" --batteryState charged --batteryLevel 100 ${STATUS:---cellularMode active --cellularBars 4 --wifiBars 3} --operatorName ""
xcrun simctl terminate $D xyz.kova.pay.monad 2>/dev/null || true
sleep 1
xcrun simctl io $D recordVideo --codec=h264 --force "$OUT" > /dev/null 2>&1 &
REC=$!
sleep 1
xcrun simctl launch $D xyz.kova.pay.monad --initialUrl http://localhost:8096 -KovaDevLink "$4" > /dev/null
sleep "$3"
# The recorder writes a frame only when the screen changes, and holds back the last one: nudge the
# battery a step and back so the final screen is written (trim these frames in the edit).
for L in 99 100 99 100; do xcrun simctl status_bar $D override --batteryLevel $L; sleep 0.4; done
kill -INT $REC
wait $REC 2>/dev/null || true
echo "$OUT $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s"
