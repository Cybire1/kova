#!/bin/bash
# scene.sh <name> <seconds> <devlink>: records the Kova simulator while the app runs one dev link.
D=CDE8188D-03D6-4189-BB00-44DED78F0E9F
OUT=/Users/cyber/kova/film/demo/raw/$1.mp4
xcrun simctl terminate $D xyz.kova.pay.monad 2>/dev/null
xcrun simctl io $D recordVideo --codec=h264 --force "$OUT" > /dev/null 2>&1 &
REC=$!
sleep 1
xcrun simctl launch $D xyz.kova.pay.monad -KovaDevLink "$3" > /dev/null
sleep 6
xcrun simctl openurl $D "xyz.kova.pay.monad://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8085"
sleep "$2"
kill -INT $REC; wait $REC 2>/dev/null
echo "recorded $OUT"
